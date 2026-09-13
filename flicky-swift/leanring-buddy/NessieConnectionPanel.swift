import AppKit
import SwiftUI

private final class NessieInspectorWindow: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
final class NessieConnectionPanel {
    private weak var companionManager: CompanionManager?
    private var panel: NSPanel?

    init(companionManager: CompanionManager) { self.companionManager = companionManager }

    func show() {
        guard let companionManager,
              let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main else { return }
        let visibleFrame = screen.visibleFrame
        let size = CGSize(width: min(560, visibleFrame.width - 40), height: min(720, visibleFrame.height - 40))
        let frame = CGRect(x: visibleFrame.midX - size.width / 2, y: visibleFrame.midY - size.height / 2, width: size.width, height: size.height)
        if panel == nil {
            let window = NessieInspectorWindow(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = true
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.isMovableByWindowBackground = true
            let host = NSHostingView(rootView: NessieConnectionView(companionManager: companionManager, onDismiss: { [weak self] in self?.hide() }))
            host.sizingOptions = []
            host.frame = CGRect(origin: .zero, size: size)
            host.autoresizingMask = [.width, .height]
            window.contentView = host
            panel = window
        }
        panel?.setFrame(frame, display: true)
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }
}

struct NessieConnectionView: View {
    @ObservedObject var companionManager: CompanionManager
    let onDismiss: () -> Void
    @State private var didCopy = false
    private let secondary = Color(red: 0.69, green: 0.75, blue: 0.84)

    var body: some View {
        GeometryReader { viewport in
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "network").font(.system(size: 27, weight: .light)).foregroundStyle(.cyan)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("The connection, on record").font(.system(size: 23, weight: .semibold, design: .rounded))
                        Text("Customer, accounts, and the API responses behind PeppaPrice.").font(.system(size: 12)).foregroundStyle(secondary)
                    }
                    Spacer(minLength: 0)
                    Button(action: onDismiss) { Image(systemName: "xmark").frame(width: 28, height: 28) }
                        .buttonStyle(.plain).pointerCursor().accessibilityLabel("Close connection details")
                }.padding(24)
                Divider().overlay(.white.opacity(0.1))
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        identity
                        accounts
                        if let insights = companionManager.financialInsights {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("What PeppaPrice calculates").font(.headline)
                                Text("\(insights.formattedBalance) − \(insights.formatCents(insights.upcomingBills.reduce(0) { $0 + $1.amountCents })) in 14-day bills − $500 reserve = \(insights.formattedSafeToSpend)")
                                    .font(.system(size: 14, weight: .medium)).monospacedDigit().foregroundStyle(.mint)
                                Text("Floored at $0. This calculation is local; the balance and bill records come from the responses below.")
                                    .font(.system(size: 11)).foregroundStyle(secondary)
                            }
                        }
                        requests
                    }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack {
                    Button {
                        Task { await companionManager.refreshFinancialData() }
                    } label: {
                        Label(companionManager.isLoadingFinancials ? "Fetching from Nessie…" : "Refresh from Nessie", systemImage: "arrow.clockwise")
                    }.buttonStyle(.borderedProminent).tint(.blue)
                        .disabled(companionManager.isLoadingFinancials)
                        .pointerCursor(isEnabled: !companionManager.isLoadingFinancials)
                    Spacer()
                    Button(didCopy ? "Copied" : "Copy request log") { copyRequests() }
                        .buttonStyle(.bordered).disabled(companionManager.nessieRequests.isEmpty)
                        .pointerCursor(isEnabled: !companionManager.nessieRequests.isEmpty)
                }.font(.system(size: 12, weight: .medium)).padding(20)
                .background(.white.opacity(0.035))
            }
            .frame(width: viewport.size.width, height: viewport.size.height)
            .background(Color(red: 0.035, green: 0.055, blue: 0.09), in: RoundedRectangle(cornerRadius: 24))
            .clipShape(RoundedRectangle(cornerRadius: 24))
        }
        .foregroundStyle(.white).preferredColorScheme(.dark)
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(companionManager.nessieCustomer?.name ?? "Customer not verified").font(.system(size: 22, weight: .semibold, design: .rounded))
            if let customer = companionManager.nessieCustomer {
                Text("Returned by GET \(companionManager.nessieRequests.first(where: { $0.path.hasSuffix("/customers/" + customer.id) })?.path ?? "/customers/" + customer.id)")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(secondary).textSelection(.enabled)
            }
            Text("Nessie sandbox records. A customer name identifies the API profile; it does not establish a real bank connection.")
                .font(.system(size: 12)).foregroundStyle(secondary)
            if let error = companionManager.financialLoadError {
                Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(.orange)
            }
        }
    }

    private var accounts: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Accounts returned by Nessie · \(companionManager.nessieCustomer?.accounts.count ?? 0)").font(.headline)
            ForEach(companionManager.nessieCustomer?.accounts ?? []) { account in
                Button {
                    Task { await companionManager.selectNessieAccount(account) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: account.id == companionManager.loginState?.accountId ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(account.id == companionManager.loginState?.accountId ? .mint : secondary).padding(.top, 3)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(account.nickname).font(.system(size: 14, weight: .semibold))
                            Text(account.type + (account.last4.map { " · ending " + $0 } ?? "")).font(.system(size: 11)).foregroundStyle(secondary)
                            Text(account.id).font(.system(size: 10, design: .monospaced)).foregroundStyle(secondary)
                        }
                        Spacer(minLength: 8)
                        Text(account.balanceCents.map { String(format: "$%.2f", Double($0) / 100) } ?? "Unavailable")
                            .font(.system(size: 17, weight: .medium, design: .rounded)).monospacedDigit()
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain).disabled(companionManager.isLoadingFinancials)
                    .pointerCursor(isEnabled: !companionManager.isLoadingFinancials)
                    .accessibilityLabel("Select \(account.nickname), \(account.type)")
            }
        }
    }

    private var requests: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Latest refresh · \(companionManager.nessieRequests.count) requests").font(.headline)
                Spacer()
                if companionManager.isLoadingFinancials { ProgressView().controlSize(.small) }
            }
            if let receipt = companionManager.nessieRequests.last {
                Text("HTTPS · \(receipt.host)\nFetched \(receipt.fetchedAt.formatted(date: .abbreviated, time: .standard))")
                    .font(.system(size: 11)).foregroundStyle(secondary).textSelection(.enabled)
            } else {
                Text("No requests recorded yet. Refresh to contact Nessie.").font(.system(size: 12)).foregroundStyle(secondary)
            }
            ForEach(companionManager.nessieRequests) { receipt in
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        if let requestId = receipt.serverRequestId {
                            Text("Server request ID: \(requestId)").font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                        }
                        Text(receipt.responsePreview).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let digest = receipt.responseSHA256 {
                            Text("SHA-256 of received bytes: \(digest)").font(.system(size: 9, design: .monospaced)).textSelection(.enabled)
                        }
                        Text("Preview redacts credentials and full account numbers; limited to 16,000 characters.")
                            .font(.system(size: 10)).foregroundStyle(secondary)
                    }.padding(12).background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("GET " + receipt.path).font(.system(size: 11, design: .monospaced)).lineLimit(2)
                        HStack(spacing: 10) {
                            Text(receipt.statusCode.map { "HTTP \($0)" } ?? "No response")
                                .foregroundStyle((receipt.statusCode.map { (200...299).contains($0) } ?? false) ? .mint : .orange)
                            if let count = receipt.recordCount { Text("\(count) record\(count == 1 ? "" : "s")") }
                            Text("\(receipt.durationMilliseconds) ms")
                        }.font(.system(size: 10)).foregroundStyle(secondary)
                    }.padding(.vertical, 3)
                }.tint(secondary).pointerCursor()
            }
            Text("This is an app-recorded request log, not independent attestation. For a judge demo, compare these IDs and values with a separate Nessie API request.")
                .font(.system(size: 11)).foregroundStyle(secondary)
        }
    }

    private func copyRequests() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(companionManager.nessieRequests), let text = String(data: data, encoding: .utf8) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        didCopy = true
    }
}
