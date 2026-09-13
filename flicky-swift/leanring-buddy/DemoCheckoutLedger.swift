import Foundation
import CryptoKit
import CoreFoundation
import Darwin

struct DemoCheckoutAccount: Codable, Equatable, Sendable {
    let accountId: String
    let nickname: String
    let balanceCents: Int
    let observedAt: Date
}

/// A sandbox funding receipt, never a retailer order or a real bank authorization.
struct DemoCheckoutReceipt: Codable, Equatable, Sendable {
    let checkoutId: UUID
    let accountId: String
    let amountCents: Int
    let balanceBeforeCents: Int
    var observedBalanceCents: Int?
    var withdrawalId: String?
    var withdrawalStatus: String?
    var responseStatusCode: Int?
    var responseSHA256: String?
    let submittedAt: Date
    var observedAt: Date?

    nonisolated var balanceDeductionObserved: Bool {
        observedBalanceCents == balanceBeforeCents - amountCents
    }

    nonisolated var paymentRejected: Bool {
        ["failed", "cancelled", "canceled", "rejected"].contains(withdrawalStatus?.lowercased() ?? "")
    }

    nonisolated var paymentPosted: Bool {
        withdrawalId != nil && !paymentRejected && ["completed", "posted"].contains(withdrawalStatus?.lowercased() ?? "")
    }
}

enum DemoCheckoutLedgerError: LocalizedError {
    case configuration, invalidAmount, accountMismatch, insufficientFunds, busy, storage, changedCheckout
    case rejected(Int), unresolved

    var errorDescription: String? {
        switch self {
        case .configuration: return "Nessie sandbox payment is not configured."
        case .invalidAmount: return "The demo total must be a positive USD amount."
        case .accountMismatch: return "The selected sandbox account could not be verified for this customer."
        case .insufficientFunds: return "The selected Nessie sandbox account has insufficient funds."
        case .busy: return "A sandbox payment is already being checked."
        case .storage: return "The payment record could not be saved. No new payment will be sent."
        case .changedCheckout: return "This checkout was already submitted with different payment details."
        case .rejected(let status): return "Nessie declined the sandbox payment (HTTP \(status))."
        case .unresolved: return "The sandbox payment outcome is still unconfirmed. Check again to reconcile it; PeppaPrice will not charge it twice."
        }
    }
}

/// Uses one withdrawal for the whole demo basket. Retailer purchases remain separate.
/// Nessie does not document an idempotency key. A persisted preflight record prevents
/// replay after a timeout/crash; retries only search the UUID memo and read the balance.
actor DemoCheckoutLedger {
    private struct Entry: Codable {
        let customerId: String
        var receipt: DemoCheckoutReceipt
        var state: String // submitting, accepted, rejected
    }

    private let apiKey: String
    private let baseURL: URL
    private let amountUnit: String
    private let entityPrefix: String
    private let session: URLSession
    private let storageURL: URL
    private var entries: [Entry]
    private var paymentInProgress = false

    @MainActor static func configured() throws -> DemoCheckoutLedger {
        guard let key = AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_API_KEY"),
              let url = URL(string: AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_BASE_URL") ?? "https://prod-api.nessieisreal.com"),
              let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw DemoCheckoutLedgerError.configuration
        }
        return try DemoCheckoutLedger(apiKey: key, baseURL: url,
            amountUnit: AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_AMOUNT_UNIT") ?? "dollars",
            useEnterpriseData: AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_DATA_SCOPE") == "enterprise",
            storageURL: support.appendingPathComponent("Flicky/demo-checkout-ledger.json"))
    }

    init(apiKey: String, baseURL: URL = URL(string: "https://prod-api.nessieisreal.com")!,
         amountUnit: String = "dollars", useEnterpriseData: Bool = false,
         storageURL: URL, session: URLSession? = nil) throws {
        // Never direct sandbox funding at a production financial API or arbitrary host.
        guard baseURL.scheme == "https", ["prod-api.nessieisreal.com", "api.nessieisreal.com"].contains(baseURL.host ?? ""),
              baseURL.user == nil, baseURL.password == nil, baseURL.query == nil,
              baseURL.port == nil, baseURL.path.isEmpty || baseURL.path == "/",
              ["dollars", "cents"].contains(amountUnit), !apiKey.isEmpty else {
            throw DemoCheckoutLedgerError.configuration
        }
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.amountUnit = amountUnit
        self.entityPrefix = useEnterpriseData ? "/enterprise" : ""
        self.storageURL = storageURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 25
        configuration.urlCache = nil
        self.session = session ?? URLSession(configuration: configuration)
        if FileManager.default.fileExists(atPath: storageURL.path) {
            do { entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: storageURL)) }
            catch { throw DemoCheckoutLedgerError.storage }
        } else {
            entries = []
        }
    }

    /// Call only from the explicit Pay with sandbox funds action with a stable persisted checkoutId.
    func pay(checkoutId: UUID, customerId: String, accountId: String, amountCents: Int) async throws -> DemoCheckoutReceipt {
        guard !paymentInProgress else { throw DemoCheckoutLedgerError.busy }
        guard amountCents > 0, amountCents <= 100_000_000 else { throw DemoCheckoutLedgerError.invalidAmount }
        guard validIdentifier(customerId), validIdentifier(accountId) else { throw DemoCheckoutLedgerError.accountMismatch }
        paymentInProgress = true
        defer { paymentInProgress = false }
        let lockDescriptor = try acquireLedgerLock()
        defer { flock(lockDescriptor, LOCK_UN); close(lockDescriptor) }
        // Another instance/process may have completed a payment since this actor loaded.
        if FileManager.default.fileExists(atPath: storageURL.path) {
            do { entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: storageURL)) }
            catch { throw DemoCheckoutLedgerError.storage }
        }

        if let index = entries.firstIndex(where: { $0.receipt.checkoutId == checkoutId }) {
            let entry = entries[index]
            guard entry.customerId == customerId, entry.receipt.accountId == accountId,
                  entry.receipt.amountCents == amountCents else { throw DemoCheckoutLedgerError.changedCheckout }
            if entry.state == "rejected" { throw DemoCheckoutLedgerError.rejected(entry.receipt.responseStatusCode ?? 400) }
            return try await reconcile(index: index)
        }
        // An ambiguous attempt may have consumed funds; do not submit another basket on this account.
        guard !entries.contains(where: {
            $0.receipt.accountId == accountId && ($0.state == "submitting" ||
                ($0.state == "accepted" && !$0.receipt.balanceDeductionObserved && !$0.receipt.paymentPosted && !$0.receipt.paymentRejected))
        }) else {
            throw DemoCheckoutLedgerError.unresolved
        }
        let before = try await verifiedBalance(customerId: customerId, accountId: accountId)
        guard before >= amountCents else { throw DemoCheckoutLedgerError.insufficientFunds }
        try Task.checkCancellation()
        let receipt = DemoCheckoutReceipt(checkoutId: checkoutId, accountId: accountId, amountCents: amountCents,
            balanceBeforeCents: before, submittedAt: Date())
        entries.append(Entry(customerId: customerId, receipt: receipt, state: "submitting"))
        let index = entries.count - 1
        // Must reach disk before crossing the network mutation boundary.
        try persist()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        let payload: [String: Any] = ["medium": "balance", "transaction_date": formatter.string(from: receipt.submittedAt),
            "amount": NSDecimalNumber(value: amountCents).dividing(by: NSDecimalNumber(value: amountUnit == "cents" ? 1 : 100)),
            "description": memo(checkoutId)]
        do {
            let (data, status) = try await request(path: "/accounts/\(accountId)/withdrawals", method: "POST", body: payload)
            entries[index].receipt.responseStatusCode = status
            entries[index].receipt.responseSHA256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            if (200...299).contains(status) {
                entries[index].state = "accepted"
                if let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let record = envelope["objectCreated"] as? [String: Any] ?? envelope
                    entries[index].receipt.withdrawalId = record["_id"] as? String
                    entries[index].receipt.withdrawalStatus = record["status"] as? String
                }
            } else if (400...499).contains(status), status != 408, status != 429 {
                entries[index].state = "rejected"
            }
            try persist()
            if entries[index].state == "rejected" { throw DemoCheckoutLedgerError.rejected(status) }
        } catch let error as DemoCheckoutLedgerError {
            if case .unresolved = error { /* Reconcile an ambiguous network outcome below. */ }
            else { throw error }
        } catch {
            // A dropped connection does not establish whether the server committed.
            // The preflight record remains on disk and no POST retry is ever performed.
        }
        return try await reconcile(index: index)
    }

    /// Read-only preflight for the review screen; Pay always checks again.
    func prepare(customerId: String, accountId: String) async throws -> DemoCheckoutAccount {
        guard validIdentifier(customerId), validIdentifier(accountId) else { throw DemoCheckoutLedgerError.accountMismatch }
        return try await verifiedAccount(customerId: customerId, accountId: accountId)
    }

    private func reconcile(index: Int) async throws -> DemoCheckoutReceipt {
        let receipt = entries[index].receipt
        if let (data, status) = try? await request(path: "/accounts/\(receipt.accountId)/withdrawals"),
           (200...299).contains(status),
           let records = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            let matching = records.filter { ($0["description"] as? String) == memo(receipt.checkoutId) && cents($0["amount"]) == receipt.amountCents }
            if matching.count == 1, let record = matching.first, let identifier = record["_id"] as? String {
                entries[index].state = "accepted"
                entries[index].receipt.withdrawalId = identifier
                entries[index].receipt.withdrawalStatus = record["status"] as? String
            }
        }
        if let balance = try? await verifiedBalance(customerId: entries[index].customerId, accountId: receipt.accountId) {
            entries[index].receipt.observedBalanceCents = balance
            entries[index].receipt.observedAt = Date()
        }
        try persist()
        guard entries[index].state == "accepted" else { throw DemoCheckoutLedgerError.unresolved }
        return entries[index].receipt
    }

    private func verifiedBalance(customerId: String, accountId: String) async throws -> Int {
        try await verifiedAccount(customerId: customerId, accountId: accountId).balanceCents
    }

    private func verifiedAccount(customerId: String, accountId: String) async throws -> DemoCheckoutAccount {
        let (data, status) = try await request(path: "\(entityPrefix)/accounts/\(accountId)")
        guard (200...299).contains(status),
              let account = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              account["_id"] as? String == accountId, account["customer_id"] as? String == customerId,
              let balance = cents(account["balance"]) else { throw DemoCheckoutLedgerError.accountMismatch }
        return DemoCheckoutAccount(accountId: accountId, nickname: account["nickname"] as? String ?? "Nessie sandbox account",
                                   balanceCents: balance, observedAt: Date())
    }

    private func request(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> (Data, Int) {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = path
        components.queryItems = [URLQueryItem(name: "key", value: apiKey)]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw DemoCheckoutLedgerError.unresolved }
            return (data, response.statusCode)
        } catch {
            // Do not return URLSession errors containing the key-bearing request URL.
            throw DemoCheckoutLedgerError.unresolved
        }
    }

    private func persist() throws {
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(entries)
            try data.write(to: storageURL, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
        } catch { throw DemoCheckoutLedgerError.storage }
    }

    private func acquireLedgerLock() throws -> Int32 {
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        } catch { throw DemoCheckoutLedgerError.storage }
        let descriptor = open(storageURL.path + ".lock", O_CREAT | O_RDWR, mode_t(0o600))
        guard descriptor >= 0 else { throw DemoCheckoutLedgerError.storage }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor)
            throw DemoCheckoutLedgerError.busy
        }
        return descriptor
    }

    private func cents(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        var amount = number.decimalValue * Decimal(amountUnit == "cents" ? 1 : 100)
        var rounded = Decimal()
        NSDecimalRound(&rounded, &amount, 0, .plain)
        guard rounded >= 0, rounded <= Decimal(Int.max / 2) else { return nil }
        return NSDecimalNumber(decimal: rounded).intValue
    }

    private func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 128 && value.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }
    }

    private func memo(_ checkoutId: UUID) -> String { "Flicky sandbox checkout \(checkoutId.uuidString)" }
}
