import Foundation
import AppKit

@main struct SubscriptionCheck {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SubscriptionStore(directory: root)
        let now = SubscriptionRules.date("2026-09-13")!
        func snapshot(_ bills: [UpcomingBill]) -> FinancialInsights {
            FinancialInsights(balanceCents: 0, safeToSpendCents: 0, upcomingBills: [], expectedIncome: [],
                recentDepositsCents: 0, recentWithdrawalsCents: 0, accountNickname: nil, accountLast4: nil,
                accountType: nil, rewardsPoints: nil, asOf: Date(), recurringBills: bills)
        }
        let bill = UpcomingBill(id: "rent", label: "Rent", date: "2026-09-15", amountCents: 90000, recurring: true)
        store.update(account: "a", snapshot: snapshot([bill, bill]))
        precondition(store.active.isEmpty && store.candidates.count == 1, "Recurring rent must not inflate subscription count; dedup IDs")
        precondition(store.add(name: "Fixture Video", amount: "12.50", date: "2026-09-20", website: "https://example.com/account"))
        let id = store.active[0].id
        precondition(!store.add(name: "Bad", amount: "-1", date: "2026-09-20", website: "https://example.com"))
        precondition(store.error == nil && store.validationError != nil, "Form errors must not block existing records")
        precondition(store.change(id, decision: .keep))
        precondition(store.add(name: "Fixture Video", amount: "12.50", date: "2026-09-20", website: "https://example.com/account", editing: id))
        precondition(!store.add(name: "Fixture Video", amount: "12.50", date: "2026-09-20", website: "https://example.com/account"))
        precondition(store.active.count == 1, "Editing preserves identity; exact duplicates are rejected")
        precondition(store.active.count == 1 && store.active[0].amountCents == 1250)
        precondition(SubscriptionRules.soon(store.active[0], now: now))
        var old = store.active[0]; old.nextCharge = "2026-09-12"
        precondition(!SubscriptionRules.soon(old, now: now), "Never roll past dates into invented renewal dates")
        old.nextCharge = "2026-09-27"; precondition(SubscriptionRules.soon(old, now: now))
        old.nextCharge = "2026-09-28"; precondition(!SubscriptionRules.soon(old, now: now))
        precondition(SubscriptionRules.date("2026-02-30") == nil)
        precondition(store.change(id, decision: .working))
        let restored = SubscriptionStore(directory: root); restored.update(account: "a", snapshot: nil)
        precondition(restored.active[0].decision == .needsAttention, "Interrupted runs require reconciliation")
        restored.update(account: "b", snapshot: nil); precondition(restored.items.isEmpty)
        restored.update(account: "a", snapshot: nil); precondition(restored.active.count == 1)
        precondition(SubscriptionRules.profileIdentifier("a") != SubscriptionRules.profileIdentifier("b"))
        let confirmed = "Your subscription has been canceled."
        precondition(SubscriptionRules.cancellationEvidence(confirmed, in: confirmed))
        for text in ["Your cancellation request was submitted.", "If your subscription has been canceled, sign in.", "Your subscription has been canceled?", "Your subscription will be canceled."] {
            precondition(!SubscriptionRules.cancellationEvidence(text, in: text))
        }
        precondition(!SubscriptionRules.cancellationEvidence(confirmed, in: "Active subscription"))
        precondition(!SubscriptionRules.sameHost(URL(string: "https://example.com.evil.test/account"), as: URL(string: "https://example.com")!))
        precondition(SubscriptionRules.website("https://user:password@example.com") == nil)
        precondition(SubscriptionRules.website("https://127.0.0.1") == nil)
        precondition(!SubscriptionCancellation.allowedControl("Delete account"))
        precondition(!SubscriptionCancellation.allowedControl("Pay cancellation fee"))
        precondition(SubscriptionCancellation.allowedControl("Confirm cancellation"))
        precondition(restored.change(id, decision: .cancelled, receipt: confirmed))
        precondition(restored.active.isEmpty)
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        for file in files {
            let attrs = try FileManager.default.attributesOfItem(atPath: file.path)
            precondition((attrs[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        }
        let demoDirectory = root.appendingPathComponent("demo-fixture")
        let demoStore = SubscriptionStore(directory: demoDirectory)
        let demoNow = Date()
        demoStore.update(account: "demo-account", snapshot: nil, customerID: "unrelated", now: demoNow)
        precondition(demoStore.items.isEmpty, "Never seed another customer")
        demoStore.update(account: "demo-account", snapshot: nil, customerID: SubscriptionStore.demoCustomerID, now: demoNow)
        precondition(demoStore.active.count == 3 && demoStore.active.allSatisfy { $0.source == .demo })
        let spotify = demoStore.items.first { $0.id.hasSuffix(":spotify") }!
        precondition(SubscriptionRules.daysUntilRenewal(spotify, now: demoNow) == 3)
        precondition(demoStore.urgentDemoRenewal?.id == spotify.id)
        precondition(demoStore.summary.contains("Renewal reminder:") && demoStore.summary.contains("spotify.com/account"))
        demoStore.update(account: "demo-account", snapshot: nil, customerID: SubscriptionStore.demoCustomerID,
            now: Calendar.current.date(byAdding: .day, value: 1, to: demoNow)!)
        precondition(demoStore.items.count == 3 && demoStore.items.first { $0.id == spotify.id }!.nextCharge == spotify.nextCharge,
            "Reopening cannot duplicate records or move renewal dates")
        precondition(demoStore.change(spotify.id, decision: .keep))
        precondition(demoStore.urgentDemoRenewal == nil, "Do not repeat an acknowledged reminder")
        precondition(demoStore.cancelDemo(spotify.id))
        precondition(demoStore.active.count == 2 && demoStore.items.first { $0.id == spotify.id }!.receipt.contains("No provider"))
        let demoRestored = SubscriptionStore(directory: demoDirectory)
        demoRestored.update(account: "demo-account", snapshot: nil, customerID: SubscriptionStore.demoCustomerID, now: demoNow)
        precondition(demoRestored.active.count == 2, "Do not resurrect a cancelled demo subscription")
        demoRestored.update(account: "unrelated-account", snapshot: nil, customerID: "unrelated")
        precondition(demoRestored.items.isEmpty)
        precondition(!store.cancelDemo(id), "Demo actions must not change real subscriptions")
        print("PASS: customer-scoped demo seeding, three-day renewal, stable dates, reminder acknowledgement, demo-only cancellation, persistence and account isolation")
        try FileManager.default.removeItem(at: root)
        try Data("fixture blocks directory creation".utf8).write(to: root)
        precondition(!store.change(id, decision: .cancelled, receipt: "Must not claim saved"))
        precondition(store.items.first(where: { $0.id == id })?.decision == .working)
        precondition(store.items.first(where: { $0.id == id })?.receipt.isEmpty == true)
        print("PASS: subscriptions — classification, deduplication, dates, persistence, account isolation, interrupted jobs, receipt verification, destination and action constraints.")
    }
}
