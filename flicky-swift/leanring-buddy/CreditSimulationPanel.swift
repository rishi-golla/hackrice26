import AppKit
import SwiftUI

@MainActor
final class CreditSimulationManager {
    let store = CreditSimulationStore()
    private var panel: NSPanel?
    private let onRefresh: () async -> Void
    private let onSources: () -> Void

    init(onRefresh: @escaping () async -> Void, onSources: @escaping () -> Void) {
        self.onRefresh = onRefresh
        self.onSources = onSources
    }

    func show(request: CreditBorrowingRequest? = nil) {
        if let request { store.borrowingRequest = request }
        guard let screen = NSScreen.main else { return }
        let size = NSSize(width: min(560, screen.visibleFrame.width - 32), height: min(650, screen.visibleFrame.height - 40))
        if panel == nil {
            let window = CreditSimulationWindow(contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.title = "Credit options"
            window.level = .floating
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = true
            window.hidesOnDeactivate = false
            window.isMovableByWindowBackground = true
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            let hosting = NSHostingView(rootView: CreditSimulationView(store: store, onRefresh: onRefresh,
                onSources: onSources, onClose: { [weak self] in self?.hide() }))
            hosting.sizingOptions = []
            window.contentView = hosting
            panel = window
        }
        panel?.setFrame(NSRect(x: screen.visibleFrame.midX - size.width / 2,
            y: screen.visibleFrame.midY - size.height / 2, width: size.width, height: size.height), display: true)
        panel?.makeKeyAndOrderFront(nil)
    }

    func hide() { panel?.orderOut(nil) }
    func reset() { hide(); panel = nil; store.resetSession() }
}

private final class CreditSimulationWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

enum CreditDemoEntry {
    static func accepts(_ value: String) -> Bool {
        value.range(of: #"^000-?[0-9]{2}-?[0-9]{4}$"#, options: .regularExpression) != nil
    }
}

struct CreditBankCard: Identifiable {
    let id: String
    let name: String
    let logo: String
    let description: String
    let rate: String
    let minimumAPR: Double
    let maximumAPR: Double
    let rateContext: String
    let positives: [String]
    let negatives: [String]
    let source: String

    static let banks: [Self] = [
        .init(id: "sofi", name: "SoFi", logo: "CreditSoFiLogo",
              description: "Flexible terms. An online experience.",
              rate: "7.38–35.49%", minimumAPR: 7.38, maximumAPR: 35.49,
              rateContext: "Published: $30,000 / 36 months · discounts included",
              positives: ["No origination fee with this rate option"],
              negatives: ["Lowest rate requires autopay + member discounts"],
              source: CreditSimulationEngine.sofiURL),
        .init(id: "wells", name: "Wells Fargo", logo: "CreditWellsFargoLogo",
              description: "A familiar bank. A relationship requirement.",
              rate: "6.74–26.74%", minimumAPR: 6.74, maximumAPR: 26.74,
              rateContext: "Published: $10,000+ / 36 months · discount included",
              positives: ["No origination, closing or early payoff fee"],
              negatives: ["Requires 12+ months as a customer"],
              source: CreditSimulationEngine.wellsFargoURL),
        .init(id: "amex", name: "American Express", logo: "CreditAmexLogo",
              description: "An option for existing Card Members.",
              rate: "6.99–19.99%", minimumAPR: 6.99, maximumAPR: 19.99,
              rateContext: "Published APR range · available terms vary by offer",
              positives: ["No origination or early payoff fee"],
              negatives: ["Eligible Card Members with an offer only"],
              source: "https://www.americanexpress.com/en-us/banking/personal-loans/"),
        .init(id: "usbank", name: "U.S. Bank", logo: "CreditUSBankLogo",
              description: "Available to new and existing customers.",
              rate: "7.24–24.99%", minimumAPR: 7.24, maximumAPR: 24.99,
              rateContext: "Published APR range · lowest rate has extra conditions",
              positives: ["No origination or early payoff fee"],
              negatives: ["Non-clients: up to $25,000 / 60 months"],
              source: "https://www.usbank.com/loans-credit-lines/personal-loans-and-lines-of-credit/personal-loan.html")
    ]

    func exampleAPR(scoreText: String, requestedRate: Double?) -> Double? {
        if let requestedRate { return requestedRate.isFinite && (0...100).contains(requestedRate) ? requestedRate : nil }
        guard scoreText.count == 3, scoreText.allSatisfy({ $0.isASCII && $0.isNumber }),
              let score = Int(scoreText), (300...850).contains(score) else { return nil }
        return CreditSimulationEngine.modeledRate(score: score, minimum: minimumAPR, maximum: maximumAPR)
    }
}

struct CreditSimulationView: View {
    @ObservedObject var store: CreditSimulationStore
    let onRefresh: () async -> Void
    let onSources: () -> Void
    let onClose: () -> Void
    @State private var dummySSN = ""
    @State private var validationMessage: String?
    @State private var hasEnteredDemo: Bool
    @State private var selectedBankID: String? = "sofi"
    @State private var exampleScore = "720"
    @FocusState private var ssnIsFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let accent = Color(red: 0.35, green: 0.94, blue: 0.64)
    private let caution = Color(red: 1, green: 0.56, blue: 0.58)

    init(store: CreditSimulationStore, onRefresh: @escaping () async -> Void,
         onSources: @escaping () -> Void, onClose: @escaping () -> Void,
         initiallyShowsBanks: Bool = false, initiallySelectedBank: String = "sofi") {
        self.store = store
        self.onRefresh = onRefresh
        self.onSources = onSources
        self.onClose = onClose
        _hasEnteredDemo = State(initialValue: initiallyShowsBanks || store.borrowingRequest != nil)
        _selectedBankID = State(initialValue: initiallySelectedBank)
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                HStack {
                    if hasEnteredDemo {
                        Text("Meet your options").font(.system(size: 25, weight: .semibold))
                    }
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .medium))
                            .frame(width: 32, height: 32).contentShape(Rectangle())
                    }.buttonStyle(.plain).pointerCursor().accessibilityLabel("Close credit options").help("Close (Escape)")
                }.padding(.horizontal, 30).frame(height: 64)
                if hasEnteredDemo { bankCarousel } else { entry }
            }
            .frame(width: 560, height: 650, alignment: .top)
            .scaleEffect(min(1, geometry.size.width / 560, geometry.size.height / 650))
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .foregroundStyle(DS.Colors.textPrimary)
        .background(DS.Colors.background)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DS.Colors.borderSubtle, lineWidth: 1))
        .preferredColorScheme(.dark)
        .onChange(of: store.accountKey) { _, _ in resetEntry() }
        .onChange(of: store.borrowingRequest) { _, request in
            if request != nil {
                dummySSN = ""
                validationMessage = nil
                hasEnteredDemo = true
                selectedBankID = CreditBankCard.banks.first?.id
            }
        }
        .onDisappear { dummySSN = "" }
    }

    private var entry: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "person.crop.rectangle")
                    .font(.system(size: 34, weight: .light)).foregroundStyle(accent).padding(.bottom, 26)
                Text("Credit options").font(.system(size: 32, weight: .semibold))
                Text("A little clarity before your next move.")
                    .font(.system(size: 15)).foregroundStyle(DS.Colors.textSecondary).padding(.top, 10)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Access code").font(.system(size: 13, weight: .medium))
                    TextField("000-12-3456", text: $dummySSN)
                        .textFieldStyle(.plain).font(.system(size: 22)).monospacedDigit()
                        .padding(16).background(DS.Colors.surface1, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(ssnIsFocused ? accent : DS.Colors.borderSubtle, lineWidth: 1))
                        .focused($ssnIsFocused).accessibilityLabel("Access code")
                        .accessibilityHint("Enter a code beginning with 000, such as 000-12-3456")
                        .onSubmit(enterDemo)
                        .onChange(of: dummySSN) { _, value in
                            dummySSN = String(value.filter { "0123456789-".contains($0) }.prefix(11))
                            validationMessage = nil
                        }
                    Text("Start with 000 · Do not enter an SSN")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                }.padding(.top, 36)
                if let validationMessage {
                    Label(validationMessage, systemImage: "exclamationmark.circle")
                        .font(.system(size: 12)).foregroundStyle(caution).padding(.top, 12)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(action: enterDemo) {
                    HStack {
                        Spacer()
                        Text("Validate & continue")
                        Image(systemName: "arrow.right")
                        Spacer()
                    }.font(.system(size: 14, weight: .semibold)).padding(16)
                        .foregroundStyle(DS.Colors.background)
                        .background(accent, in: RoundedRectangle(cornerRadius: 10))
                }.buttonStyle(.plain).pointerCursor().padding(.top, 22)
                    .keyboardShortcut(.defaultAction)
                Text("Your code stays on this screen and is cleared when you continue.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                    .lineSpacing(4).fixedSize(horizontal: false, vertical: true).padding(.top, 18)
            }.frame(maxWidth: 390, alignment: .leading)
                .frame(maxWidth: .infinity).padding(.horizontal, 32).padding(.top, 18).padding(.bottom, 24)
        }
    }

    private var bankCarousel: some View {
        VStack(spacing: 0) {
            ZStack {
                ForEach(Array(CreditBankCard.banks.enumerated()), id: \.element.id) { index, bank in
                    let isSelected = index == selectedBankIndex
                    bankCard(bank)
                        .frame(width: 448, height: 486)
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(isSelected ? Color.clear : Color.white.opacity(0.16), lineWidth: 1))
                        .scaleEffect(isSelected ? 1 : 0.94)
                        .offset(x: isSelected ? -16 : 40, y: isSelected ? 0 : 14)
                        .opacity(isSelected ? 1 : 0.45)
                        .blur(radius: isSelected ? 0 : 1.5)
                        .zIndex(isSelected ? 1 : 0)
                        .allowsHitTesting(isSelected)
                        .accessibilityHidden(!isSelected)
                }
            }.frame(height: 514).frame(maxWidth: .infinity)
            HStack {
                Button("Back") { resetEntry() }.buttonStyle(.plain).pointerCursor()
                    .foregroundStyle(DS.Colors.textSecondary)
                Spacer()
                carouselArrow("chevron.left", label: "Previous bank", direction: -1)
                HStack(spacing: 6) {
                    ForEach(CreditBankCard.banks.indices, id: \.self) { index in
                        Capsule().fill(index == selectedBankIndex ? accent : DS.Colors.textSecondary.opacity(0.3))
                            .frame(width: index == selectedBankIndex ? 18 : 6, height: 6)
                    }
                }.frame(width: 64).accessibilityElement(children: .ignore)
                    .accessibilityLabel("Bank \(selectedBankIndex + 1) of \(CreditBankCard.banks.count)")
                carouselArrow("chevron.right", label: "Next bank", direction: 1)
            }.font(.system(size: 12)).padding(.horizontal, 38).frame(height: 48)
        }
    }

    private func bankCard(_ bank: CreditBankCard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 14) {
                Image(nsImage: NSImage(named: bank.logo) ?? NSImage()).resizable().scaledToFit()
                    .padding(bank.id == "sofi" || bank.id == "usbank" ? 8 : 0)
                    .frame(width: 64, height: 48)
                    .background(.white, in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("\(bank.name) logo")
                VStack(alignment: .leading, spacing: 4) {
                    Text(bank.name).font(.system(size: 21, weight: .semibold))
                    Text("Personal loan").font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                }
            }
            Text(scenarioSummary).font(.system(size: 14, weight: .medium))
                .foregroundStyle(accent).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(exampleRate(bank).map { String(format: "%.2f%%", $0) } ?? "—")
                        .font(.system(size: 29, weight: .medium)).monospacedDigit()
                    Text(store.borrowingRequest?.annualRatePercent == nil ? "Estimated APR" : "Requested APR")
                        .font(.system(size: 11)).foregroundStyle(DS.Colors.textSecondary)
                }
                Text("Published APR: \(bank.rate)").font(.system(size: 11)).foregroundStyle(DS.Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(bank.rateContext)
            }.padding(.vertical, 3)
            HStack(spacing: 28) {
                metric("Monthly payment", cents: examplePayments(bank)?.monthly)
                metric("Total interest", cents: examplePayments(bank).map { $0.total - scenarioAmount })
            }
            HStack(spacing: 8) {
                Text("Credit score").font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                TextField("720", text: $exampleScore).textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 5).frame(width: 52)
                    .background(DS.Colors.background, in: RoundedRectangle(cornerRadius: 6))
                    .accessibilityLabel("Credit score for estimate, 300 to 850")
                    .help("Enter a score to recalculate all four estimates. The starting value is 720; no credit report is accessed.")
            }
            Text(store.borrowingRequest?.annualRatePercent != nil
                 ? "Uses your requested rate; score does not change it."
                 : exampleRate(bank) == nil ? "Enter a score from 300 to 850."
                 : "A higher score lowers your estimated APR.")
                .font(.system(size: 11)).foregroundStyle(DS.Colors.textSecondary)
            Divider()
            tradeoffs(bank.positives, symbol: "plus.circle.fill", color: accent)
            tradeoffs(bank.negatives, symbol: "minus.circle.fill", color: caution)
            Spacer(minLength: 0)
            Text("Estimates exclude fees · lender confirms final terms")
                .font(.system(size: 10)).foregroundStyle(DS.Colors.textSecondary)
            if let url = URL(string: bank.source) {
                Link(destination: url) {
                    HStack { Text("View bank terms"); Image(systemName: "arrow.up.right") }
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.Colors.textPrimary)
                }.pointerCursor().help("Published rates checked September 13, 2026. View current lender terms.")
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(DS.Colors.surface1, in: RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.18), radius: 12, x: 0, y: 8)
    }

    private var scenarioAmount: Int { store.borrowingRequest?.principalCents ?? 800_000 }
    private var scenarioMonths: Int { store.borrowingRequest?.months ?? 36 }
    private var scenarioSummary: String {
        let amount = CreditSimulationEngine.money(scenarioAmount)
        return "\(amount) · \(scenarioMonths) months"
    }
    private func exampleRate(_ bank: CreditBankCard) -> Double? {
        bank.exampleAPR(scoreText: exampleScore, requestedRate: store.borrowingRequest?.annualRatePercent)
    }
    private func examplePayments(_ bank: CreditBankCard) -> (monthly: Int, final: Int, total: Int)? {
        guard let rate = exampleRate(bank) else { return nil }
        return try? CreditSimulationEngine.payments(principalCents: scenarioAmount, annualRatePercent: rate, months: scenarioMonths)
    }
    private func metric(_ title: String, cents: Int?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(cents.map(CreditSimulationEngine.money) ?? "—").font(.system(size: 18, weight: .medium)).monospacedDigit()
            Text(title).font(.system(size: 11)).foregroundStyle(DS.Colors.textSecondary)
        }
    }

    private func tradeoffs(_ items: [String], symbol: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(items, id: \.self) { item in
                Label(item, systemImage: symbol).font(.system(size: 13)).foregroundStyle(color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var selectedBankIndex: Int {
        CreditBankCard.banks.firstIndex { $0.id == selectedBankID } ?? 0
    }

    private func carouselArrow(_ symbol: String, label: String, direction: Int) -> some View {
        let nextIndex = (selectedBankIndex + direction + CreditBankCard.banks.count) % CreditBankCard.banks.count
        return Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.86)) {
                selectedBankID = CreditBankCard.banks[nextIndex].id
            }
        } label: {
            Image(systemName: symbol).frame(width: 34, height: 34).contentShape(Rectangle())
                .background(DS.Colors.surface1, in: Circle())
        }.buttonStyle(.plain).pointerCursor().accessibilityLabel(label)
            .keyboardShortcut(direction < 0 ? .leftArrow : .rightArrow, modifiers: [])
    }

    private func enterDemo() {
        guard CreditDemoEntry.accepts(dummySSN) else {
            validationMessage = "Enter an access code such as 000-12-3456."
            return
        }
        dummySSN = ""
        ssnIsFocused = false
        validationMessage = nil
        selectedBankID = CreditBankCard.banks.first?.id
        hasEnteredDemo = true
    }

    private func resetEntry() {
        exampleScore = "720"
        store.borrowingRequest = nil
        dummySSN = ""
        validationMessage = nil
        hasEnteredDemo = false
        selectedBankID = CreditBankCard.banks.first?.id
    }
}
