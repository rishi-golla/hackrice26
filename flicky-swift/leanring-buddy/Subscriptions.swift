import Foundation
import Combine
import CryptoKit

struct ManagedSubscription: Codable, Identifiable, Equatable {
    enum Source: String, Codable { case manual, nessie, demo }
    enum Decision: String, Codable { case review, keep, requested, working, needsAttention, cancelled, ignored }
    let id: String
    var name: String
    var amountCents: Int
    var nextCharge: String
    var website: String
    let source: Source
    var confirmed: Bool
    var decision: Decision = .review
    var note: String = ""
    var receipt: String = ""
    var updatedAt: Date = Date()
    var isActive: Bool { confirmed && decision != .cancelled && decision != .ignored }
    var amount: String { String(format: "$%.2f", Double(amountCents) / 100) }
}

enum SubscriptionRules {
    static func matchesService(_ item: ManagedSubscription, query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = item.name.lowercased()
        return !query.isEmpty && item.confirmed && item.decision != .ignored &&
            (item.id == query || name == query || name.hasPrefix(query + " "))
    }
    static func profileIdentifier(_ account: String) -> UUID {
        let h = SHA256.hash(data: Data(("subscriptions:" + account).utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        let c = Array(h)
        return UUID(uuidString: "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))")!
    }
    static func date(_ text: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        f.isLenient = false
        guard let date = f.date(from: text), f.string(from: date) == text else { return nil }
        return date
    }
    static func daysUntilRenewal(_ item: ManagedSubscription, now: Date = Date()) -> Int? {
        guard item.isActive, let due = date(item.nextCharge) else { return nil }
        return Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: now), to: due).day
    }
    static func renewalLabel(_ item: ManagedSubscription, now: Date = Date()) -> String {
        guard let days = daysUntilRenewal(item, now: now) else { return "Renewal date unconfirmed" }
        if days < 0 { return "Past recorded renewal · Check status" }
        if days == 0 { return "Renews today" }
        if days == 1 { return "Renews tomorrow" }
        return "Renews in \(days) days"
    }
    static func soon(_ item: ManagedSubscription, now: Date = Date()) -> Bool {
        guard item.isActive, let due = date(item.nextCharge) else { return false }
        let today = Calendar.current.startOfDay(for: now)
        let end = Calendar.current.date(byAdding: .day, value: 14, to: today)!
        return due >= today && due <= end
    }
    static func website(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https", let host = url.host,
              host.contains("."), url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              host != "localhost", !host.hasSuffix(".local"),
              host.range(of: #"^[0-9.:]+$"#, options: .regularExpression) == nil else { return nil }
        return url
    }
    static func sameHost(_ url: URL?, as approved: URL) -> Bool {
        guard let url, website(url.absoluteString) != nil else { return false }
        return url.host?.lowercased() == approved.host?.lowercased()
    }
    static func cancellationEvidence(_ quote: String, in page: String) -> Bool {
        guard quote.count >= 15, quote.count <= 500, page.contains(quote) else { return false }
        // A displayed question, instruction, or conditional is not a cancellation receipt.
        let lower = quote.lowercased()
        guard !lower.contains("?"), !lower.contains(" if "), !lower.hasPrefix("if "),
              !lower.contains("once "), !lower.contains("when "), !lower.contains("will be cancelled"),
              !lower.contains("will be canceled") else { return false }
        return lower.range(of: #"(?:your (?:subscription|membership|plan) (?:has been|is|was) cancel(?:l)?ed|(?:subscription|membership|plan) (?:successfully cancel(?:l)?ed|will not renew)|auto(?:matic)?[ -]?renewal (?:is|has been) (?:off|disabled|turned off))"#, options: .regularExpression) != nil
    }
}

@MainActor
final class SubscriptionStore: ObservableObject {
    @Published private(set) var items: [ManagedSubscription] = []
    @Published private(set) var error: String?
    @Published private(set) var validationError: String?
    @Published private(set) var observedAt: Date?
    private(set) var accountKey: String?
    private let directory: URL
    private var file: URL? {
        guard let accountKey else { return nil }
        let hash = SHA256.hash(data: Data(accountKey.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash + ".json")
    }
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Flicky/subscriptions", isDirectory: true)
    }
    func update(account: String?, snapshot: FinancialInsights?, customerID: String? = nil, now: Date = Date()) {
        if accountKey != account {
            accountKey = account; items = []; error = nil; observedAt = nil
            if let file, FileManager.default.fileExists(atPath: file.path) {
                do {
                    items = try JSONDecoder().decode([ManagedSubscription].self, from: Data(contentsOf: file))
                    for i in items.indices where items[i].decision == .working {
                        items[i].decision = .needsAttention
                        items[i].note = "Interrupted. Check the provider's current status before resuming."
                    }
                } catch { self.error = "Couldn't read saved subscriptions. No cancellation can start until storage is available." }
            }
        }
        seedDemoSubscriptions(customerID: customerID, now: now)
        guard error == nil, let snapshot, !snapshot.isStale else { return }
        observedAt = snapshot.asOf
        for bill in snapshot.recurringBills {
            let id = "nessie:" + bill.id
            if let i = items.firstIndex(where: { $0.id == id }) {
                items[i].amountCents = bill.amountCents; items[i].nextCharge = bill.date
            } else {
                items.append(ManagedSubscription(id: id, name: bill.label, amountCents: bill.amountCents,
                    nextCharge: bill.date, website: "", source: .nessie, confirmed: false))
            }
        }
        // Missing records are not evidence that the provider cancelled them.
        let current = Set(snapshot.recurringBills.map { "nessie:" + $0.id })
        for i in items.indices where items[i].source == .nessie && !current.contains(items[i].id) {
            items[i].note = "Not present in the latest account data; provider status is unverified."
        }
        _ = save()
    }
    // Explicitly scoped to the customer selected when this demo was requested.
    static let demoCustomerID = "7d0da646-431a-49f0-be82-a1bb10189f10"

    private func seedDemoSubscriptions(customerID: String?, now: Date) {
        guard let customerID, customerID == Self.demoCustomerID, accountKey != nil, error == nil else { return }
        let examples: [(String, String, Int, Int, String)] = [
            ("spotify", "Spotify Premium", 1299, 3, "https://www.spotify.com/account/"),
            ("netflix", "Netflix", 1799, 8, "https://www.netflix.com/YourAccount"),
            ("icloud", "iCloud+", 299, 20, "https://www.icloud.com/")
        ]
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        var proposed = items
        for (service, name, cents, days, website) in examples {
            let id = "demo:" + customerID + ":" + service
            guard !proposed.contains(where: { $0.id == id }) else { continue }
            let due = Calendar.current.date(byAdding: .day, value: days, to: now)!
            proposed.append(ManagedSubscription(id: id, name: name, amountCents: cents,
                nextCharge: formatter.string(from: due), website: website, source: .demo, confirmed: true,
                note: "Mock subscription · Illustrative price, not a real charge.", updatedAt: now))
        }
        // Persist once: reopening must not move the renewal date or undo a decision.
        if proposed != items { _ = save(proposed) }
    }

    var urgentDemoRenewal: ManagedSubscription? {
        active.filter { item in
            guard item.source == .demo, item.decision == .review,
                  let days = SubscriptionRules.daysUntilRenewal(item) else { return false }
            return (0...3).contains(days)
        }.sorted { $0.nextCharge < $1.nextCharge }.first
    }

    @discardableResult func cancelDemo(_ id: String) -> Bool {
        guard let item = items.first(where: { $0.id == id }), item.source == .demo else { return false }
        return change(id, decision: .cancelled,
            note: "Cancelled in this demo. Your real provider account is unchanged.",
            receipt: "Demo-only cancellation of \(item.name) recorded at \(Date().ISO8601Format()). No provider was contacted or real subscription cancelled.")
    }

    var active: [ManagedSubscription] { items.filter(\.isActive) }
    var candidates: [ManagedSubscription] { items.filter { !$0.confirmed && $0.decision != .ignored } }
    var summary: String {
        let real = active.filter { $0.source == .manual }
        let sandbox = active.filter { $0.source == .nessie }
        let demo = active.filter { $0.source == .demo }
        var lines = ["Internal provenance metadata — retain for factual accuracy; do not recite in routine replies. Mock subscriptions: \(demo.count) active illustrative records, not Nessie evidence or real charges.\nSubscription coverage: \(real.count) active user-added real subscriptions; \(sandbox.count) confirmed sandbox subscriptions; \(candidates.count) unclassified recurring sandbox bills. This is not an exhaustive discovery of real subscriptions."]
        if let observedAt { lines.append("Sandbox bills observed at \(observedAt.ISO8601Format()).") }
        for item in active {
            let due = SubscriptionRules.renewalLabel(item)
            lines.append("ID \(item.id): \(item.name), \(item.amount), next recorded date \(item.nextCharge), \(due), source \(item.source.rawValue), decision \(item.decision.rawValue). Provider site: \(item.website). \(item.note)")
        }
        if let urgent = urgentDemoRenewal {
            lines.append("Renewal reminder: \(urgent.name) \(SubscriptionRules.renewalLabel(urgent).lowercased()) for the listed amount \(urgent.amount). Ask whether to keep it or cancel; offer to open \(urgent.website) only if requested. Never operate real cancellation controls for mock records.")
        }
        for item in candidates {
            lines.append("Unclassified recurring sandbox bill: \(item.name), \(item.amount), recorded date \(item.nextCharge). Ask whether to track it as a subscription before including it in the subscription count.")
        }
        for item in items where !item.receipt.isEmpty { lines.append("\(item.name) receipt: \(item.receipt)") }
        if let error { lines.append("Storage error: \(error)") }
        return lines.joined(separator: "\n")
    }
    @discardableResult func add(name: String, amount: String, date: String, website: String, editing id: String? = nil) -> Bool {
        if error?.contains("read saved") == true || error?.contains("Couldn't save") == true { return false }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard accountKey != nil, !name.isEmpty, name.count <= 100,
              amount.range(of: #"^\d{1,6}(?:\.\d{1,2})?$"#, options: .regularExpression) != nil,
              let value = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX")), value > 0,
              SubscriptionRules.date(date) != nil, SubscriptionRules.website(website) != nil else {
            validationError = "Enter a name, positive USD amount, date as YYYY-MM-DD, and a valid HTTPS provider URL."; return false
        }
        guard !items.contains(where: { $0.id != id && $0.isActive && $0.source == .manual &&
            $0.name.caseInsensitiveCompare(name) == .orderedSame && URL(string: $0.website)?.host == URL(string: website)?.host }) else {
            validationError = "This service is already tracked. Edit its existing entry, or use a distinct account name."; return false
        }
        validationError = nil
        var proposed = items
        if let id, let i = proposed.firstIndex(where: { $0.id == id && $0.source == .manual }) {
            proposed[i].name = name; proposed[i].amountCents = NSDecimalNumber(decimal: value * 100).intValue
            proposed[i].nextCharge = date; proposed[i].website = website; proposed[i].updatedAt = Date()
        } else {
            proposed.append(ManagedSubscription(id: UUID().uuidString, name: name,
                amountCents: NSDecimalNumber(decimal: value * 100).intValue,
                nextCharge: date, website: website, source: .manual, confirmed: true))
        }
        return save(proposed)
    }
    @discardableResult func change(_ id: String, decision: ManagedSubscription.Decision, note: String = "", receipt: String? = nil, confirm: Bool = false) -> Bool {
        guard let i = items.firstIndex(where: { $0.id == id }), error == nil else { return false }
        var proposed = items
        proposed[i].decision = decision; proposed[i].note = note; proposed[i].updatedAt = Date()
        if confirm { proposed[i].confirmed = true }
        if let receipt { proposed[i].receipt = receipt }
        return save(proposed)
    }
    @discardableResult private func save(_ proposed: [ManagedSubscription]? = nil) -> Bool {
        guard let file else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(proposed ?? items)
            try data.write(to: file, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            if let proposed { items = proposed }
            return true
        } catch { self.error = "Couldn't save subscription decisions. Cancellation is paused. Check local storage and reopen the panel."; return false }
    }
}
