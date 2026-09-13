// NessieSimulation.swift — deterministic synthetic peer comparison demo

import Foundation
import SwiftUI

// MARK: - Fixture Models

struct SimulationCohort: Codable {
    let schemaVersion: Int
    let syntheticData: Bool
    let label: String
    let seed: Int
    let asOf: String
    let currency: String
    let historyMonths: Int
    let historyConvention: String
    let profiles: [SimulationProfile]

    static func load(bundle: Bundle = .main) -> SimulationCohort? {
        guard let url = bundle.url(forResource: "financial-cohort", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cohort = try? JSONDecoder().decode(SimulationCohort.self, from: data),
              cohort.schemaVersion == 1,
              cohort.syntheticData,
              !cohort.profiles.isEmpty else {
            return nil
        }
        return cohort
    }
}

struct SimulationProfile: Codable, Identifiable {
    let id: String
    let displayName: String
    let archetype: String
    let monthlyIncomeCents: Int
    let monthlyEssentialCents: Int
    let monthlyDiscretionaryCents: Int
    let liquidSavingsCents: Int
    let openingBalanceCents: Int
    let closingBalanceCents: Int
    let transactions: [SimulationTransaction]

    var monthlySurplusCents: Int {
        monthlyIncomeCents - monthlyEssentialCents - monthlyDiscretionaryCents
    }

    var essentialExpenseRatio: Double? {
        guard monthlyIncomeCents > 0 else { return nil }
        return Double(monthlyEssentialCents) / Double(monthlyIncomeCents)
    }

    var savingsRate: Double? {
        guard monthlyIncomeCents > 0 else { return nil }
        return Double(monthlySurplusCents) / Double(monthlyIncomeCents)
    }

    var emergencyCoverageMonths: Double? {
        guard monthlyEssentialCents > 0 else { return nil }
        return Double(liquidSavingsCents) / Double(monthlyEssentialCents)
    }
}

struct SimulationTransaction: Codable, Identifiable {
    let date: String
    let type: String
    let category: String
    let label: String
    let amountCents: Int

    var id: String { "\(date)-\(label)-\(amountCents)" }
}

struct SimulationMetrics {
    let monthlySurplusCents: Int
    let savingsRate: Double?
    let emergencyCoverageMonths: Double?
}

enum SimulationPeerScope {
    case focused
    case expanded
    case full

    var label: String {
        switch self {
        case .focused: return "income + essential-spend match"
        case .expanded: return "broader income + essential-spend match"
        case .full: return "full synthetic cohort"
        }
    }
}

struct SimulationPeerGroup {
    let profiles: [SimulationProfile]
    let scope: SimulationPeerScope

    var label: String { "Simulated peer group · \(profiles.count) profiles · \(scope.label)" }
}

struct SimulationProjection {
    let purchaseCents: Int
    let requestedReductionCents: Int
    let effectiveReductionCents: Int
    let goalCents: Int
    let horizonMonths: Int
    let baselineEndBalanceCents: Int
    let scenarioEndBalanceCents: Int
    let baselineGoalMonth: Int?
    let scenarioGoalMonth: Int?
    let baselineMonthlySurplusCents: Int
    let scenarioMonthlySurplusCents: Int
    let purchaseExceedsSavings: Bool
}

enum NessieSimulationCalculator {
    static let minimumPeerCount = 20
    static let focusedIncomeTolerance = 0.20
    static let focusedBurdenTolerance = 0.10
    static let expandedIncomeTolerance = 0.40
    static let expandedBurdenTolerance = 0.20
    static let defaultHorizonMonths = 3
    static let maxGoalMonths = 24

    static func metrics(for profile: SimulationProfile) -> SimulationMetrics {
        SimulationMetrics(
            monthlySurplusCents: profile.monthlySurplusCents,
            savingsRate: profile.savingsRate,
            emergencyCoverageMonths: profile.emergencyCoverageMonths
        )
    }

    static func peerGroup(for selected: SimulationProfile, in cohort: SimulationCohort) -> SimulationPeerGroup {
        let candidates = cohort.profiles.filter { $0.id != selected.id }

        func matches(incomeTolerance: Double, burdenTolerance: Double) -> [SimulationProfile] {
            guard selected.monthlyIncomeCents > 0,
                  let selectedBurden = selected.essentialExpenseRatio else { return [] }
            return candidates.filter { candidate in
                guard let candidateBurden = candidate.essentialExpenseRatio else { return false }
                let incomeDifference = abs(Double(candidate.monthlyIncomeCents - selected.monthlyIncomeCents))
                    / Double(selected.monthlyIncomeCents)
                return incomeDifference <= incomeTolerance
                    && abs(candidateBurden - selectedBurden) <= burdenTolerance
            }
        }

        let focused = matches(
            incomeTolerance: focusedIncomeTolerance,
            burdenTolerance: focusedBurdenTolerance
        )
        if focused.count >= minimumPeerCount {
            return SimulationPeerGroup(profiles: focused, scope: .focused)
        }

        let expanded = matches(
            incomeTolerance: expandedIncomeTolerance,
            burdenTolerance: expandedBurdenTolerance
        )
        if expanded.count >= minimumPeerCount {
            return SimulationPeerGroup(profiles: expanded, scope: .expanded)
        }

        return SimulationPeerGroup(profiles: candidates, scope: .full)
    }

    /// Percentile with midpoint ties: below + half of equal values.
    static func percentile(value: Double, among values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let below = values.filter { $0 < value }.count
        let equal = values.filter { $0 == value }.count
        return (Double(below) + Double(equal) * 0.5) / Double(values.count) * 100
    }

    static func percentileForBalance(
        _ balanceCents: Int,
        peers: SimulationPeerGroup,
        horizonMonths: Int
    ) -> Double? {
        let peerBalances = peers.profiles.map {
            Double($0.liquidSavingsCents + horizonMonths * $0.monthlySurplusCents)
        }
        return percentile(value: Double(balanceCents), among: peerBalances)
    }

    static func projection(
        for selected: SimulationProfile,
        purchaseCents: Int,
        discretionaryReductionCents: Int,
        goalCents: Int,
        horizonMonths: Int = defaultHorizonMonths
    ) -> SimulationProjection {
        let safePurchase = max(0, purchaseCents)
        let safeGoal = max(0, goalCents)
        let requestedReduction = max(0, discretionaryReductionCents)
        let effectiveReduction = min(requestedReduction, selected.monthlyDiscretionaryCents)
        let baselineSurplus = selected.monthlySurplusCents
        let scenarioSurplus = baselineSurplus + effectiveReduction
        let goalBalance = selected.liquidSavingsCents + safeGoal

        return SimulationProjection(
            purchaseCents: safePurchase,
            requestedReductionCents: requestedReduction,
            effectiveReductionCents: effectiveReduction,
            goalCents: safeGoal,
            horizonMonths: max(0, horizonMonths),
            baselineEndBalanceCents: selected.liquidSavingsCents + max(0, horizonMonths) * baselineSurplus,
            scenarioEndBalanceCents: selected.liquidSavingsCents - safePurchase
                + max(0, horizonMonths) * scenarioSurplus,
            baselineGoalMonth: goalMonth(
                startingBalanceCents: selected.liquidSavingsCents,
                monthlySurplusCents: baselineSurplus,
                targetBalanceCents: goalBalance
            ),
            scenarioGoalMonth: goalMonth(
                startingBalanceCents: selected.liquidSavingsCents - safePurchase,
                monthlySurplusCents: scenarioSurplus,
                targetBalanceCents: goalBalance
            ),
            baselineMonthlySurplusCents: baselineSurplus,
            scenarioMonthlySurplusCents: scenarioSurplus,
            purchaseExceedsSavings: safePurchase > max(0, selected.liquidSavingsCents)
        )
    }

    /// Returns 0 when the goal is already met, otherwise the first whole
    /// month within the fixed 24-month demo horizon, or nil when unreachable.
    static func goalMonth(
        startingBalanceCents: Int,
        monthlySurplusCents: Int,
        targetBalanceCents: Int,
        maxMonths: Int = maxGoalMonths
    ) -> Int? {
        let target = targetBalanceCents
        if startingBalanceCents >= target { return 0 }
        guard monthlySurplusCents > 0 else { return nil }

        for month in 1...max(1, maxMonths) {
            if startingBalanceCents + month * monthlySurplusCents >= target {
                return month
            }
        }
        return nil
    }

    static func parseCents(_ text: String) -> Int? {
        let cleaned = text
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty,
              let decimal = Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX")),
              decimal >= 0 else { return nil }

        let cents = NSDecimalNumber(decimal: decimal * 100).intValue
        return cents >= 0 ? cents : nil
    }

    static func formatCents(_ cents: Int) -> String {
        String(format: "$%.2f", Double(cents) / 100.0)
    }

    static func formatPercent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.0f%%", value * 100)
    }
}

// MARK: - Scenario View

struct NessieSimulationView: View {
    @ObservedObject var companionManager: CompanionManager

    @State private var purchaseText = "180"
    @State private var reductionText = "0"
    @State private var goalText = "600"

    private var cohort: SimulationCohort? { companionManager.simulationCohort }
    private var selectedProfile: SimulationProfile? { cohort?.profiles.first }
    private var peerGroup: SimulationPeerGroup? {
        guard let cohort, let selectedProfile else { return nil }
        return NessieSimulationCalculator.peerGroup(for: selectedProfile, in: cohort)
    }
    private var purchaseCents: Int? { NessieSimulationCalculator.parseCents(purchaseText) }
    private var reductionCents: Int? { NessieSimulationCalculator.parseCents(reductionText) }
    private var goalCents: Int? { NessieSimulationCalculator.parseCents(goalText) }
    private var projection: SimulationProjection? {
        guard let selectedProfile, let purchaseCents, let reductionCents, let goalCents else { return nil }
        return NessieSimulationCalculator.projection(
            for: selectedProfile,
            purchaseCents: purchaseCents,
            discretionaryReductionCents: reductionCents,
            goalCents: goalCents
        )
    }

    var body: some View {
        if let cohort, let selectedProfile, let peerGroup {
            content(cohort: cohort, selected: selectedProfile, peers: peerGroup)
                .onAppear(perform: syncProposedPurchase)
                .onChange(of: companionManager.proposedSimulationPurchaseCents) { _ in
                    syncProposedPurchase()
                }
        } else {
            unavailableState
        }
    }

    private func content(
        cohort: SimulationCohort,
        selected: SimulationProfile,
        peers: SimulationPeerGroup
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Purchase impact simulator")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(DS.Colors.textPrimary)
                    Text("Nessie-backed demo account · local fixture for the peer comparison")
                        .font(.system(size: 10))
                        .foregroundColor(DS.Colors.textTertiary)
                }
                Spacer()
                Text("SIMULATED")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(DS.Colors.blue400)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(DS.Colors.blue400.opacity(0.12)))
            }

            Text("See where \(selected.displayName) fits, then test a purchase or spending change. The peer group is fictional and held constant while you adjust the scenario.")
                .font(.system(size: 11))
                .foregroundColor(DS.Colors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if let liveInsights = companionManager.financialInsights {
                Text("Live Nessie balance: \(NessieSimulationCalculator.formatCents(liveInsights.balanceCents)) · calculations use the comparable three-month demo profile below.")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            profileCard(selected: selected)
            peerComparisonCard(selected: selected, peers: peers)
            scenarioInputs(selected: selected)

            if let projection {
                scenarioResultCard(projection: projection, selected: selected, peers: peers)
            } else {
                Text("Enter non-negative dollar amounts to calculate the scenario.")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.warning)
            }

            Text("Assumptions: unchanged income and essential expenses, no interest or market returns, no unexpected expenses. A purchase is charged once. A cut is applied monthly and capped at discretionary spending.")
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            Text("Fixture seed \(cohort.seed) · \(cohort.historyConvention)")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(DS.Colors.textTertiary)
        }
    }

    private var unavailableState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 24))
                .foregroundColor(DS.Colors.textTertiary)
            Text("Simulation fixture unavailable")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(DS.Colors.textPrimary)
            Text("Run scripts/generate_financial_cohort.py and rebuild the app to add the local simulated peer group.")
                .font(.system(size: 11))
                .foregroundColor(DS.Colors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(cardBackground)
        .overlay(cardBorder)
    }

    private func profileCard(selected: SimulationProfile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionLabel("SELECTED DEMO PROFILE")
                Spacer()
                Text(selected.archetype)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(DS.Colors.textTertiary)
            }
            HStack(spacing: 8) {
                compactMetric(label: "Monthly income", value: NessieSimulationCalculator.formatCents(selected.monthlyIncomeCents))
                compactMetric(label: "Essential", value: NessieSimulationCalculator.formatCents(selected.monthlyEssentialCents))
                compactMetric(label: "Discretionary", value: NessieSimulationCalculator.formatCents(selected.monthlyDiscretionaryCents))
            }
        }
        .padding(12)
        .background(cardBackground)
        .overlay(cardBorder)
    }

    private func peerComparisonCard(selected: SimulationProfile, peers: SimulationPeerGroup) -> some View {
        let baselineBalance = selected.liquidSavingsCents
            + NessieSimulationCalculator.defaultHorizonMonths * selected.monthlySurplusCents
        let percentile = NessieSimulationCalculator.percentileForBalance(
            baselineBalance,
            peers: peers,
            horizonMonths: NessieSimulationCalculator.defaultHorizonMonths
        ) ?? 0

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionLabel("WHERE YOU FIT")
                Spacer()
                Text(peers.label)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(DS.Colors.textTertiary)
            }
            Text("About the \(ordinalPercentile(percentile)) percentile for projected savings after 3 months")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(DS.Colors.textPrimary)
            percentileBar(percentile: percentile, color: DS.Colors.blue400)
            Text("This is a simulated peer group, not a ranking of real bank customers.")
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
        }
        .padding(12)
        .background(cardBackground)
        .overlay(cardBorder)
    }

    private func scenarioInputs(selected: SimulationProfile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("TEST A SCENARIO")
            HStack(spacing: 8) {
                currencyField(title: "One-time purchase", placeholder: "$180", text: $purchaseText, label: "One-time purchase amount")
                currencyField(title: "Monthly cut", placeholder: "$0", text: $reductionText, label: "Monthly discretionary spending reduction")
                currencyField(title: "Savings goal", placeholder: "$600", text: $goalText, label: "Additional savings goal")
            }
            if let reductionCents, reductionCents > selected.monthlyDiscretionaryCents {
                Text("Monthly cut capped at \(NessieSimulationCalculator.formatCents(selected.monthlyDiscretionaryCents)) of discretionary spending.")
                    .font(.system(size: 9))
                    .foregroundColor(DS.Colors.warning)
            }
        }
        .padding(12)
        .background(cardBackground)
        .overlay(cardBorder)
    }

    private func scenarioResultCard(
        projection: SimulationProjection,
        selected: SimulationProfile,
        peers: SimulationPeerGroup
    ) -> some View {
        let baselinePercentile = NessieSimulationCalculator.percentileForBalance(
            projection.baselineEndBalanceCents,
            peers: peers,
            horizonMonths: projection.horizonMonths
        ) ?? 0
        let scenarioPercentile = NessieSimulationCalculator.percentileForBalance(
            projection.scenarioEndBalanceCents,
            peers: peers,
            horizonMonths: projection.horizonMonths
        ) ?? 0

        return VStack(alignment: .leading, spacing: 9) {
            HStack {
                sectionLabel("PROJECTED RESULT")
                Spacer()
                Text("3-month horizon")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(DS.Colors.textTertiary)
            }
            HStack(spacing: 8) {
                resultMetric(
                    label: "Baseline surplus",
                    value: NessieSimulationCalculator.formatCents(projection.baselineMonthlySurplusCents),
                    color: DS.Colors.textPrimary
                )
                resultMetric(
                    label: "Scenario surplus",
                    value: NessieSimulationCalculator.formatCents(projection.scenarioMonthlySurplusCents),
                    color: DS.Colors.success
                )
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Projected savings after 3 months")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(DS.Colors.textSecondary)
                HStack {
                    Text("Baseline  \(NessieSimulationCalculator.formatCents(projection.baselineEndBalanceCents)) · \(ordinalPercentile(baselinePercentile)) percentile")
                    Spacer()
                    Text("Scenario  \(NessieSimulationCalculator.formatCents(projection.scenarioEndBalanceCents)) · \(ordinalPercentile(scenarioPercentile))")
                }
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
                percentileBar(percentile: scenarioPercentile, color: DS.Colors.success)
            }

            Text(goalSummary(projection: projection))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(projection.purchaseExceedsSavings ? DS.Colors.warning : DS.Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            if projection.purchaseExceedsSavings {
                Text("This purchase exceeds the selected profile's current liquid savings. The projection shows the result for demonstration; it does not authorize or simulate a transaction.")
                    .font(.system(size: 9))
                    .foregroundColor(DS.Colors.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(cardBackground)
        .overlay(cardBorder)
    }

    private func currencyField(
        title: String,
        placeholder: String,
        text: Binding<String>,
        label: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(DS.Colors.textTertiary)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11))
                .frame(minWidth: 0, maxWidth: .infinity)
                .accessibilityLabel(label)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func compactMetric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(DS.Colors.textPrimary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func resultMetric(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
            Text("\(value)/mo")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func percentileBar(percentile: Double, color: Color) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08))
                Capsule()
                    .fill(color.opacity(0.8))
                    .frame(width: proxy.size.width * min(1, max(0, percentile / 100)))
            }
        }
        .frame(height: 7)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Simulated peer percentile")
        .accessibilityValue(String(format: "%.0f percent", percentile))
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(DS.Colors.textTertiary)
            .tracking(0.5)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.white.opacity(0.04))
    }

    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
    }

    private func goalSummary(projection: SimulationProjection) -> String {
        let baseline = goalTiming(projection.baselineGoalMonth)
        let scenario = goalTiming(projection.scenarioGoalMonth)
        if baseline == scenario {
            return "Savings goal: \(scenario) under this scenario."
        }
        return "Savings goal: \(baseline) baseline → \(scenario) with this scenario."
    }

    private func goalTiming(_ month: Int?) -> String {
        guard let month else { return "not reached within 24 months" }
        return month == 0 ? "already reached" : "\(month) month\(month == 1 ? "" : "s")"
    }

    private func ordinalPercentile(_ percentile: Double) -> String {
        let rounded = Int(percentile.rounded())
        let suffix: String = {
            if (11...13).contains(rounded % 100) { return "th" }
            switch rounded % 10 {
            case 1: return "st"
            case 2: return "nd"
            case 3: return "rd"
            default: return "th"
            }
        }()
        return "\(rounded)\(suffix)"
    }

    private func syncProposedPurchase() {
        guard let cents = companionManager.proposedSimulationPurchaseCents else { return }
        purchaseText = String(format: "%.2f", Double(cents) / 100.0)
    }
}
