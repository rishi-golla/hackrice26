import Foundation

@main struct PlaidBankConnectionCheck {
    @MainActor static func main() {
        precondition(PlaidBankConnection.hostedURL("https://secure.plaid.com/link/test") != nil)
        for bad in ["http://secure.plaid.com/test", "https://plaid.com.evil.example/test", "https://plaid.com@evil.example/test", "file:///tmp/test"] {
            precondition(PlaidBankConnection.hostedURL(bad) == nil)
        }
        let token: [String: Any] = ["link_sessions": [["results": ["item_add_results": [["public_token": "public-sandbox-test"]]]]]]
        precondition(PlaidBankConnection.publicToken(in: token) == "public-sandbox-test")
        precondition(PlaidBankConnection.publicToken(in: ["link_sessions": [["on_success": ["public_token": "public-production-test"]]]]) == nil)
        let numbers: [String: Any] = ["ach": [["account_id": "a", "account": "never-display", "routing": "never-display"]]]
        let account: [String: Any] = ["account_id": "a", "name": "Checking", "mask": "1234"]
        precondition(PlaidBankConnection.authenticatedAccounts(in: ["accounts": [account], "numbers": numbers]) == ["Checking · •••• 1234"])
        precondition(PlaidBankConnection.authenticatedAccounts(in: ["accounts": [account]]) == [])
        var pending = account
        pending["verification_status"] = "pending_automatic_verification"
        precondition(PlaidBankConnection.authenticatedAccounts(in: ["accounts": [pending], "numbers": numbers]).isEmpty)
        let connection = PlaidBankConnection()
        connection.reset()
        precondition(!connection.isConnecting && connection.accounts.isEmpty && connection.message == nil)
        print("PASS: Plaid destination validation, sandbox-only tokens, masked Auth results, pending verification and reset")
    }
}
