// FinancialInsightsDashboardManager.swift — Flicky financial insights dashboard
//
// A toggleable, non-fullscreen NSPanel that gives the user a rich, always-
// available "second screen" for their financial data — pulling everything
// already sitting in `CompanionManager.financialInsights` (from the Nessie
// API) and presenting it as three focused tabs (Overview, Spending, Bills)
// instead of one long undifferentiated scroll. Beyond the raw numbers Nessie
// returns, this dashboard computes and visualizes things no other surface in
// the app shows: a composite financial health score, a forward-looking
// "runway" projection, and a real spending-by-category breakdown sourced
// from Nessie's purchases + merchants data — see `FinancialModels.swift` for
// how those are derived.
//
// This is intentionally a toggle, not a fixed window: the user asked for
// "somewhere they can access it at any time" without it "covering the whole
// screen" — so it opens/closes on demand, either from a button in the menu
// bar panel or from Flicky itself via the [INSIGHTS] response tag.

import AppKit
import Charts
import Combine
import SwiftUI

extension Notification.Name {
    static let flickyDismissInsightsDashboard = Notification.Name("flickyDismissInsightsDashboard")
}

// MARK: - Dashboard Manager

@MainActor
final class FinancialInsightsDashboardManager: NSObject {
    private let companionManager: CompanionManager
    private var dashboardPanel: NSPanel?
    private var dismissObserver: NSObjectProtocol?

    private let dashboardSize = NSSize(width: 460, height: 700)

    init(companionManager: CompanionManager) {
        self.companionManager = companionManager
        super.init()
        dismissObserver = NotificationCenter.default.addObserver(
            forName: .flickyDismissInsightsDashboard,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.hide()
        }
    }

    deinit {
        if let dismissObserver {
            NotificationCenter.default.removeObserver(dismissObserver)
        }
    }

    var isVisible: Bool {
        dashboardPanel?.isVisible ?? false
    }

    func toggle() {
        if isVisible {
            hide()
        } else {
            show()
        }
    }

    /// Shows the dashboard, centered on the main screen but sized well short
    /// of full-screen so the user's other work stays visible around it.
    func show() {
        guard let targetScreen = NSScreen.main else { return }
        createPanelIfNeeded(onScreen: targetScreen)
        guard let panel = dashboardPanel else { return }

        if !panel.isVisible {
            let vis = targetScreen.visibleFrame
            let originX = vis.midX - dashboardSize.width / 2
            let originY = vis.midY - dashboardSize.height / 2
            panel.setFrame(NSRect(origin: CGPoint(x: originX, y: originY), size: dashboardSize), display: false)
            panel.alphaValue = 0
        }

        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            panel.animator().alphaValue = 1
        }
    }

    func hide() {
        guard let panel = dashboardPanel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.15
            panel.animator().alphaValue = 0
        }, completionHandler: {
            panel.orderOut(nil)
        })
    }

    // MARK: - Private

    private func createPanelIfNeeded(onScreen screen: NSScreen) {
        if dashboardPanel != nil { return }

        let initialFrame = NSRect(origin: .zero, size: dashboardSize)
        let panel = NSPanel(
            contentRect: initialFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let hostingView = NSHostingView(
            rootView: FinancialInsightsDashboardView(companionManager: companionManager)
        )
        hostingView.frame = initialFrame
        panel.contentView = hostingView

        dashboardPanel = panel
    }
}

// MARK: - Dashboard Tabs

/// The three focused sections of the dashboard. Splitting into tabs (instead
/// of one long scroll, which is what this dashboard used to be) keeps each
/// screen legible even as the amount of financial content Flicky surfaces
/// keeps growing — health score and runway in Overview, the category
/// breakdown in Spending, and bills/subscriptions/rewards in Bills.
private enum DashboardTab: String, CaseIterable, Identifiable {
    case overview
    case spending
    case bills

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .spending: return "Spending"
        case .bills: return "Bills"
        }
    }

    var iconSystemName: String {
        switch self {
        case .overview: return "square.grid.2x2"
        case .spending: return "chart.pie"
        case .bills: return "calendar"
        }
    }
}

// MARK: - Dashboard View

private struct FinancialInsightsDashboardView: View {
    @ObservedObject var companionManager: CompanionManager
    @State private var selectedTab: DashboardTab = .overview

    /// A rotating set of colors used to distinguish spending categories from
    /// one another in the Spending tab — deliberately varied beyond the
    /// app's usual success/warning/destructive trio since a category
    /// breakdown needs more distinct hues than a status indicator does.
    private let categoryColorPalette: [Color] = [
        DS.Colors.blue400,
        DS.Colors.success,
        DS.Colors.warning,
        Color(hex: "#C084FC"),
        Color(hex: "#F472B6"),
        Color(hex: "#5EEAD4"),
        Color(hex: "#FDBA74"),
        DS.Colors.destructive
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            Divider().background(DS.Colors.borderSubtle)

            if let insights = companionManager.financialInsights {
                tabBar
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        switch selectedTab {
                        case .overview:
                            heroBalanceSection(insights: insights)
                            healthScoreSection(insights: insights)
                            runwayInsightSection(insights: insights)
                            safeToSpendGaugeSection(insights: insights)
                            balanceBreakdownSection(insights: insights)
                            activityChartSection(insights: insights)
                        case .spending:
                            categorySpendingSection(insights: insights)
                        case .bills:
                            upcomingBillsSection(insights: insights)
                            subscriptionsTrackerSection(insights: insights)
                            rewardsSection(insights: insights)
                        }
                    }
                    .padding(16)
                }
            } else {
                emptyState
            }
        }
        .frame(width: 460, height: 700)
        .background(DS.Colors.background)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
        )
    }

    // MARK: Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Insights")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(DS.Colors.textPrimary)
                Text("Your full financial picture, live from Capital One")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
            }
            Spacer()
            Button(action: {
                NotificationCenter.default.post(name: .flickyDismissInsightsDashboard, object: nil)
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)
            .pointerCursor()
        }
        .padding(14)
    }

    // MARK: Tab Bar

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(DashboardTab.allCases) { tab in
                Button(action: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        selectedTab = tab
                    }
                }) {
                    HStack(spacing: 5) {
                        Image(systemName: tab.iconSystemName)
                            .font(.system(size: 10, weight: .semibold))
                        Text(tab.title)
                            .font(.system(size: 11.5, weight: .semibold))
                    }
                    .foregroundColor(selectedTab == tab ? DS.Colors.textPrimary : DS.Colors.textTertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(selectedTab == tab ? Color.white.opacity(0.08) : Color.clear)
                    )
                }
                .buttonStyle(.plain)
                .pointerCursor()
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.03))
        )
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Spacer()
            Image(systemName: "chart.pie")
                .font(.system(size: 24))
                .foregroundColor(DS.Colors.textTertiary)
            Text("No financial data yet")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(DS.Colors.textTertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Shared Card Chrome

    /// Every section on the dashboard shares the same "frosted card" look —
    /// pulling this into one modifier keeps that consistent and makes it
    /// trivial to add new sections without re-deriving the styling each time.
    private func cardBackground() -> some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.white.opacity(0.04))
    }

    private func cardBorder() -> some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(DS.Colors.textTertiary)
            .tracking(0.5)
    }

    // MARK: Hero Balance

    private func heroBalanceSection(insights: FinancialInsights) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                if let nickname = insights.accountNickname {
                    Text(nickname.uppercased())
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(DS.Colors.textTertiary)
                        .tracking(0.5)
                }
                Spacer()
                if insights.netCashFlowCents != 0 {
                    netCashFlowChip(insights: insights)
                }
            }
            Text(insights.formattedBalance)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundColor(DS.Colors.textPrimary)
            if let last4 = insights.accountLast4 {
                Text("Account ending \(last4)")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    /// Small "+$X / -$X over 30 days" pill in the hero card — a quick
    /// glanceable trend indicator that used to require opening the activity
    /// chart to see at all.
    private func netCashFlowChip(insights: FinancialInsights) -> some View {
        let isPositive = insights.netCashFlowCents >= 0
        let chipColor: Color = isPositive ? DS.Colors.success : DS.Colors.destructive
        return HStack(spacing: 3) {
            Image(systemName: isPositive ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 8, weight: .bold))
            Text("\(isPositive ? "+" : "-")\(insights.formatCents(abs(insights.netCashFlowCents))) / 30d")
                .font(.system(size: 9.5, weight: .semibold))
        }
        .foregroundColor(chipColor)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(
            Capsule().fill(chipColor.opacity(0.12))
        )
    }

    // MARK: Financial Health Score
    //
    // A composite 0-100 score + letter grade blending cushion, bill load,
    // and cash flow (see `FinancialInsights.financialHealthScore`) — the one
    // number on this whole dashboard meant to answer "how am I doing?" at a
    // glance, the way a credit score does, instead of making the user read
    // and mentally combine three separate figures themselves.

    private func healthScoreSection(insights: FinancialInsights) -> some View {
        let score = insights.financialHealthScore
        let grade = insights.financialHealthGrade
        let gradeColor = healthGradeColor(for: grade)

        return VStack(alignment: .leading, spacing: 10) {
            sectionLabel("FINANCIAL HEALTH")

            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    Circle()
                        .stroke(DS.Colors.borderSubtle, lineWidth: 6)
                        .frame(width: 62, height: 62)
                    Circle()
                        .trim(from: 0, to: CGFloat(max(0, min(100, score))) / 100.0)
                        .stroke(gradeColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 62, height: 62)
                    VStack(spacing: 0) {
                        Text(grade)
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                            .foregroundColor(gradeColor)
                        Text("\(score)/100")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundColor(DS.Colors.textTertiary)
                    }
                }

                VStack(alignment: .leading, spacing: 5) {
                    ForEach(insights.healthScoreFactors.prefix(3), id: \.self) { factor in
                        HStack(alignment: .top, spacing: 6) {
                            Circle()
                                .fill(DS.Colors.textTertiary)
                                .frame(width: 3, height: 3)
                                .padding(.top, 5)
                            Text(factor)
                                .font(.system(size: 10.5))
                                .foregroundColor(DS.Colors.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    private func healthGradeColor(for grade: String) -> Color {
        switch grade {
        case "A": return DS.Colors.success
        case "B": return Color(hex: "#8BD17C")
        case "C": return DS.Colors.warning
        case "D": return Color(hex: "#FF9142")
        default: return DS.Colors.destructive
        }
    }

    // MARK: Runway Projection
    //
    // The one genuinely forward-looking figure on the dashboard: "at this
    // rate, how many days of safe-to-spend money do you have left?" When the
    // user is net-positive there's nothing to warn about, so this instead
    // celebrates the positive cash flow rather than showing an empty card.

    private func runwayInsightSection(insights: FinancialInsights) -> some View {
        Group {
            if let runwayDays = insights.projectedRunwayDays {
                HStack(spacing: 12) {
                    Image(systemName: "hourglass")
                        .font(.system(size: 18))
                        .foregroundColor(DS.Colors.warning)
                    VStack(alignment: .leading, spacing: 2) {
                        sectionLabel("RUNWAY")
                        Text("~\(runwayDays) day\(runwayDays == 1 ? "" : "s") of safe-to-spend money left")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(DS.Colors.textPrimary)
                        Text("projected from your last 30 days of spending")
                            .font(.system(size: 9.5))
                            .foregroundColor(DS.Colors.textTertiary)
                    }
                    Spacer()
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DS.Colors.warning.opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.Colors.warning.opacity(0.25), lineWidth: 0.5))
            } else if insights.netCashFlowCents > 0 {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.up.right.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(DS.Colors.success)
                    VStack(alignment: .leading, spacing: 2) {
                        sectionLabel("CASH FLOW")
                        Text("Net +\(insights.formatCents(insights.netCashFlowCents)) over the last 30 days")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(DS.Colors.textPrimary)
                        Text("You're saving faster than you're spending — no runway concerns")
                            .font(.system(size: 9.5))
                            .foregroundColor(DS.Colors.textTertiary)
                    }
                    Spacer()
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DS.Colors.success.opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(DS.Colors.success.opacity(0.25), lineWidth: 0.5))
            }
        }
    }

    // MARK: Safe-to-Spend Gauge

    private func safeToSpendGaugeSection(insights: FinancialInsights) -> some View {
        let ratio = insights.balanceCents > 0
            ? min(1.0, max(0.0, Double(insights.safeToSpendCents) / Double(insights.balanceCents)))
            : 0.0
        let gaugeColor: Color = insights.safeToSpendCents < 5000
            ? DS.Colors.destructive
            : insights.safeToSpendCents < 20000 ? DS.Colors.warning : DS.Colors.success

        return HStack(spacing: 14) {
            Gauge(value: ratio) {
                EmptyView()
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(gaugeColor)
            .scaleEffect(1.4)
            .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 2) {
                sectionLabel("SAFE TO SPEND")
                Text(insights.formattedSafeToSpend)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(gaugeColor)
                Text("after upcoming bills + $500 reserve")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
            }
            Spacer()
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    // MARK: Balance Breakdown (custom stacked bar)

    private func balanceBreakdownSection(insights: FinancialInsights) -> some View {
        let reserveCents = 50_000
        let billsCents = insights.upcomingBills.reduce(0) { $0 + $1.amountCents }
        let safeCents = max(0, insights.safeToSpendCents)
        let totalCents = max(1, safeCents + billsCents + reserveCents)

        return VStack(alignment: .leading, spacing: 8) {
            sectionLabel("WHERE YOUR BALANCE IS ALLOCATED")

            GeometryReader { geometry in
                HStack(spacing: 2) {
                    stackedSegment(color: DS.Colors.success, widthFraction: CGFloat(safeCents) / CGFloat(totalCents), totalWidth: geometry.size.width)
                    stackedSegment(color: DS.Colors.warning, widthFraction: CGFloat(billsCents) / CGFloat(totalCents), totalWidth: geometry.size.width)
                    stackedSegment(color: DS.Colors.textTertiary, widthFraction: CGFloat(reserveCents) / CGFloat(totalCents), totalWidth: geometry.size.width)
                }
            }
            .frame(height: 14)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

            HStack(spacing: 14) {
                legendDot(color: DS.Colors.success, label: "Safe to spend")
                legendDot(color: DS.Colors.warning, label: "Upcoming bills")
                legendDot(color: DS.Colors.textTertiary, label: "$500 reserve")
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    private func stackedSegment(color: Color, widthFraction: CGFloat, totalWidth: CGFloat) -> some View {
        Rectangle()
            .fill(color.opacity(0.85))
            .frame(width: max(2, totalWidth * widthFraction))
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
        }
    }

    // MARK: Activity Chart (Charts framework)

    private func activityChartSection(insights: FinancialInsights) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("LAST 30 DAYS")

            Chart {
                BarMark(
                    x: .value("Type", "Deposits"),
                    y: .value("Amount", Double(insights.recentDepositsCents) / 100.0)
                )
                .foregroundStyle(DS.Colors.success)
                .cornerRadius(4)

                BarMark(
                    x: .value("Type", "Withdrawals"),
                    y: .value("Amount", Double(insights.recentWithdrawalsCents) / 100.0)
                )
                .foregroundStyle(Color(red: 1, green: 0.45, blue: 0.35))
                .cornerRadius(4)
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(DS.Colors.borderSubtle.opacity(0.4))
                    AxisValueLabel().foregroundStyle(DS.Colors.textTertiary)
                }
            }
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel().foregroundStyle(DS.Colors.textTertiary)
                }
            }
            .frame(height: 130)

            HStack(spacing: 14) {
                legendDot(color: DS.Colors.success, label: "In: \(insights.formatCents(insights.recentDepositsCents))")
                legendDot(color: Color(red: 1, green: 0.45, blue: 0.35), label: "Out: \(insights.formatCents(insights.recentWithdrawalsCents))")
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    // MARK: Spending by Category
    //
    // Sourced from Nessie `/purchases` joined against `/merchants` (see
    // `NessieAPIClient.fetchSpendingByCategory`). This is the answer to
    // "where is my money actually going" — a question nothing else in
    // Flicky could previously answer, since bills/deposits/withdrawals are
    // aggregate totals with no sense of what was purchased or from where.

    private func categorySpendingSection(insights: FinancialInsights) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                sectionLabel("SPENDING BY CATEGORY")
                Spacer()
                if !insights.spendingByCategory.isEmpty {
                    let totalTrackedCents = insights.spendingByCategory.reduce(0) { $0 + $1.totalCents }
                    Text(insights.formatCents(totalTrackedCents))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(DS.Colors.textPrimary)
                }
            }

            if insights.spendingByCategory.isEmpty {
                categorySpendingEmptyState
            } else {
                let totalTrackedCents = max(1, insights.spendingByCategory.reduce(0) { $0 + $1.totalCents })
                VStack(spacing: 12) {
                    ForEach(Array(insights.spendingByCategory.enumerated()), id: \.element.id) { index, category in
                        categoryRow(
                            category: category,
                            totalTrackedCents: totalTrackedCents,
                            color: categoryColorPalette[index % categoryColorPalette.count]
                        )
                    }
                }
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    private var categorySpendingEmptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "tag")
                .font(.system(size: 20))
                .foregroundColor(DS.Colors.textTertiary)
            Text("No itemized purchases yet")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(DS.Colors.textSecondary)
            Text("Once purchases post to this account, Flicky will automatically break spending down by category.")
                .font(.system(size: 9.5))
                .foregroundColor(DS.Colors.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }

    private func categoryRow(category: CategorySpending, totalTrackedCents: Int, color: Color) -> some View {
        let fraction = Double(category.totalCents) / Double(totalTrackedCents)

        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: category.iconSystemName)
                    .font(.system(size: 10))
                    .foregroundColor(color)
                    .frame(width: 14)
                Text(category.category)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(DS.Colors.textPrimary)
                Spacer()
                Text(category.formattedTotal)
                    .font(.system(size: 11.5, weight: .bold))
                    .foregroundColor(DS.Colors.textPrimary)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                        .frame(height: 5)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(color)
                        .frame(width: max(3, geometry.size.width * CGFloat(fraction)), height: 5)
                }
            }
            .frame(height: 5)

            Text("\(category.transactionCount) purchase\(category.transactionCount == 1 ? "" : "s") · \(Int((fraction * 100).rounded()))% of tracked spending")
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
        }
    }

    // MARK: Upcoming Bills (horizontal chips)

    private func upcomingBillsSection(insights: FinancialInsights) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("UPCOMING BILLS")

            if insights.upcomingBills.isEmpty {
                Text("Nothing due in the next 14 days")
                    .font(.system(size: 11))
                    .foregroundColor(DS.Colors.textTertiary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(insights.upcomingBills) { bill in
                            billChip(bill: bill)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    private func billChip(bill: UpcomingBill) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: bill.recurring ? "repeat" : "calendar")
                    .font(.system(size: 9))
                    .foregroundColor(DS.Colors.textTertiary)
                Text(bill.label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(DS.Colors.textPrimary)
                    .lineLimit(1)
            }
            Text(bill.formattedAmount)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(DS.Colors.textPrimary)
            Text(bill.date)
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
        }
        .padding(10)
        .frame(width: 110, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
        )
    }

    // MARK: Subscriptions & Recurring
    //
    // Every bill Nessie flagged as recurring, regardless of whether it's due
    // in the next 14 days — answers "what am I committed to paying every
    // month" as a standing total, which the 14-day upcoming-bills window
    // alone can't show (a monthly subscription due in three weeks would
    // simply never appear there).

    private func subscriptionsTrackerSection(insights: FinancialInsights) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionLabel("SUBSCRIPTIONS & RECURRING")
                Spacer()
                if insights.recurringMonthlyTotalCents > 0 {
                    Text("\(insights.formatCents(insights.recurringMonthlyTotalCents))/mo")
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundColor(DS.Colors.textPrimary)
                }
            }

            if insights.recurringBills.isEmpty {
                Text("No recurring bills detected on this account")
                    .font(.system(size: 11))
                    .foregroundColor(DS.Colors.textTertiary)
            } else {
                VStack(spacing: 8) {
                    ForEach(insights.recurringBills) { bill in
                        HStack(spacing: 8) {
                            Image(systemName: "repeat")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(DS.Colors.blue400)
                                .frame(width: 14)
                            Text(bill.label)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(DS.Colors.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text(bill.date)
                                .font(.system(size: 9))
                                .foregroundColor(DS.Colors.textTertiary)
                            Text(bill.formattedAmount)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(DS.Colors.textPrimary)
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(cardBackground())
        .overlay(cardBorder())
    }

    // MARK: Rewards

    private func rewardsSection(insights: FinancialInsights) -> some View {
        Group {
            if let points = insights.rewardsPoints, points > 0 {
                // Assumption, documented for whoever tunes this later: 1
                // rewards point ≈ $0.01, a common baseline redemption rate
                // for cashback-style card rewards. Flicky has no live
                // point-value data from Nessie, so this is presented as an
                // estimate, not a guaranteed number.
                let estimatedDollarValue = Double(points) * 0.01

                HStack(spacing: 12) {
                    Image(systemName: "seal.fill")
                        .font(.system(size: 20))
                        .foregroundColor(DS.Colors.blue400)
                    VStack(alignment: .leading, spacing: 2) {
                        sectionLabel("REWARDS POINTS")
                        Text("\(points) pts")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(DS.Colors.textPrimary)
                        Text("≈ \(String(format: "$%.2f", estimatedDollarValue)) estimated value")
                            .font(.system(size: 10))
                            .foregroundColor(DS.Colors.textTertiary)
                    }
                    Spacer()
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(DS.Colors.blue400.opacity(0.08))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(DS.Colors.blue400.opacity(0.25), lineWidth: 0.5)
                )
            }
        }
    }
}
