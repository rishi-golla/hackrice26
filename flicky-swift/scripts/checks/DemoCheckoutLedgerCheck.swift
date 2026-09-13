import Foundation

/// Fixture-only transport: this executable never accesses Nessie or local credentials.
private final class CheckoutFixtureProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Any))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, object) = try Self.handler(request)
            let data = try JSONSerialization.data(withJSONObject: object, options: .fragmentsAllowed)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main private struct DemoCheckoutLedgerCheck {
    static func main() async throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("FlickyLedgerFixture-\(UUID())")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CheckoutFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        func ledger(_ name: String) throws -> DemoCheckoutLedger {
            try DemoCheckoutLedger(apiKey: "fixture-not-a-secret", storageURL: temporary.appendingPathComponent(name), session: session)
        }
        var balance = 100.0
        var postCount = 0
        var records: [[String: Any]] = []
        var timeout = false
        var commitOnTimeout = false
        var postStatus = 201
        var owner = "customer"
        var pending = false
        CheckoutFixtureProtocol.handler = { request in
            if request.httpMethod == "POST" {
                postCount += 1
                var body = request.httpBody ?? Data()
                if body.isEmpty, let stream = request.httpBodyStream {
                    stream.open()
                    defer { stream.close() }
                    var buffer = [UInt8](repeating: 0, count: 4096)
                    while stream.hasBytesAvailable {
                        let count = stream.read(&buffer, maxLength: buffer.count)
                        if count <= 0 { break }
                        body.append(buffer, count: count)
                    }
                }
                guard let payload = try JSONSerialization.jsonObject(with: body) as? [String: Any] else { fatalError("Missing POST body") }
                precondition(payload["medium"] as? String == "balance")
                if postStatus == 201 && (!timeout || commitOnTimeout) {
                    let amount = payload["amount"] as! Double
                    if !pending { balance -= amount }
                    let record: [String: Any] = ["_id": "withdrawal-\(postCount)", "status": pending ? "pending" : "completed", "amount": amount,
                                                "description": payload["description"]!]
                    records.append(record)
                    if !timeout { return (201, ["objectCreated": record]) }
                }
                if timeout { throw URLError(.timedOut) }
                return (postStatus, ["message": "fixture rejection"])
            }
            if request.url!.path.hasSuffix("/withdrawals") { return (200, records) }
            return (200, ["_id": "account", "customer_id": owner, "nickname": "Fixture checking", "balance": balance])
        }

        let success = try ledger("success.json")
        let checkoutId = UUID()
        let review = try await success.prepare(customerId: "customer", accountId: "account")
        precondition(review.balanceCents == 10_000)
        let decodedReview = try JSONDecoder().decode(DemoCheckoutAccount.self, from: JSONEncoder().encode(review))
        precondition(decodedReview == review)
        let receipt = try await success.pay(checkoutId: checkoutId, customerId: "customer", accountId: "account", amountCents: 1234)
        precondition(receipt.balanceDeductionObserved && receipt.observedBalanceCents == 8766 && receipt.withdrawalId == "withdrawal-1")
        precondition(postCount == 1 && receipt.responseSHA256?.count == 64)
        let relaunched = try ledger("success.json")
        _ = try await relaunched.pay(checkoutId: checkoutId, customerId: "customer", accountId: "account", amountCents: 1234)
        precondition(postCount == 1, "Relaunch replay must not debit twice")
        do {
            _ = try await relaunched.pay(checkoutId: checkoutId, customerId: "customer", accountId: "account", amountCents: 2345)
            fatalError("Changed immutable checkout accepted")
        } catch DemoCheckoutLedgerError.changedCheckout {}

        timeout = true
        commitOnTimeout = true
        let recovered = try await ledger("recovery.json").pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 321)
        precondition(recovered.balanceDeductionObserved && recovered.withdrawalId == "withdrawal-2")

        commitOnTimeout = false
        let unresolvedId = UUID()
        do {
            _ = try await ledger("unknown.json").pay(checkoutId: unresolvedId, customerId: "customer", accountId: "account", amountCents: 500)
            fatalError("Unconfirmed attempt claimed success")
        } catch DemoCheckoutLedgerError.unresolved {}
        timeout = false
        let resumedUnknown = try ledger("unknown.json")
        for identifier in [unresolvedId, UUID()] {
            do {
                _ = try await resumedUnknown.pay(checkoutId: identifier, customerId: "customer", accountId: "account", amountCents: 500)
                fatalError("Unconfirmed account permitted another debit")
            } catch DemoCheckoutLedgerError.unresolved {}
        }
        precondition(postCount == 3)

        let rejectedLedger = try ledger("rejected.json")
        let rejectedId = UUID()
        postStatus = 403
        for _ in 0..<2 {
            do {
                _ = try await rejectedLedger.pay(checkoutId: rejectedId, customerId: "customer", accountId: "account", amountCents: 400)
                fatalError("Rejected request claimed success")
            } catch DemoCheckoutLedgerError.rejected(let status) { precondition(status == 403) }
        }
        precondition(postCount == 4)
        owner = "someone-else"
        do {
            _ = try await ledger("ownership.json").pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 400)
            fatalError("Wrong owner accepted")
        } catch DemoCheckoutLedgerError.accountMismatch {}
        owner = "customer"
        do {
            _ = try await ledger("insufficient.json").pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 20_000)
            fatalError("Insufficient balance accepted")
        } catch DemoCheckoutLedgerError.insufficientFunds {}
        precondition(postCount == 4)
        postStatus = 201
        pending = true
        let pendingLedger = try ledger("pending.json")
        let pendingId = UUID()
        let pendingReceipt = try await pendingLedger.pay(checkoutId: pendingId, customerId: "customer", accountId: "account", amountCents: 250)
        precondition(!pendingReceipt.balanceDeductionObserved && !pendingReceipt.paymentRejected)
        do {
            _ = try await pendingLedger.pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 250)
            fatalError("Accepted pending withdrawal allowed another debit")
        } catch DemoCheckoutLedgerError.unresolved {}
        precondition(postCount == 5)
        records[records.count - 1]["status"] = "failed"
        let failedReceipt = try await pendingLedger.pay(checkoutId: pendingId, customerId: "customer", accountId: "account", amountCents: 250)
        precondition(failedReceipt.paymentRejected && postCount == 5)
        pending = false
        let nextReceipt = try await pendingLedger.pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 250)
        precondition(nextReceipt.balanceDeductionObserved && postCount == 6)
        balance -= 1 // An unrelated movement means exact before-minus-checkout equality no longer holds.
        let changedBalanceReceipt = try await pendingLedger.pay(checkoutId: nextReceipt.checkoutId, customerId: "customer", accountId: "account", amountCents: 250)
        precondition(!changedBalanceReceipt.balanceDeductionObserved && changedBalanceReceipt.paymentPosted)
        _ = try await pendingLedger.pay(checkoutId: UUID(), customerId: "customer", accountId: "account", amountCents: 100)
        precondition(postCount == 7, "A confirmed posted withdrawal must not block a new checkout because of unrelated balance movements")
        try Data("not JSON".utf8).write(to: temporary.appendingPathComponent("corrupt.json"))
        do { _ = try ledger("corrupt.json"); fatalError("Corrupt ledger accepted") }
        catch DemoCheckoutLedgerError.storage {}
        let attributes = try FileManager.default.attributesOfItem(atPath: temporary.appendingPathComponent("success.json").path)
        precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        print("PASS: sandbox receipt, exact cents, preflight ownership/funds, persistent replay, timeout reconciliation, unknown debit lock, rejection, corrupt ledger, private storage. No live requests.")
    }
}
