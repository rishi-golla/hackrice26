import AppKit
import SwiftUI

@main
struct EvidencePanelCheck {
    @MainActor static func main() async throws {
        _ = NSApplication.shared
        let fixture = FinancialInsights(balanceCents: 123456, safeToSpendCents: 40056,
            upcomingBills: [UpcomingBill(id: "qa", label: "Example rent", date: "2026-09-15", amountCents: 33400, recurring: true)],
            expectedIncome: [], recentDepositsCents: 203400, recentWithdrawalsCents: 71230,
            accountNickname: "QA fixture", accountLast4: nil, accountType: nil, rewardsPoints: 4321, asOf: Date(),
            spendingByCategory: [CategorySpending(id: "food", category: "Groceries", totalCents: 32145, transactionCount: 14),
                                CategorySpending(id: "other", category: "Other", totalCents: 9811, transactionCount: 3)])
        let research = FlickyResearch()
        defer { research.reset() }
        for (name, keys, snapshot) in [("missing", ["balance"], nil), ("balance", ["balance", "bills"], Optional(fixture)), ("spending", ["spending", "cashflow"], Optional(fixture)), ("specialists", ["balance"], Optional(fixture)), ("investing", ["investing", "bills", "spending"], Optional(fixture))] {
            research.reset()
            research.question = "UI regression fixture · " + name
            if name == "investing" { research.investmentHorizon = "a year" }
            if name == "specialists", let screen = NSScreen.main {
                research.specialists = [FlickySpecialist(role: "Affordability", slot: 0, origin: .zero, screenFrame: screen.frame),
                                        FlickySpecialist(role: "Tradeoffs", slot: 1, origin: .zero, screenFrame: screen.frame, returnedAt: Date())]
                research.phase = "1 specialist still working"
            }
            research.showMetrics(keys, snapshot: snapshot)
            guard let panel = research.evidencePanel, let host = panel.contentView else { preconditionFailure("Requested evidence always has a visible state") }
            try await Task.sleep(for: .milliseconds(200))
            precondition(host.bounds.width >= 300 && host.bounds.height >= 400, "Window supplies a nonzero viewport")
            precondition(panel.isVisible)
            host.layoutSubtreeIfNeeded()
            if let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: bitmap)
                if let data = bitmap.representation(using: .png, properties: [:]) {
                    try data.write(to: URL(fileURLWithPath: "/tmp/flicky-panel-\(name).png"))
                }
            }
        }
        print("PASS: Evidence window renders missing, populated, and reused-window states at actual panel dimensions")
    }
}
