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

    func show() {
        guard let screen = NSScreen.main else { return }
        let size = NSSize(width: min(780, screen.visibleFrame.width - 32), height: min(820, screen.visibleFrame.height - 40))
        if panel == nil {
            let window = CreditSimulationWindow(contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.title = "Flicky credit simulation"
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

struct CreditSimulationView: View {
    @ObservedObject var store: CreditSimulationStore
    let onRefresh: () async -> Void
    let onSources: () -> Void
    let onClose: () -> Void
    @State private var score = ""
    @State private var amount = "10000"
    @State private var income = ""
    @State private var debt = "0"
    @State private var wellsFargoCustomer = false
    @State private var saveHistory = false
    @State private var sortByPayment = false
    @State private var showingHistory = false
    @State private var refreshing = false
    private let accent = Color(red: 0.35, green: 0.94, blue: 0.64)

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "creditcard").font(.system(size: 25, weight: .light)).foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Explore credit options").font(.system(size: 23, weight: .semibold))
                    Text("Simulated soft pull · No bureau request · No score impact")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                }
                Spacer(minLength: 8)
                Button(action: onClose) { Image(systemName: "xmark").frame(width: 30, height: 30) }
                    .buttonStyle(.plain).pointerCursor().accessibilityLabel("Close credit simulation").help("Close (Escape)")
            }.padding(24)
            Divider()
            HStack {
                Button(showingHistory ? "New simulation" : "History (\(store.runs.count))") {
                    if showingHistory { store.resetResult() }
                    showingHistory.toggle()
                }.pointerCursor()
                Spacer()
                Text("Personal loans · USD").foregroundStyle(DS.Colors.textSecondary)
            }.font(.system(size: 12)).padding(.horizontal, 24).padding(.vertical, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let message = store.message {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(.system(size: 13)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    if showingHistory { history } else {
                        if let result = store.result { results(result) } else { inputForm }
                        nessieEvidence
                    }
                }.padding(24)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .foregroundStyle(DS.Colors.textPrimary)
        .background(DS.Colors.background)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DS.Colors.borderSubtle, lineWidth: 1))
        .preferredColorScheme(.dark)
        .onChange(of: store.accountKey) { _, _ in
            score = ""; amount = "10000"; income = ""; debt = "0"
            wellsFargoCustomer = false; saveHistory = false; showingHistory = false
        }
    }

    private var inputForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Try a score. See the cost.").font(.system(size: 19, weight: .semibold))
            Text("Your score stays in this simulator. Flicky checks its range, not its accuracy, and generates a SIM reference instead of an SSN.")
                .font(.system(size: 13)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 16) {
                field("Credit score · 300–850", text: $score, placeholder: "e.g. 720")
                field("Loan amount · USD", text: $amount, placeholder: "10000")
            }
            HStack(alignment: .top, spacing: 16) {
                field("Monthly gross income · USD", text: $income, placeholder: "Before taxes")
                field("Monthly debt payments · USD", text: $debt, placeholder: "0")
            }
            Text("Enter your own monthly figures. Nessie deposits aren’t treated as income. Debt includes existing loan and credit payments; living costs aren’t included.")
                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            Toggle("I’ve been a Wells Fargo customer for at least 12 months", isOn: $wellsFargoCustomer)
                .toggleStyle(.checkbox).font(.system(size: 12)).pointerCursor()
            Toggle("Save this run on this Mac (up to 30 runs per Nessie account)", isOn: $saveHistory)
                .toggleStyle(.checkbox).font(.system(size: 12)).pointerCursor(isEnabled: store.accountKey != nil)
                .disabled(store.accountKey == nil)
            Text(store.accountKey == nil ? "Connect a Nessie account to save history. You can still simulate without one." : "Saved history includes your score, entered amounts, and the displayed sandbox snapshot. Clear it from History.")
                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            Button(action: simulate) {
                HStack { Text("Simulate soft credit pull"); Spacer(); Image(systemName: "arrow.right") }
                    .font(.system(size: 14, weight: .semibold)).padding(14)
                    .foregroundStyle(DS.Colors.background).background(accent, in: RoundedRectangle(cornerRadius: 10))
            }.buttonStyle(.plain).pointerCursor()
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 12, weight: .medium))
            TextField(placeholder, text: text).textFieldStyle(.roundedBorder)
                .font(.system(size: 16)).accessibilityLabel(label).onSubmit(simulate)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func results(_ run: CreditSimulationRun) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your simulated comparison").font(.system(size: 19, weight: .semibold))
                    Text("Score \(run.input.score) · \(CreditSimulationEngine.money(run.input.principalCents)) · \(run.reference)")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                }
                Spacer()
                Button("Edit inputs") {
                    score = String(run.input.score)
                    amount = decimalText(run.input.principalCents)
                    income = decimalText(run.input.monthlyIncomeCents)
                    debt = decimalText(run.input.monthlyDebtCents)
                    wellsFargoCustomer = run.input.wellsFargoCustomer
                    saveHistory = run.savedOnMac
                    store.resetResult()
                }.pointerCursor()
            }
            Text("Hypothetical pricing, not offers or prequalification. Source examples checked \(run.catalogVersion); rates may have changed. Lenders determine actual eligibility and pricing.")
                .font(.system(size: 13)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            Picker("Sort scenarios", selection: $sortByPayment) {
                Text("Lowest total cost").tag(false)
                Text("Lowest monthly payment").tag(true)
            }.pickerStyle(.segmented).pointerCursor()
            let sorted = run.scenarios.sorted {
                let first = sortByPayment ? $0.monthlyPaymentCents : $0.totalPaymentCents
                let second = sortByPayment ? $1.monthlyPaymentCents : $1.totalPaymentCents
                return first == second ? $0.id < $1.id : first < second
            }
            ForEach(sorted) { scenario in
                scenarioRow(scenario, run: run, first: scenario.id == sorted.first?.id)
                Divider()
            }
            if !run.input.wellsFargoCustomer || run.input.principalCents < 1_000_000 {
                Text("Wells Fargo comparison omitted: the modeled published range requires $10,000+ and an existing 12-month customer relationship.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            DisclosureGroup("How this simulation works") {
                Text("Flicky linearly maps scores from 300–850 between each published example’s maximum and minimum APR. This is an illustrative rule, not lender underwriting. Payments assume fixed rates, no origination fee, monthly interest rounded to cents, and timely payments; the last payment clears the balance. Debt / income uses your entered debt plus this payment divided by entered gross income. It does not establish affordability or approval. State, employment, and credit-file requirements are not validated.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            }.font(.system(size: 13)).pointerCursor()
            if let evidence = run.nessie {
                Text("This run captured Nessie sandbox balance \(CreditSimulationEngine.money(evidence.balanceCents)) at \(evidence.observedAt.formatted(date: .abbreviated, time: .shortened)). It did not affect the modeled rate.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No fresh Nessie snapshot was available for this run. Results use only your entered figures.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
            }
        }
    }

    private func scenarioRow(_ scenario: CreditLoanScenario, run: CreditSimulationRun, first: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Label("\(scenario.lender) · \(scenario.months) months", systemImage: "building.columns")
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
                if first { Text(sortByPayment ? "Lowest modeled payment" : "Lowest modeled total").font(.system(size: 11)).foregroundStyle(accent) }
            }
            HStack(alignment: .top, spacing: 24) {
                value("Monthly payment", CreditSimulationEngine.money(scenario.monthlyPaymentCents))
                value("Simulated APR", String(format: "%.2f%%", scenario.annualRatePercent))
                value("Total interest", CreditSimulationEngine.money(scenario.interestCents))
            }
            Text("Total repaid \(CreditSimulationEngine.money(scenario.totalPaymentCents)) · Final payment \(CreditSimulationEngine.money(scenario.finalPaymentCents)) · Debt / gross income \(String(format: "%.1f%%", scenario.debtToIncomePercent))")
                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            Text("Published example: \(scenario.publishedRange). \(scenario.conditions)")
                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button(run.selectedScenarioID == scenario.id ? "Selected for comparison" : "Select scenario") { store.select(scenario.id) }
                    .pointerCursor().accessibilityAddTraits(run.selectedScenarioID == scenario.id ? [.isSelected] : [])
                Spacer()
                if let url = URL(string: scenario.sourceURL), CreditSimulationEngine.allowedSourceURLs.contains(scenario.sourceURL) {
                    Link(destination: url) { Label("Lender source", systemImage: "arrow.up.right") }
                        .font(.system(size: 12)).foregroundStyle(accent).pointerCursor()
                }
            }
        }
    }

    private func value(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 11)).foregroundStyle(DS.Colors.textSecondary)
            Text(text).font(.system(size: 19, weight: .medium)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var nessieEvidence: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            HStack {
                Text("Nessie sandbox context").font(.system(size: 14, weight: .semibold))
                Spacer()
                Button(refreshing ? "Refreshing…" : "Refresh") {
                    refreshing = true
                    Task { await onRefresh(); refreshing = false }
                }.disabled(refreshing || store.accountKey == nil).pointerCursor(isEnabled: !refreshing && store.accountKey != nil)
                Button("API sources", action: onSources).pointerCursor().disabled(store.accountKey == nil)
            }
            if let evidence = store.nessie {
                Text("Observed \(evidence.observedAt.formatted(date: .abbreviated, time: .shortened)) · \(Date().timeIntervalSince(evidence.observedAt) > 300 ? "Stale — refresh to include in a run" : "Sandbox data")")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                HStack(spacing: 24) {
                    value("Balance", CreditSimulationEngine.money(evidence.balanceCents))
                    value("30-day deposits", CreditSimulationEngine.money(evidence.depositsCents))
                    value("30-day withdrawals", CreditSimulationEngine.money(evidence.withdrawalsCents))
                }
                Text("Deposits and withdrawals exclude purchases and transfers. These are historical transactions, not verified income or a credit report.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No account snapshot available. Connect Nessie or refresh; you can simulate using your own inputs meanwhile.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Simulation history").font(.system(size: 19, weight: .semibold))
                Spacer()
                Button("Clear history", role: .destructive) { store.clearHistory() }.pointerCursor()
            }
            Text("Entered scores and hypothetical costs over time. These are scenario changes, not a bureau score history. Unsaved runs last only for this account session.")
                .font(.system(size: 13)).foregroundStyle(DS.Colors.textSecondary).fixedSize(horizontal: false, vertical: true)
            if store.runs.isEmpty {
                Text("No simulations yet. Start a new simulation to compare loan costs.").foregroundStyle(DS.Colors.textSecondary)
            }
            if store.runs.count >= 2, let latest = store.runs.first, let oldest = store.runs.last {
                Text("Across \(store.runs.count) runs, entered score changed from \(oldest.input.score) to \(latest.input.score) (\(latest.input.score - oldest.input.score >= 0 ? "+" : "")\(latest.input.score - oldest.input.score)). Amounts and terms may differ.")
                    .font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(store.runs) { run in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Score \(run.input.score) · \(CreditSimulationEngine.money(run.input.principalCents))").font(.system(size: 14, weight: .medium))
                        Text("\(run.createdAt.formatted(date: .abbreviated, time: .shortened)) · \(store.savedRunIDs.contains(run.id) ? "Saved on this Mac" : "Session only")")
                            .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                        if let chosen = run.scenarios.first(where: { $0.id == run.selectedScenarioID }) {
                            Text("Selected: \(chosen.lender), \(chosen.months) months, \(CreditSimulationEngine.money(chosen.monthlyPaymentCents))/mo")
                                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSecondary)
                        }
                    }
                    Spacer()
                    Button("Review") { store.review(run.id); showingHistory = false }.pointerCursor()
                }
                Divider()
            }
        }
    }

    private func decimalText(_ cents: Int) -> String { String(format: "%.2f", Double(cents) / 100) }
    private func simulate() {
        do {
            let input = try CreditSimulationInput.parse(score: score, amount: amount, income: income, debt: debt, wellsFargoCustomer: wellsFargoCustomer)
            store.run(input: input, save: saveHistory)
        } catch { store.message = error.localizedDescription }
    }
}
