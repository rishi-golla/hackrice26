// FinancialModels.swift — Flicky financial data structures

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

    // MARK: - System prompt injection

    /// Builds a rich text block for the Claude system prompt so the AI has full financial context.
    func toSystemPromptContext() -> String {
        var lines: [String] = []
        lines.append("## Live Financial Data (as of \(formattedTime(asOf)))")
        if let nickname = accountNickname { lines.append("- Account: \(nickname)") }
        if let last4 = accountLast4 { lines.append("- Account ending: \(last4)") }
        lines.append("- Current balance: \(formattedBalance)")
        lines.append("- Safe to spend (after reserve + upcoming bills): \(formattedSafeToSpend)")

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

    var isUsed: Bool {
        source.lowercased().contains("ebay") || source.lowercased().contains("marketplace")
    }
}

struct ProductSearchResponse {
    let results: [ProductSearchResult]
    let searchUrls: [String: String]
    let query: String
}

// MARK: - Flicky Voice State

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
