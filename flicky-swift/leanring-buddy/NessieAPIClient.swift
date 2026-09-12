// NessieAPIClient.swift — Direct Capital One Nessie API client for Flicky
//
// Fetches live banking data: account balance, bills, deposits, withdrawals.
// All amounts from the Nessie sandbox are in dollars by default.
// Set amountUnit = "cents" in Info.plist if your sandbox uses cents.

import Foundation

class NessieAPIClient {
    private let apiKey: String
    private let baseURL: String
    private let amountUnit: String  // "dollars" or "cents"
    private let session: URLSession

    init(apiKey: String, baseURL: String = "https://prod-api.nessieisreal.com", amountUnit: String = "dollars") {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.amountUnit = amountUnit

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        config.waitsForConnectivity = false
        config.urlCache = nil
        self.session = URLSession(configuration: config)
    }

    // MARK: - Public API

    /// Fetches a full financial snapshot for the given Nessie customer and account,
    /// then computes insights (balance, safe-to-spend, bills, recent activity).
    ///
    /// - Parameters:
    ///   - customerId:      The Nessie customer ID (NESSIE_CUSTOMER_ID in env)
    ///   - nessieAccountId: Optional specific account ID; if nil, uses the first account found
    ///   - reserveCents:    The reserve buffer subtracted from balance for safe-to-spend (default $500)
    func fetchFinancialInsights(
        customerId: String,
        nessieAccountId: String? = nil,
        reserveCents: Int = 50_000
    ) async -> FinancialInsights? {
        do {
            // 1. Resolve account ID (use provided or find first account for customer)
            let resolvedAccountId = try await resolveAccountId(customerId: customerId, preferredAccountId: nessieAccountId)

            // 2. Fetch account details (balance, type, nickname)
            guard let accountData = try await fetchJSON(path: "/accounts/\(resolvedAccountId)") as? [String: Any] else {
                print("⚠️ Nessie: account data missing or malformed")
                return nil
            }

            let balanceDollars = accountData["balance"] as? Double ?? 0
            let balanceCents = dollarsToCents(balanceDollars)
            let accountNickname = accountData["nickname"] as? String
            let accountType = accountData["type"] as? String
            let accountNumber = accountData["account_number"] as? String
            let accountLast4 = accountNumber.map { String($0.suffix(4)) }
            let rewardsPoints = accountData["rewards"] as? Int

            // 3. Fetch bills, deposits, withdrawals in parallel (failures are non-fatal)
            async let billsFetch = fetchJSONArray(path: "/accounts/\(resolvedAccountId)/bills")
            async let depositsFetch = fetchJSONArray(path: "/accounts/\(resolvedAccountId)/deposits")
            async let withdrawalsFetch = fetchJSONArray(path: "/accounts/\(resolvedAccountId)/withdrawals")

            let (billsData, depositsData, withdrawalsData) = await (billsFetch, depositsFetch, withdrawalsFetch)

            // 4. Parse upcoming bills (next 14 days, pending status)
            let today = Date()
            let calendar = Calendar.current
            let fourteenDaysLater = calendar.date(byAdding: .day, value: 14, to: today)!

            let upcomingBills: [UpcomingBill] = billsData.compactMap { bill in
                // Nessie bills can have payment_date or upcoming_payment_date
                let dateString = (bill["payment_date"] as? String) ?? (bill["upcoming_payment_date"] as? String) ?? ""
                guard !dateString.isEmpty,
                      let paymentDate = parseISODate(dateString) else { return nil }

                // Only include bills in the next 14 days that are still pending
                guard paymentDate >= startOfDay(today),
                      paymentDate <= fourteenDaysLater else { return nil }

                let status = bill["status"] as? String ?? ""
                guard status == "pending" || status == "recurring" || status.isEmpty else { return nil }

                let amountRaw = bill["payment_amount"] as? Double ?? 0
                let amountCents = dollarsToCents(amountRaw)
                let isRecurring = bill["recurring_date"] != nil

                let billName = (bill["nickname"] as? String)
                    ?? (bill["payee"] as? String)
                    ?? "Bill"

                return UpcomingBill(
                    id: bill["_id"] as? String ?? UUID().uuidString,
                    label: billName,
                    date: dateString,
                    amountCents: amountCents,
                    recurring: isRecurring
                )
            }.sorted { $0.date < $1.date }

            // 5. Calculate safe-to-spend = balance – upcoming bill total – reserve
            let upcomingBillTotalCents = upcomingBills.reduce(0) { $0 + $1.amountCents }
            let safeToSpendCents = max(0, balanceCents - upcomingBillTotalCents - reserveCents)

            // 6. Recent 30-day activity
            let thirtyDaysAgo = calendar.date(byAdding: .day, value: -30, to: today)!

            let recentDepositsCents = depositsData.reduce(0) { sum, deposit -> Int in
                guard let dateStr = deposit["transaction_date"] as? String,
                      let date = parseISODate(dateStr),
                      date >= thirtyDaysAgo,
                      (deposit["status"] as? String) != "cancelled" else { return sum }
                let amount = deposit["amount"] as? Double ?? 0
                return sum + dollarsToCents(amount)
            }

            let recentWithdrawalsCents = withdrawalsData.reduce(0) { sum, withdrawal -> Int in
                guard let dateStr = withdrawal["transaction_date"] as? String,
                      let date = parseISODate(dateStr),
                      date >= thirtyDaysAgo,
                      (withdrawal["status"] as? String) != "cancelled" else { return sum }
                let amount = withdrawal["amount"] as? Double ?? 0
                return sum + dollarsToCents(amount)
            }

            return FinancialInsights(
                balanceCents: balanceCents,
                safeToSpendCents: safeToSpendCents,
                upcomingBills: upcomingBills,
                expectedIncome: [],
                recentDepositsCents: recentDepositsCents,
                recentWithdrawalsCents: recentWithdrawalsCents,
                accountNickname: accountNickname,
                accountLast4: accountLast4,
                accountType: accountType,
                rewardsPoints: rewardsPoints,
                asOf: Date()
            )
        } catch {
            print("⚠️ Nessie: fetchFinancialInsights failed: \(error.localizedDescription)")
            return nil
        }
    }

    /// Lists all Nessie accounts for the given customer and returns their IDs and nicknames.
    /// Used to verify a login and present account choices.
    func listCustomerAccounts(customerId: String) async -> [[String: Any]] {
        return (try? await fetchJSONArray(path: "/customers/\(customerId)/accounts")) ?? []
    }

    // MARK: - Private Helpers

    /// Resolves the Nessie account ID to use. If `preferredAccountId` is set and
    /// matches a real account, use it. Otherwise, use the first account found.
    private func resolveAccountId(customerId: String, preferredAccountId: String?) async throws -> String {
        if let preferred = preferredAccountId, !preferred.isEmpty {
            return preferred
        }
        let accounts = try await fetchJSONArray(path: "/customers/\(customerId)/accounts")
        guard let firstAccount = accounts.first,
              let accountId = firstAccount["_id"] as? String,
              !accountId.isEmpty else {
            throw NSError(domain: "NessieAPI", code: 404,
                          userInfo: [NSLocalizedDescriptionKey: "No accounts found for customer \(customerId)"])
        }
        return accountId
    }

    private func fetchJSON(path: String) async throws -> Any {
        var urlComponents = URLComponents(string: "\(baseURL)\(path)")!
        urlComponents.queryItems = [URLQueryItem(name: "key", value: apiKey)]
        guard let url = urlComponents.url else {
            throw NSError(domain: "NessieAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL for path: \(path)"])
        }

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "NessieAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "Non-HTTP response"])
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "(empty)"
            throw NSError(domain: "NessieAPI", code: httpResponse.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "HTTP \(httpResponse.statusCode): \(body.prefix(200))"])
        }

        return try JSONSerialization.jsonObject(with: data)
    }

    private func fetchJSONArray(path: String) async throws -> [[String: Any]] {
        let json = try await fetchJSON(path: path)
        return (json as? [[String: Any]]) ?? []
    }

    /// Converts a dollar amount to cents, respecting the configured amount unit.
    /// Nessie sandbox typically uses dollars, but some setups use cents.
    private func dollarsToCents(_ amount: Double) -> Int {
        if amountUnit == "cents" {
            return Int(amount)
        } else {
            return Int(amount * 100.0)
        }
    }

    private func parseISODate(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        if let date = formatter.date(from: string) { return date }

        // Fallback: try with time component
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string)
    }

    private func startOfDay(_ date: Date) -> Date {
        Calendar.current.startOfDay(for: date)
    }
}
