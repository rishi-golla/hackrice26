import Foundation
import AppKit

/// A fully intercepted bank transport; no real credentials or retailer navigation.
private final class ShoppingPaymentFixtureProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Any))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, object) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: object))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}

    static func body(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
        }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
}

@main private struct ShoppingCheckoutCheck {
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("FlickyCheckoutFixture-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ShoppingPaymentFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var balanceCents = 10_000
        var postCount = 0
        var pending = false
        var records: [[String: Any]] = []
        ShoppingPaymentFixtureProtocol.handler = { request in
            if request.httpMethod == "POST" {
                postCount += 1
                let body = try ShoppingPaymentFixtureProtocol.body(request)
                let amount = (body["amount"] as! NSNumber).doubleValue
                if !pending { balanceCents -= Int((amount * 100).rounded()) }
                let record: [String: Any] = ["_id": "withdrawal-\(postCount)", "status": pending ? "pending" : "completed",
                    "amount": amount, "description": body["description"]!]
                records.append(record)
                return (201, ["objectCreated": record])
            }
            if request.url!.path.hasSuffix("/withdrawals") { return (200, records) }
            return (200, ["_id": "account", "customer_id": "customer", "nickname": "Fixture checking", "balance": Double(balanceCents) / 100])
        }
        func makeLedger(_ name: String) throws -> DemoCheckoutLedger {
            try DemoCheckoutLedger(apiKey: "fixture-only", storageURL: directory.appendingPathComponent(name), session: session)
        }
        func seed(_ store: ShoppingBasketStore) {
            for (url, title, cents) in [("https://example.com/ghosts", "Ghost decoration", 999), ("https://example.org/candy", "Candy bag", 1249)] {
                store.addVerifiedPage(VerifiedProductPage(productURL: url, title: title, imageURL: url + ".jpg", unitPriceCents: cents,
                    currency: "USD", availability: .inStock, observedAt: Date(), evidence: "Fixture metadata", limitations: []))
            }
            store.setQuantity(2, for: store.lines[1].id)
        }
        let storeURL = directory.appendingPathComponent("basket.json")
        let store = ShoppingBasketStore(storageURL: storeURL)
        seed(store)
        precondition(store.readyForDemoCheckout && store.estimatedSubtotalCents == 3497)
        var openedURLs: [URL] = []
        var refreshes = 0
        let draftURL = directory.appendingPathComponent("checkout.json")
        let checkout = ShoppingCheckoutCoordinator(storageURL: draftURL, ledger: try makeLedger("ledger.json"), animateTasks: false,
            openProductLink: { openedURLs.append($0); return true })
        checkout.currentIdentity = { ("customer", "account") }
        checkout.onRefreshBalance = { refreshes += 1 }
        checkout.prepare(store: store)
        await settle(checkout)
        guard let review = checkout.draft else { fatalError("Review missing: \(store.message ?? "")") }
        precondition(review.totalCents == 3497 && review.account.balanceCents == 10_000 && store.isLocked)
        store.setQuantity(99, for: store.lines[0].id)
        store.remove(store.lines[0].id)
        precondition(store.estimatedSubtotalCents == 3497 && checkout.draft?.id == review.id)
        let savedReview = try JSONDecoder().decode(ShoppingCheckoutDraft.self, from: Data(contentsOf: draftURL))
        precondition(savedReview.id == review.id && !savedReview.attemptedPayment)
        checkout.pay(store: store)
        checkout.pay(store: store)
        await settle(checkout)
        guard let completed = checkout.draft, let receipt = completed.receipt else { fatalError(checkout.errorMessage ?? "No receipt") }
        precondition(postCount == 1 && completed.attemptedPayment && receipt.balanceDeductionObserved)
        precondition(receipt.balanceBeforeCents == 10_000 && receipt.observedBalanceCents == 6503 && balanceCents == 6503)
        precondition(completed.tasks.count == 2 && completed.tasks.allSatisfy { $0.stage == .demoOrder })
        precondition(Set(openedURLs.map(\.absoluteString)) == Set(review.tasks.map(\.url)) && openedURLs.count == 2 && refreshes == 1)
        checkout.pay(store: store)
        await settle(checkout)
        precondition(postCount == 1 && openedURLs.count == 2, "Completed resume must not repeat debit or open finished tasks")
        var interrupted = completed
        interrupted.tasks[0].stage = .opened
        let interruptedURL = directory.appendingPathComponent("interrupted-checkout.json")
        try JSONEncoder().encode(interrupted).write(to: interruptedURL)
        var remainingOpens = 0
        let interruptedCheckout = ShoppingCheckoutCoordinator(storageURL: interruptedURL, ledger: try makeLedger("ledger.json"), animateTasks: false,
            openProductLink: { _ in remainingOpens += 1; return true })
        interruptedCheckout.currentIdentity = { ("customer", "account") }
        precondition(!interruptedCheckout.canFinish)
        interruptedCheckout.finish(store: store)
        precondition(interruptedCheckout.draft != nil && !store.lines.isEmpty)
        interruptedCheckout.pay(store: store)
        await settle(interruptedCheckout)
        precondition(interruptedCheckout.canFinish && remainingOpens == 1 && postCount == 1)
        checkout.finish(store: store)
        precondition(checkout.draft == nil && store.lines.isEmpty && !store.isLocked)
        precondition(ShoppingBasketStore(storageURL: storeURL).lines.isEmpty && !FileManager.default.fileExists(atPath: draftURL.path))
        let receiptURL = directory.appendingPathComponent("checkout-receipt-\(review.id.uuidString).json")
        let archived = try JSONDecoder().decode(ShoppingCheckoutDraft.self, from: Data(contentsOf: receiptURL))
        precondition(archived.receipt == receipt && archived.tasks.allSatisfy { $0.stage == .demoOrder })

        // A pending accepted debit survives relaunch; resume reads the same memo without another POST.
        pending = true
        let pendingStore = ShoppingBasketStore(storageURL: directory.appendingPathComponent("pending-basket.json"))
        seed(pendingStore)
        let pendingURL = directory.appendingPathComponent("pending-checkout.json")
        let pendingCheckout = ShoppingCheckoutCoordinator(storageURL: pendingURL, ledger: try makeLedger("pending-ledger.json"), animateTasks: false, openProductLink: { _ in true })
        pendingCheckout.currentIdentity = { ("customer", "account") }
        pendingCheckout.prepare(store: pendingStore)
        await settle(pendingCheckout)
        pendingCheckout.pay(store: pendingStore)
        await settle(pendingCheckout)
        let pendingId = pendingCheckout.draft!.id
        precondition(pendingCheckout.draft?.attemptedPayment == true && pendingCheckout.draft?.receipt?.balanceDeductionObserved == false && postCount == 2)
        pendingCheckout.finish(store: pendingStore)
        precondition(pendingCheckout.draft != nil && pendingStore.isLocked)
        var resumedOpenCount = 0
        let resumed = ShoppingCheckoutCoordinator(storageURL: pendingURL, ledger: try makeLedger("pending-ledger.json"), animateTasks: false,
            openProductLink: { _ in resumedOpenCount += 1; return true })
        resumed.currentIdentity = { ("customer", "account") }
        resumed.restoreLock(on: pendingStore)
        resumed.cancelReview(store: pendingStore)
        precondition(resumed.draft?.id == pendingId && pendingStore.isLocked)
        pending = false
        records[records.count - 1]["status"] = "completed"
        balanceCents -= 3497
        resumed.pay(store: pendingStore)
        await settle(resumed)
        precondition(resumed.draft?.id == pendingId && resumed.draft?.receipt?.balanceDeductionObserved == true && postCount == 2 && resumedOpenCount == 0)
        resumed.finish(store: pendingStore)
        precondition(resumed.draft == nil && pendingStore.lines.isEmpty)

        let corruptURL = directory.appendingPathComponent("corrupt-checkout.json")
        try Data("corrupt".utf8).write(to: corruptURL)
        let blockedStore = ShoppingBasketStore(storageURL: directory.appendingPathComponent("blocked-basket.json"))
        seed(blockedStore)
        let blocked = ShoppingCheckoutCoordinator(storageURL: corruptURL, ledger: try makeLedger("blocked-ledger.json"), animateTasks: false, openProductLink: { _ in fatalError("Unexpected browser open") })
        blocked.currentIdentity = { ("customer", "account") }
        blocked.restoreLock(on: blockedStore)
        blocked.prepare(store: blockedStore)
        precondition(blockedStore.isLocked && blocked.draft == nil && !blocked.isBusy && blocked.errorMessage != nil && postCount == 2)
        print("PASS: checkout review/snapshot lock, duplicate Pay suppression, exact sandbox debit and balance refresh, per-item simulated tasks, receipt archival/basket clearing, pending relaunch reconciliation, corrupt draft lock. No real requests or browser opens.")
    }

    @MainActor private static func settle(_ checkout: ShoppingCheckoutCoordinator) async {
        for _ in 0..<500 {
            if !checkout.isBusy { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        fatalError("Checkout did not settle within five seconds")
    }
}
