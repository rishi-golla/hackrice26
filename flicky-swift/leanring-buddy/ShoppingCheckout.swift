import AppKit
import Combine
import SwiftUI

struct ShoppingStoreTask: Codable, Identifiable {
    enum Stage: String, Codable { case waiting, opening, opened, demoCart, demoOrder, failed }
    let id: UUID
    let title: String
    let merchant: String
    let url: String
    let quantity: Int
    let subtotalCents: Int
    var stage: Stage = .waiting
    var startedAt: Date?

    var label: String {
        switch stage {
        case .waiting: return "Waiting for payment"
        case .opening: return "Opening product page"
        case .opened: return "Product link opened"
        case .demoCart: return "Cart step simulated"
        case .demoOrder: return "Order simulated"
        case .failed: return "Couldn’t open product link · Try it manually"
        }
    }
}

struct ShoppingCheckoutDraft: Codable {
    let id: UUID
    let customerId: String
    let account: DemoCheckoutAccount
    let lines: [ShoppingBasketLine]
    let totalCents: Int
    var attemptedPayment = false
    var receipt: DemoCheckoutReceipt?
    var tasks: [ShoppingStoreTask]
}

@MainActor
final class ShoppingCheckoutCoordinator: ObservableObject {
    @Published private(set) var draft: ShoppingCheckoutDraft?
    @Published private(set) var isBusy = false
    @Published var errorMessage: String?
    @Published private(set) var status = "Review payment"
    var currentIdentity: (() -> (customerId: String, accountId: String)?)?
    var onRefreshBalance: (() async -> Void)?
    private var ledger: DemoCheckoutLedger?
    private let storageURL: URL
    private var storageBlocked = false
    private let openProductLink: (URL) -> Bool
    private let animateTasks: Bool

    var canFinish: Bool {
        guard let draft, let receipt = draft.receipt, !receipt.paymentRejected,
              receipt.balanceDeductionObserved || receipt.paymentPosted else { return false }
        return !draft.tasks.isEmpty && draft.tasks.allSatisfy { $0.stage == .demoOrder || $0.stage == .failed }
    }

    init(storageURL: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Flicky/checkout-draft.json"), ledger: DemoCheckoutLedger? = nil,
         animateTasks: Bool = true, openProductLink: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }) {
        self.storageURL = storageURL
        self.ledger = ledger
        self.animateTasks = animateTasks
        self.openProductLink = openProductLink
        if FileManager.default.fileExists(atPath: storageURL.path) {
            do {
                draft = try JSONDecoder().decode(ShoppingCheckoutDraft.self, from: Data(contentsOf: storageURL))
                status = draft?.receipt == nil ? "Resume checkout" : "Sandbox payment recorded"
            } catch {
                storageBlocked = true
                errorMessage = "The previous checkout couldn’t be loaded. Check the sandbox payment history before paying again."
            }
        }
    }

    func restoreLock(on store: ShoppingBasketStore) {
        store.isLocked = draft != nil || storageBlocked
        if storageBlocked { store.message = errorMessage }
    }

    func prepare(store: ShoppingBasketStore) {
        guard !storageBlocked, !isBusy, draft == nil, store.readyForDemoCheckout, store.progress == nil else { return }
        guard let identity = currentIdentity?() else { store.message = "Connect a Nessie sandbox account to check out."; return }
        isBusy = true
        store.isLocked = true
        Task {
            defer { isBusy = false; if draft == nil { store.isLocked = false } }
            do {
                let ledger = try paymentLedger()
                let account = try await ledger.prepare(customerId: identity.customerId, accountId: identity.accountId)
                guard let current = currentIdentity?(), current.customerId == identity.customerId, current.accountId == identity.accountId else {
                    throw CheckoutIssue.accountChanged
                }
                let lines = store.lines
                guard !lines.isEmpty, lines.allSatisfy({ $0.product?.readyForDemoCheckout == true }) else { throw CheckoutIssue.staleProducts }
                draft = ShoppingCheckoutDraft(id: UUID(), customerId: identity.customerId, account: account,
                    lines: lines, totalCents: lines.compactMap(\.subtotalCents).reduce(0, +), tasks: lines.compactMap { line in
                        guard let product = line.product, let subtotal = line.subtotalCents else { return nil }
                        return ShoppingStoreTask(id: line.id, title: product.title, merchant: product.merchant,
                            url: product.url, quantity: line.quantity, subtotalCents: subtotal)
                    })
                try save()
                status = "Review your purchase"
            } catch {
                draft = nil
                store.message = error.localizedDescription
            }
        }
    }

    func pay(store: ShoppingBasketStore) {
        guard !isBusy, let snapshot = draft else { return }
        errorMessage = nil
        isBusy = true
        Task {
            defer { isBusy = false }
            do {
                guard let identity = currentIdentity?(), identity.accountId == snapshot.account.accountId,
                      identity.customerId == snapshot.customerId else { throw CheckoutIssue.accountChanged }
                guard snapshot.totalCents > 0,
                      snapshot.totalCents == snapshot.lines.compactMap(\.subtotalCents).reduce(0, +) else { throw CheckoutIssue.invalidTotal }
                if snapshot.receipt == nil {
                    // A previously attempted payment must reconcile under its original UUID
                    // even if product metadata has aged while the app was closed.
                    if !snapshot.attemptedPayment && !snapshot.lines.allSatisfy({ $0.product?.readyForDemoCheckout == true }) { throw CheckoutIssue.staleProducts }
                    draft?.attemptedPayment = true
                    try save()
                    status = "Validating Nessie sandbox funds…"
                    let receipt = try await paymentLedger().pay(checkoutId: snapshot.id, customerId: snapshot.customerId,
                        accountId: snapshot.account.accountId, amountCents: snapshot.totalCents)
                    draft?.receipt = receipt
                    try save()
                    await onRefreshBalance?()
                } else if !snapshot.receipt!.balanceDeductionObserved && !snapshot.receipt!.paymentPosted {
                    status = "Checking Nessie payment status…"
                    draft?.receipt = try await paymentLedger().pay(checkoutId: snapshot.id, customerId: snapshot.customerId,
                        accountId: snapshot.account.accountId, amountCents: snapshot.totalCents)
                    try save()
                    await onRefreshBalance?()
                }
                guard draft?.receipt?.paymentRejected != true else {
                    status = "Nessie rejected the sandbox debit"
                    return
                }
                status = "Opening your stores"
                await runStoreTasks()
                status = "Checkout summary"
            } catch {
                if let issue = error as? DemoCheckoutLedgerError {
                    switch issue {
                    case .rejected:
                        draft?.attemptedPayment = false
                    case .configuration, .invalidAmount, .insufficientFunds, .accountMismatch:
                        if !snapshot.attemptedPayment { draft?.attemptedPayment = false }
                    default: break
                    }
                    try? save()
                }
                errorMessage = error.localizedDescription
                status = "Payment needs attention"
                await onRefreshBalance?()
            }
        }
    }

    func cancelReview(store: ShoppingBasketStore) {
        guard !isBusy, draft?.attemptedPayment == false || draft?.receipt?.paymentRejected == true else { return }
        do {
            try clearSavedDraft()
            draft = nil
            store.isLocked = false
        } catch { errorMessage = error.localizedDescription }
    }

    func finish(store: ShoppingBasketStore) {
        guard !isBusy, canFinish, let draft else { return }
        do {
            // Keep an immutable demo receipt before allowing another checkout.
            let receiptURL = storageURL.deletingLastPathComponent().appendingPathComponent("checkout-receipt-\(draft.id.uuidString).json")
            try JSONEncoder().encode(draft).write(to: receiptURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
            store.removePaidLines(Set(draft.lines.map(\.id)))
            guard store.isSaved else { throw CheckoutIssue.invalidTotal }
            try clearSavedDraft()
            self.draft = nil
            store.isLocked = false
        } catch { errorMessage = "The receipt couldn’t be saved. Keep this checkout open and try again." }
    }

    private func paymentLedger() throws -> DemoCheckoutLedger {
        if let ledger { return ledger }
        let configured = try DemoCheckoutLedger.configured()
        ledger = configured
        return configured
    }

    private func runStoreTasks() async {
        guard let tasks = draft?.tasks else { return }
        await withTaskGroup(of: Void.self) { group in
            for (index, task) in tasks.enumerated() where task.stage != .demoOrder {
                group.addTask { @MainActor [weak self] in
                    guard let self else { return }
                    // Stagger the visible demo dispatch so every item can be followed.
                    if animateTasks { try? await Task.sleep(for: .milliseconds(index * 350)) }
                    update(task.id, stage: .opening)
                    guard let url = URL(string: task.url), url.scheme == "https", openProductLink(url) else {
                        update(task.id, stage: .failed)
                        return
                    }
                    update(task.id, stage: .opened)
                    if animateTasks { try? await Task.sleep(for: .milliseconds(1400)) }
                    update(task.id, stage: .demoCart)
                    if animateTasks { try? await Task.sleep(for: .milliseconds(1800)) }
                    update(task.id, stage: .demoOrder)
                }
            }
        }
    }

    private func update(_ id: UUID, stage: ShoppingStoreTask.Stage) {
        guard let index = draft?.tasks.firstIndex(where: { $0.id == id }) else { return }
        draft?.tasks[index].stage = stage
        if stage == .opening { draft?.tasks[index].startedAt = Date() }
        do { try save() } catch { errorMessage = "Task progress couldn’t be saved. The sandbox payment ID is retained in the payment ledger." }
    }

    private func save() throws {
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(draft).write(to: storageURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
    }

    private func clearSavedDraft() throws {
        if FileManager.default.fileExists(atPath: storageURL.path) { try FileManager.default.removeItem(at: storageURL) }
    }

    private enum CheckoutIssue: LocalizedError {
        case accountChanged, staleProducts, invalidTotal
        var errorDescription: String? {
            switch self {
            case .accountChanged: return "The selected sandbox account changed. Return to the account used for this checkout."
            case .staleProducts: return "Product prices need a fresh check. Go back and verify the retailer products again."
            case .invalidTotal: return "The checkout total doesn’t match its items. No payment was submitted."
            }
        }
    }
}

struct ShoppingCheckoutView: View {
    @ObservedObject var checkout: ShoppingCheckoutCoordinator
    @ObservedObject var store: ShoppingBasketStore
    let onClose: () -> Void
    private let mint = ShoppingPanelStyle.mint
    private let secondary = ShoppingPanelStyle.secondary

    var body: some View {
        VStack(spacing: 0) {
            ShoppingPanelStyle.header(checkout.canFinish ? "Checkout summary" : "Review your purchase",
                subtitle: "PeppaPrice · Checkout", onClose: onClose)
            if let draft = checkout.draft {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        paymentAccount(draft)
                        if checkout.isBusy {
                            HStack(spacing: 10) {
                                ProgressView().controlSize(.small)
                                Text(checkout.status).font(.system(size: 13)).foregroundStyle(secondary)
                            }
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Text("Your items").font(.system(size: 13, weight: .medium)).foregroundStyle(secondary)
                                Spacer()
                                Text("\(draft.tasks.reduce(0) { $0 + $1.quantity }) items · \(Set(draft.tasks.map(\.merchant)).count) stores")
                                    .font(.system(size: 12)).foregroundStyle(secondary)
                            }
                            ForEach(draft.tasks) { task in
                                taskRow(task, draft: draft)
                                Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
                            }
                        }
                        if let receipt = draft.receipt {
                            DisclosureGroup("Payment details") {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Checkout: \(receipt.checkoutId.uuidString)")
                                    Text("Nessie withdrawal: \(receipt.withdrawalId ?? "Awaiting transaction ID")")
                                    Text("Status: \(receipt.withdrawalStatus ?? "Submitted")")
                                    Text("This is a sandbox payment record, not a merchant receipt.")
                                }.font(.system(size: 12)).foregroundStyle(secondary).textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true).padding(.top, 10)
                            }.font(.system(size: 12)).pointerCursor()
                        }
                        if let error = checkout.errorMessage {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.system(size: 13)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                        }
                    }.padding(.horizontal, 24).padding(.bottom, 24)
                }.frame(minHeight: 0, maxHeight: .infinity)
                footer(draft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white).background(ShoppingPanelStyle.background)
        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 19).strokeBorder(.white.opacity(0.18)))
        .preferredColorScheme(.dark)
    }

    private func paymentAccount(_ draft: ShoppingCheckoutDraft) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "building.columns").font(.system(size: 20, weight: .light)).foregroundStyle(secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Capital One").font(.system(size: 14, weight: .semibold))
                    Text("Nessie sandbox · \(draft.account.nickname)").font(.system(size: 12)).foregroundStyle(secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(draft.receipt == nil ? "Available" : "Before payment").font(.system(size: 11)).foregroundStyle(secondary)
                    Text(BasketProduct.money(draft.receipt?.balanceBeforeCents ?? draft.account.balanceCents))
                        .font(.system(size: 14, weight: .medium)).monospacedDigit()
                }
            }
            if let receipt = draft.receipt {
                Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: receipt.paymentRejected ? "exclamationmark.circle" : (receipt.balanceDeductionObserved || receipt.paymentPosted ? "checkmark.circle" : "clock"))
                    Text(receipt.paymentRejected ? "Payment declined. No retailer order placed." :
                        (receipt.balanceDeductionObserved || receipt.paymentPosted ? "Sandbox payment recorded." : "Payment submitted. Confirmation pending — don’t pay again."))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                }.font(.system(size: 12)).foregroundStyle(receipt.paymentRejected ? .orange : mint)
                if let balance = receipt.observedBalanceCents {
                    HStack { Text("Latest sandbox balance"); Spacer(); Text(BasketProduct.money(balance)).monospacedDigit() }
                        .font(.system(size: 12)).foregroundStyle(secondary)
                }
            }
        }.padding(16).background(.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.1)))
    }

    private func taskRow(_ task: ShoppingStoreTask, draft: ShoppingCheckoutDraft) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ShoppingProductImage(url: draft.lines.first(where: { $0.id == task.id })?.product?.imageURL)
            VStack(alignment: .leading, spacing: 6) {
                Text(task.title).font(.system(size: 14, weight: .medium)).lineLimit(2).help(task.title)
                Text("\(task.merchant) · Qty \(task.quantity)").font(.system(size: 12)).foregroundStyle(secondary)
                if draft.attemptedPayment {
                    Label(task.label, systemImage: task.stage == .demoOrder ? "checkmark.circle" : (task.stage == .failed ? "exclamationmark.circle" : "circle.dotted"))
                        .font(.system(size: 11)).foregroundStyle(task.stage == .failed ? .orange : mint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if task.stage == .failed, let url = URL(string: task.url), url.scheme == "https" {
                    Link("Open product", destination: url).font(.system(size: 12)).foregroundStyle(mint).pointerCursor()
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(BasketProduct.money(task.subtotalCents)).font(.system(size: 14, weight: .medium)).monospacedDigit()
        }
    }

    private func footer(_ draft: ShoppingCheckoutDraft) -> some View {
        VStack(spacing: 14) {
            Rectangle().fill(.white.opacity(0.13)).frame(height: 1)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Item total").font(.system(size: 13)).foregroundStyle(secondary)
                    Text("Shipping and tax excluded").font(.system(size: 11)).foregroundStyle(secondary)
                }
                Spacer()
                Text(BasketProduct.money(draft.totalCents)).font(.system(size: 28, weight: .semibold)).monospacedDigit()
            }
            HStack(spacing: 12) {
                if !draft.attemptedPayment || draft.receipt?.paymentRejected == true {
                    Button { checkout.cancelReview(store: store) } label: {
                        Text("Back").font(.system(size: 13)).frame(width: 70, height: 46)
                    }.buttonStyle(ShoppingQuietButtonStyle()).pointerCursor().disabled(checkout.isBusy)
                }
                Button {
                    if checkout.canFinish && !checkout.isBusy { checkout.finish(store: store) }
                    else { checkout.pay(store: store) }
                } label: {
                    HStack(spacing: 8) {
                        if checkout.isBusy { ProgressView().controlSize(.small) }
                        Text(checkout.isBusy ? "Working…" : (checkout.canFinish ? "Done" : (draft.attemptedPayment ? "Check status" : "Buy it · \(BasketProduct.money(draft.totalCents))")))
                        if !checkout.isBusy { Image(systemName: checkout.canFinish ? "checkmark" : "arrow.right") }
                    }
                }.buttonStyle(ShoppingPrimaryButtonStyle()).pointerCursor()
                    .disabled(checkout.isBusy || draft.receipt?.paymentRejected == true)
            }
            Text("Sandbox payment · Store links open; retailer orders are simulated")
                .font(.system(size: 11)).foregroundStyle(secondary).multilineTextAlignment(.center)
        }.padding(.horizontal, 24).padding(.bottom, 20)
    }
}
