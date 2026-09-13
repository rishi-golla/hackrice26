import Foundation

private final class FixtureProtocol: URLProtocol {
    static var purchasesUnavailable = false
    static var accountMalformed = false
    static var billsMalformed = false
    static var invalidAmount = false
    static var ownershipMismatch = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        let old = "2000-01-01"
        var status = 200
        let body: String
        if path == "/customers/test" || path == "/enterprise/customers/test" {
            body = #"{"_id":"test","first_name":"Fixture","last_name":"Customer"}"#
        } else if path == "/customers/test/accounts" {
            body = Self.ownershipMismatch ? #"[{"_id":"test","customer_id":"another-customer"}]"# : #"[{"_id":"test","customer_id":"test","nickname":"Fixture checking","type":"Checking","balance":1000.29,"account_number":"1234567812345678"}]"#
        } else if path.hasSuffix("/purchases") {
            status = Self.purchasesUnavailable ? 503 : 200
            body = """
            [{"amount":0.29,"purchase_date":"\(today)","status":"completed","merchant_id":"grocer"},
             {"amount":99,"purchase_date":"\(today)","status":"pending"},
             {"amount":99,"purchase_date":"2099-01-01","status":"completed"},
             {"amount":2,"purchase_date":"\(today)","status":"completed"}]
            """
        } else if path.hasSuffix("/bills") {
            body = Self.billsMalformed ? "{}" : """
            [{"_id":"rent","payment_amount":100,"payment_date":"\(old)","upcoming_payment_date":"\(today)","status":"pending","payee":"Rent"}]
            """
        } else if path.hasSuffix("/deposits") {
            body = Self.invalidAmount ? "[{\"amount\":null}]" : """
            [{"amount":10.29,"transaction_date":"\(today)","status":"completed"},
             {"amount":99,"transaction_date":"2099-01-01","status":"completed"},
             {"amount":99,"transaction_date":"\(today)","status":"cancelled"},
             {"amount":99,"transaction_date":"\(today)","status":"pending"}]
            """
        } else if path.hasSuffix("/withdrawals") { body = "[]" }
        else if path.contains("/merchants/") { body = "{\"category\":[\"Groceries\"]}" }
        else { body = Self.accountMalformed ? "{}" : "{\"balance\":1000.29}" }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
struct NessieEvidenceCheck {
    static func main() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureProtocol.self]
        let client = NessieAPIClient(apiKey: "test-only", session: URLSession(configuration: configuration))
        let profile = try! await client.fetchCustomerProfile(customerId: "test")
        precondition(profile.name == "Fixture Customer" && profile.accounts.count == 1)
        precondition(profile.accounts[0].last4 == "5678")
        FixtureProtocol.ownershipMismatch = true
        do {
            _ = try await client.fetchCustomerProfile(customerId: "test")
            preconditionFailure("An account owned by another customer must be rejected")
        } catch {}
        FixtureProtocol.ownershipMismatch = false
        let snapshot = await client.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(snapshot?.balanceCents == 100029, "Money rounds to cents")
        precondition(snapshot?.safeToSpendCents == 40029, "Upcoming date overrides past payment date")
        precondition(snapshot?.recentDepositsCents == 1029, "Pending, cancelled, and future movements excluded")
        precondition(snapshot?.spendingByCategory.reduce(0) { $0 + $1.totalCents } == 229, "Uncategorized purchases included and pending/future purchases excluded")
        precondition(snapshot?.isSpendingDataAvailable == true)
        precondition(snapshot?.toSystemPromptContext().contains("Health score") == false)
        FixtureProtocol.purchasesUnavailable = true
        let partial = await client.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(partial != nil && partial?.isSpendingDataAvailable == false, "Optional endpoint failure is explicitly unavailable")
        FixtureProtocol.accountMalformed = true
        let missingBalance = await client.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(missingBalance == nil, "Malformed balance never becomes zero or mock data")
        FixtureProtocol.accountMalformed = false
        FixtureProtocol.billsMalformed = true
        let missingBills = await client.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(missingBills == nil, "Malformed bills never become zero obligations")
        FixtureProtocol.billsMalformed = false
        FixtureProtocol.invalidAmount = true
        let invalidAmount = await client.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(invalidAmount == nil, "Missing monetary fields fail closed")
        let receipts = await client.requestReceipts()
        precondition(receipts.contains { $0.statusCode == 503 }, "Failed requests remain visible in evidence")
        precondition(receipts.allSatisfy { !$0.path.contains("?") && !$0.responsePreview.contains("test-only") && !$0.responsePreview.contains("1234567812345678") }, "Logs never expose API keys or full account numbers")
        precondition(receipts.allSatisfy { $0.statusCode == nil ? $0.responseSHA256 == nil : $0.responseSHA256?.count == 64 }, "Only received responses have a byte digest; cancelled requests do not")
        FixtureProtocol.invalidAmount = false
        FixtureProtocol.purchasesUnavailable = false
        let enterpriseClient = NessieAPIClient(apiKey: "test-only", session: URLSession(configuration: configuration), useEnterpriseData: true)
        let enterpriseProfile = try! await enterpriseClient.fetchCustomerProfile(customerId: "test")
        let enterpriseSnapshot = await enterpriseClient.fetchFinancialInsights(customerId: "test", nessieAccountId: "test")
        precondition(enterpriseProfile.name == "Fixture Customer" && enterpriseSnapshot?.balanceCents == 100029)
        let enterprisePaths = Set(await enterpriseClient.requestReceipts().map { $0.path })
        precondition(enterprisePaths.contains("/enterprise/customers/test") && enterprisePaths.contains("/enterprise/accounts/test") && enterprisePaths.contains("/enterprise/merchants/grocer"))
        precondition(enterprisePaths.contains("/customers/test/accounts") && enterprisePaths.contains("/accounts/test/bills"), "Related collections use the API's shared relationship routes")
        print("PASS: Customer identity, account discovery, request recording, and credential redaction")
        print("PASS: Nessie evidence checks (rounding, dates, statuses, unknown merchants, partial failure, malformed collections and amounts)")
    }
}
