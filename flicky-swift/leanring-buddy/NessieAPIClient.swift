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

            let (billsData, depositsData, withdrawalsData) = try await (billsFetch, depositsFetch, withdrawalsFetch)

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

            // 4b. Every recurring bill regardless of when its next charge
            // falls — powers the "Subscriptions" tracker, which needs the
            // full recurring commitment (e.g. a $15/mo streaming charge due
            // in 3 weeks), not just what's due in the next 14 days.
            let recurringBills: [UpcomingBill] = billsData.compactMap { bill in
                guard bill["recurring_date"] != nil else { return nil }

                let dateString = (bill["payment_date"] as? String) ?? (bill["upcoming_payment_date"] as? String) ?? ""
                let amountRaw = bill["payment_amount"] as? Double ?? 0
                let billName = (bill["nickname"] as? String) ?? (bill["payee"] as? String) ?? "Subscription"

                return UpcomingBill(
                    id: bill["_id"] as? String ?? UUID().uuidString,
                    label: billName,
                    date: dateString,
                    amountCents: dollarsToCents(amountRaw),
                    recurring: true
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

            // 7. Spending by category — best-effort, never blocks the rest of
            // the dashboard. Nessie's `/purchases` records what was bought
            // and which merchant it came from; the merchant itself carries
            // the category tag (e.g. "Fast Food", "Clothing", "Gas"). If the
            // sandbox account has no purchases yet this simply comes back
            // empty and the dashboard shows an honest empty state instead of
            // guessing categories from unrelated data.
            let spendingByCategory = await fetchSpendingByCategory(
                accountId: resolvedAccountId,
                since: thirtyDaysAgo
            )

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
                asOf: Date(),
                recurringBills: recurringBills,
                spendingByCategory: spendingByCategory
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

    /// Builds a spending-by-category breakdown for the given account over
    /// the last `since` window, by joining Nessie's `/purchases` against
    /// `/merchants` (merchants carry the category tag). Entirely best-effort:
    /// any failure (no purchases endpoint access, empty sandbox data, a
    /// merchant lookup failing) degrades to an empty array rather than
    /// throwing, so this can never break the rest of the financial snapshot.
    private func fetchSpendingByCategory(accountId: String, since: Date) async -> [CategorySpending] {
        guard let purchasesData = try? await fetchJSONArray(path: "/accounts/\(accountId)/purchases") else {
            return []
        }

        // Only recent, non-cancelled purchases count toward the breakdown —
        // matches the same "last 30 days" window used for deposits/withdrawals.
        let recentPurchases = purchasesData.filter { purchase in
            guard let dateStr = purchase["purchase_date"] as? String,
                  let date = parseISODate(dateStr) else { return false }
            return date >= since && (purchase["status"] as? String) != "cancelled"
        }
        guard !recentPurchases.isEmpty else { return [] }

        // Fetch each distinct merchant exactly once (purchases frequently
        // repeat the same merchant), in parallel, so this stays fast even
        // with dozens of purchases.
        let uniqueMerchantIds = Set(recentPurchases.compactMap { $0["merchant_id"] as? String })
        var merchantCategoryById: [String: String] = [:]

        await withTaskGroup(of: (String, String?).self) { taskGroup in
            for merchantId in uniqueMerchantIds {
                taskGroup.addTask {
                    guard let merchantData = try? await self.fetchJSON(path: "/merchants/\(merchantId)") as? [String: Any] else {
                        return (merchantId, nil)
                    }
                    // Nessie merchants store category as either a single
                    // string or an array of tags depending on how the
                    // sandbox record was seeded — handle both.
                    if let categoryArray = merchantData["category"] as? [String], let first = categoryArray.first {
                        return (merchantId, first)
                    }
                    if let categoryString = merchantData["category"] as? String, !categoryString.isEmpty {
                        return (merchantId, categoryString)
                    }
                    return (merchantId, nil)
                }
            }
            for await (merchantId, category) in taskGroup {
                merchantCategoryById[merchantId] = category
            }
        }

        // Aggregate purchase totals per category.
        var totalCentsByCategory: [String: Int] = [:]
        var countByCategory: [String: Int] = [:]

        for purchase in recentPurchases {
            guard let merchantId = purchase["merchant_id"] as? String else { continue }
            let category = (merchantCategoryById[merchantId] ?? "Other").capitalized
            let amount = purchase["amount"] as? Double ?? 0
            totalCentsByCategory[category, default: 0] += dollarsToCents(amount)
            countByCategory[category, default: 0] += 1
        }

        return totalCentsByCategory
            .map { category, totalCents in
                CategorySpending(
                    id: category,
                    category: category,
                    totalCents: totalCents,
                    transactionCount: countByCategory[category] ?? 0
                )
            }
            .sorted { $0.totalCents > $1.totalCents }
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
