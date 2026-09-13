// FinancialModels.swift — PeppaPrice financial data structures

import Foundation

// MARK: - Financial Insights (from Nessie API)

struct FinancialInsights {
    let balanceCents: Int
    let safeToSpendCents: Int
    let upcomingBills: [UpcomingBill]
    let expectedIncome: [ExpectedIncome]
    let recentDepositsCents: Int
    let recentWithdrawalsCents: Int
    let accountNickname: String?
    let accountLast4: String?
    let accountType: String?
    let rewardsPoints: Int?
    let asOf: Date
    // Every bill Nessie has flagged as recurring (subscriptions, rent,
    // memberships, etc.), regardless of whether its next charge falls inside
    // the 14-day `upcomingBills` window — this is what powers the
    // "Subscriptions" tracker, which cares about the full recurring
    // commitment, not just what's due imminently. Defaults to an empty array
    // so older call sites / previews that don't pass it still compile.
    var recurringBills: [UpcomingBill] = []
    // Spending broken down by merchant category over the last 30 days,
    // derived from Nessie's `/purchases` + `/merchants` endpoints (merchants
    // carry a category tag like "Food", "Clothing", "Gas"). This is fetched
    // best-effort and is simply empty if the sandbox account has no itemized
    // purchases yet — the dashboard shows an honest empty state rather than
    // fabricating categories from thin air.
    var spendingByCategory: [CategorySpending] = []
    var isSpendingDataAvailable: Bool = true

    // MARK: - Formatted helpers

    var formattedBalance: String { formatCents(balanceCents) }
    var formattedSafeToSpend: String { formatCents(safeToSpendCents) }

    func formatCents(_ cents: Int) -> String {
        let dollars = Double(cents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    var isStale: Bool {
        Date().timeIntervalSince(asOf) > 300 // 5-minute cache
    }

    // MARK: - Financial Health Score
    //
    // A single composite 0-100 score meant to answer "how am I doing?" at a
    // glance, the same way a credit score or a fitness ring does. It blends
    // three signals that are already computed elsewhere in this struct, so
    // it costs nothing extra to fetch — the value comes entirely from
    // combining data PeppaPrice already has in a way no single existing number
    // (balance, safe-to-spend, etc.) communicates on its own:
    //
    //   1. Cushion (40%)   — how much of your balance is actually free to
    //                        spend right now, after bills + reserve.
    //   2. Bill load (30%) — how much of your balance upcoming bills alone
    //                        would eat, independent of the reserve.
    //   3. Cash flow (30%) — whether money moved in or out on net over the
    //                        last 30 days.
    private var cushionRatio: Double {
        guard balanceCents > 0 else { return 0 }
        return min(1.0, max(0.0, Double(safeToSpendCents) / Double(balanceCents)))
    }

    private var billLoadRatio: Double {
        guard balanceCents > 0 else { return 1.0 }
        let billTotalCents = upcomingBills.reduce(0) { $0 + $1.amountCents }
        return min(1.0, max(0.0, Double(billTotalCents) / Double(balanceCents)))
    }

    /// Net cents moved over the last 30 days: positive means more came in
    /// than went out, negative means the account is being drawn down.
    var netCashFlowCents: Int { recentDepositsCents - recentWithdrawalsCents }

    private var cashFlowRatio: Double {
        guard balanceCents > 0 else { return 0.5 }
        let normalized = Double(netCashFlowCents) / Double(balanceCents)
        return min(1.0, max(-1.0, normalized))
    }

    var financialHealthScore: Int {
        let cushionPoints = cushionRatio * 40.0
        let billLoadPoints = (1.0 - billLoadRatio) * 30.0
        let cashFlowPoints = ((cashFlowRatio + 1.0) / 2.0) * 30.0
        return Int((cushionPoints + billLoadPoints + cashFlowPoints).rounded())
    }

    var financialHealthGrade: String {
        switch financialHealthScore {
        case 90...: return "A"
        case 75..<90: return "B"
        case 60..<75: return "C"
        case 40..<60: return "D"
        default: return "F"
        }
    }

    /// Short, prioritized reasons behind the score, worst factor first, so
    /// the dashboard can explain *why* the number is what it is instead of
    /// just displaying an opaque grade.
    var healthScoreFactors: [String] {
        var factors: [(priority: Double, text: String)] = []

        if cushionRatio < 0.85 {
            factors.append((1.0 - cushionRatio, "Only \(Int(cushionRatio * 100))% of your balance is free to spend after bills and your reserve"))
        }
        if billLoadRatio > 0.15 {
            factors.append((billLoadRatio, "Upcoming bills account for \(Int(billLoadRatio * 100))% of your current balance"))
        }
        if netCashFlowCents < 0 {
            factors.append((abs(cashFlowRatio), "You've spent \(formatCents(abs(netCashFlowCents))) more than you've earned in the last 30 days"))
        } else if netCashFlowCents > 0 {
            factors.append((-0.1, "You're net positive \(formatCents(netCashFlowCents)) over the last 30 days"))
        }

        if factors.isEmpty {
            return ["Your balance, bills, and cash flow are all in a healthy range"]
        }
        return factors.sorted { $0.priority > $1.priority }.map { $0.text }
    }

    // MARK: - Runway Projection
    //
    // "At this rate, how many days of safe-to-spend money do you have left?"
    // — a genuinely forward-looking number, unlike every other figure in
    // this struct which describes the present. Only meaningful when the
    // account is burning down net (see `isBurningDown`); when the user is
    // net-positive there's no runway to project, so this is nil.
    var dailyNetBurnCents: Int { netCashFlowCents / 30 }

    var isBurningDown: Bool { dailyNetBurnCents < 0 }

    var projectedRunwayDays: Int? {
        guard isBurningDown else { return nil }
        let dailyBurn = abs(dailyNetBurnCents)
        guard dailyBurn > 0 else { return nil }
        return safeToSpendCents / dailyBurn
    }

    // MARK: - Subscriptions

    var recurringMonthlyTotalCents: Int {
        recurringBills.reduce(0) { $0 + $1.amountCents }
    }

    // MARK: - System prompt injection

    /// Builds a rich text block for the Claude system prompt so the AI has full financial context.
    func toSystemPromptContext() -> String {
        var lines: [String] = []
        lines.append("## Nessie Sandbox Financial Data (as of \(formattedTime(asOf)))")
        if let nickname = accountNickname { lines.append("- Account: \(nickname)") }
        if let last4 = accountLast4 { lines.append("- Account ending: \(last4)") }
        lines.append("- Current balance: \(formattedBalance)")
        lines.append("- Safe to spend (after $500 reserve + upcoming bills; estimate, excludes unposted charges): \(formattedSafeToSpend)")

        if !upcomingBills.isEmpty {
            lines.append("\n### Upcoming Bills (next 14 days)")
            for bill in upcomingBills.prefix(6) {
                let recurringTag = bill.recurring ? " (recurring)" : ""
                lines.append("  • \(bill.label)\(recurringTag): \(bill.formattedAmount) due \(bill.date)")
            }
        } else {
            lines.append("- No bills due in the next 14 days")
        }

        if !expectedIncome.isEmpty {
            lines.append("\n### Expected Income")
            for income in expectedIncome.prefix(3) {
                lines.append("  • \(income.label): \(income.formattedAmount) on \(income.date)")
            }
        }

        if recentDepositsCents > 0 || recentWithdrawalsCents > 0 {
            lines.append("\n### Last 30 Days")
            lines.append("  • Deposits: \(formatCents(recentDepositsCents))")
            lines.append("  • Withdrawals: \(formatCents(recentWithdrawalsCents))")
        }

        if let points = rewardsPoints, points > 0 {
            lines.append("- Rewards points: \(points)")
        }

        lines.append("- Deposit/withdrawal totals exclude purchases and transfers; they are not total income or net cash flow.")
        if !isSpendingDataAvailable { lines.append("- Purchase data unavailable; do not infer zero spending.") }
        if !spendingByCategory.isEmpty {
            lines.append("\n### Spending by Category (last 30 days)")
            for category in spendingByCategory.prefix(5) {
                lines.append("  • \(category.category): \(formatCents(category.totalCents)) (\(category.transactionCount) purchases)")
            }
        }

        return lines.joined(separator: "\n")
    }

    private func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Upcoming Bill

struct UpcomingBill: Identifiable {
    let id: String
    let label: String
    let date: String
    let amountCents: Int
    let recurring: Bool

    var formattedAmount: String {
        let dollars = Double(amountCents) / 100.0
        return String(format: "$%.2f", dollars)
    }
}

// MARK: - Category Spending

/// One merchant category's worth of spending over the last 30 days, built
/// from Nessie `/purchases` joined against `/merchants` (merchants carry a
/// category tag such as "Food", "Clothing", "Gas"). Powers the "Spending"
/// tab's breakdown — the one piece of the dashboard that answers "where is
/// my money actually going," which nothing else in the app currently shows.
struct CategorySpending: Identifiable {
    let id: String
    let category: String
    let totalCents: Int
    let transactionCount: Int

    var formattedTotal: String {
        let dollars = Double(totalCents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    /// Maps a Nessie merchant category tag to a representative SF Symbol so
    /// the breakdown reads visually, not just as a list of numbers.
    var iconSystemName: String {
        switch category.lowercased() {
        case let value where value.contains("food") || value.contains("restaurant") || value.contains("grocery"):
            return "fork.knife"
        case let value where value.contains("bar") || value.contains("drink"):
            return "wineglass"
        case let value where value.contains("cloth") || value.contains("apparel") || value.contains("shop"):
            return "tshirt"
        case let value where value.contains("electronic") || value.contains("tech"):
            return "desktopcomputer"
        case let value where value.contains("gas") || value.contains("fuel") || value.contains("auto"):
            return "fuelpump"
        case let value where value.contains("health") || value.contains("pharmacy") || value.contains("medical"):
            return "cross.case"
        case let value where value.contains("entertain") || value.contains("movie") || value.contains("game"):
            return "film"
        case let value where value.contains("travel") || value.contains("airline") || value.contains("hotel"):
            return "airplane"
        case let value where value.contains("sport") || value.contains("fitness") || value.contains("gym"):
            return "figure.run"
        case let value where value.contains("book") || value.contains("music"):
            return "book"
        default:
            return "creditcard"
        }
    }
}

// MARK: - Expected Income

struct ExpectedIncome: Identifiable {
    let id: String
    let label: String
    let date: String
    let amountCents: Int

    var formattedAmount: String {
        let dollars = Double(amountCents) / 100.0
        return String(format: "$%.2f", dollars)
    }
}

// MARK: - Product Search

struct ProductSearchResult: Identifiable {
    let id = UUID()
    let title: String
    let price: String
    let url: String
    let source: String
    let rating: Double?
    // Product photo pulled straight from the originating listing (Serper shopping
    // result), shown in the suggestions drawer so users can visually compare items.
    let imageURL: String?
    // Human-readable delivery estimate from the listing, when the shopping API
    // provides one (e.g. "Free delivery by Fri, Sep 19"). Not every listing has one.
    let deliveryInfo: String?

    var isUsed: Bool {
        source.lowercased().contains("ebay") || source.lowercased().contains("marketplace")
    }
}

struct ProductSearchResponse {
    let results: [ProductSearchResult]
    let searchUrls: [String: String]
    let query: String
}

// MARK: - PeppaPrice Voice State

enum FlickyVoiceState {
    case idle
    case listening
    case processing
    case responding
}

// MARK: - Login State

struct FlickyLoginState {
    let accountId: String       // Nessie account ID (derived from customerId lookup)
    let customerId: String      // Nessie customer ID
    let displayEmail: String    // Shown in the UI as account identifier
    let maskedCardNumber: String // e.g. "•••• •••• •••• 4321"
}

// Identity and request evidence are populated only from Nessie responses.
struct NessieCustomerProfile {
    let id: String
    let name: String
    let accounts: [NessieAccountSummary]
}

struct NessieAccountSummary: Identifiable {
    let id: String
    let customerId: String
    let nickname: String
    let type: String
    let balanceCents: Int?
    let last4: String?
}

struct NessieRequestReceipt: Identifiable, Codable {
    let id: UUID
    let host: String
    let path: String
    let statusCode: Int?
    let fetchedAt: Date
    let durationMilliseconds: Int
    let recordCount: Int?
    let serverRequestId: String?
    let responseSHA256: String?
    let responsePreview: String

    static func redactedJSON(_ value: Any) -> Any {
        if let dictionary = value as? [String: Any] {
            return dictionary.mapValues { $0 }.reduce(into: [String: Any]()) { result, entry in
                let key = entry.key.lowercased()
                if ["key", "api_key", "apikey", "authorization", "token"].contains(key) {
                    result[entry.key] = "[redacted]"
                } else if key == "account_number", let number = entry.value as? String {
                    result[entry.key] = "•••• " + number.suffix(4)
                } else {
                    result[entry.key] = redactedJSON(entry.value)
                }
            }
        }
        if let array = value as? [Any] { return array.map(redactedJSON) }
        return value
    }
}
