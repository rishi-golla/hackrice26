import Foundation
import Combine
import CryptoKit

struct CreditBorrowingRequest: Equatable {
    var principalCents: Int?
    var months: Int?
    var annualRatePercent: Double?

    var summary: String {
        [principalCents.map(CreditSimulationEngine.money), months.map { "\($0) months" },
         annualRatePercent.map { "\($0.formatted())% requested APR" }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func parse(_ question: String) -> Self? {
        let text = question.lowercased().replacingOccurrences(of: "’", with: "'")
        func contains(_ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
        guard !contains(#"\b(don't|do not|never)\b.*\b(open|show|borrow|loan|credit)\b"#),
              !contains(#"\b(open|visit|navigate|go to)\b.*\b(website|site|https|capital one|sofi|wells fargo)\b"#) else { return nil }
        let numberWords = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand"
        let number = #"(?:[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*k?\b|(?:"# + numberWords + #")(?:[\s-]+(?:and|"# + numberWords + #"))*)"#
        func match(_ pattern: String) -> [String]? {
            guard let expression = try? NSRegularExpression(pattern: pattern),
                  let found = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
            return (1..<found.numberOfRanges).map { index in
                Range(found.range(at: index), in: text).map { String(text[$0]) } ?? ""
            }
        }
        func value(_ raw: String) -> Double? {
            let cleaned = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
            if cleaned.hasSuffix("k"), let numeric = Double(cleaned.dropLast().trimmingCharacters(in: .whitespaces)) { return numeric * 1000 }
            if let numeric = Double(cleaned) { return numeric }
            let smallWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                              "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
            let tens = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
            var total = 0
            var group = 0
            for word in cleaned.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init) {
                if word == "and" { continue }
                if let small = smallWords.firstIndex(of: word) { group += small }
                else if let ten = tens[word] { group += ten }
                else if word == "hundred" { group = max(1, group) * 100 }
                else if word == "thousand" { total += max(1, group) * 1000; group = 0 }
                else { return nil }
            }
            return Double(total + group)
        }
        let borrowingIntent = contains(#"\b(borrow|borrowing|loan|loans|financing)\b|\bcredit\s+(options|comparison|simulation)\b"#)
        let nonMoneyUnit = #"(\s*(?:months?|years?|percent|%))?"#
        let amountMatch = match(#"(?:\$\s*|\b(?:need|borrow|borrowing)\s+(?:(?:a|personal|loan|of|for|about|around)\s+)*)("# + number + #")(?![\w])"# + nonMoneyUnit)
        let loanAmountMatch = match(#"\bloan\s+(?:of\s+|for\s+)?\$?\s*("# + number + #")"# + nonMoneyUnit)
        let amount = (amountMatch ?? loanAmountMatch).flatMap { $0[1].isEmpty ? value($0[0]) : nil }
        let needsMoney = contains(#"\b(?:i\s+|we\s+)?need\s+(?:about\s+|around\s+)?\$?\s*"# + number)
        guard borrowingIntent || (needsMoney && amount != nil) else { return nil }
        // A stated price or income on its own must not redirect ordinary shopping/account questions.
        if !borrowingIntent && contains(#"\b(salary|income|balance|save|saving|spend|budget|cost|price|laptop|monitor|keyboard)\b"#) { return nil }
        var request = Self()
        if let amount, amount.isFinite, (1...100_000).contains(amount) { request.principalCents = Int((amount * 100).rounded()) }
        if let term = match(#"("# + number + #")\s*[- ]?\s*(months?|years?)\b"#),
           let count = value(term[0]) {
            let months = count * (term[1].hasPrefix("year") ? 12 : 1)
            if months.rounded() == months, (1...120).contains(months) { request.months = Int(months) }
        }
        if let rate = match(#"("# + number + #")\s*(?:%|percent)"#).flatMap({ value($0[0]) }),
           rate.isFinite, (0...100).contains(rate) { request.annualRatePercent = rate }
        return request
    }
}

struct CreditSimulationInput: Codable, Equatable {
    var score: Int
    var principalCents: Int
    var monthlyIncomeCents: Int
    var monthlyDebtCents: Int
    var wellsFargoCustomer: Bool

    func validate() throws {
        guard (300...850).contains(score) else { throw CreditSimulationError.invalid("Enter a whole credit score from 300 to 850.") }
        guard (100_000...10_000_000).contains(principalCents) else { throw CreditSimulationError.invalid("Enter a loan amount from $1,000 to $100,000.") }
        guard (100...100_000_000).contains(monthlyIncomeCents) else { throw CreditSimulationError.invalid("Enter monthly gross income from $1 to $1,000,000.") }
        guard (0...100_000_000).contains(monthlyDebtCents) else { throw CreditSimulationError.invalid("Enter monthly debt payments from $0 to $1,000,000.") }
    }

    static func parse(score: String, amount: String, income: String, debt: String, wellsFargoCustomer: Bool) throws -> Self {
        let scoreText = score.trimmingCharacters(in: .whitespacesAndNewlines)
        guard scoreText.range(of: #"^[0-9]{3}$"#, options: .regularExpression) != nil,
              let scoreValue = Int(scoreText) else { throw CreditSimulationError.invalid("Enter a whole credit score from 300 to 850.") }
        func cents(_ text: String, label: String) throws -> Int {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.range(of: #"^[0-9]{1,7}(\.[0-9]{1,2})?$"#, options: .regularExpression) != nil,
                  let decimal = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")) else {
                throw CreditSimulationError.invalid("Enter \(label) in dollars, using digits and up to two decimal places.")
            }
            return NSDecimalNumber(decimal: decimal * 100).intValue
        }
        let input = try Self(score: scoreValue, principalCents: cents(amount, label: "the loan amount"),
            monthlyIncomeCents: cents(income, label: "monthly income"), monthlyDebtCents: cents(debt, label: "monthly debt"),
            wellsFargoCustomer: wellsFargoCustomer)
        try input.validate()
        return input
    }
}

enum CreditSimulationError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case let .invalid(message) = self { return message }; return nil }
}

struct CreditLoanScenario: Codable, Identifiable, Equatable {
    let id: String
    let lender: String
    let months: Int
    let annualRatePercent: Double
    let monthlyPaymentCents: Int
    let finalPaymentCents: Int
    let totalPaymentCents: Int
    let interestCents: Int
    let debtToIncomePercent: Double
    let sourceURL: String
    let publishedRange: String
    let conditions: String
}

struct CreditNessieContext: Codable, Equatable {
    let observedAt: Date
    let balanceCents: Int
    let depositsCents: Int
    let withdrawalsCents: Int

    init(snapshot: FinancialInsights) {
        observedAt = snapshot.asOf
        balanceCents = snapshot.balanceCents
        depositsCents = snapshot.recentDepositsCents
        withdrawalsCents = snapshot.recentWithdrawalsCents
    }
}

struct CreditSimulationRun: Codable, Identifiable {
    let id: UUID
    let createdAt: Date
    let input: CreditSimulationInput
    let scenarios: [CreditLoanScenario]
    let nessie: CreditNessieContext?
    var selectedScenarioID: String?
    var savedOnMac: Bool
    let catalogVersion: String
    var reference: String { "SIM-" + id.uuidString.prefix(8) }
}

enum CreditSimulationEngine {
    static let catalogVersion = "2026-09-13"
    static let sofiURL = "https://www.sofi.com/personal-loans/personal-loan-rates/"
    static let wellsFargoURL = "https://www.wellsfargo.com/personal-loans/"
    static let allowedSourceURLs = [sofiURL, wellsFargoURL]

    static func money(_ cents: Int) -> String {
        (Double(cents) / 100).formatted(.currency(code: "USD"))
    }

    // A transparent teaching rule, not a lender underwriting model or a score forecast.
    static func modeledRate(score: Int, minimum: Double, maximum: Double) -> Double {
        let position = Double(850 - min(850, max(300, score))) / 550
        return ((minimum + position * (maximum - minimum)) * 100).rounded() / 100
    }

    static func payments(principalCents: Int, annualRatePercent: Double, months: Int) throws -> (monthly: Int, final: Int, total: Int) {
        guard (1...10_000_000).contains(principalCents), (1...120).contains(months),
              annualRatePercent.isFinite, (0...100).contains(annualRatePercent) else {
            throw CreditSimulationError.invalid("The payment calculation has invalid inputs.")
        }
        let monthlyRate = annualRatePercent / 1200
        let payment = monthlyRate == 0 ? Double(principalCents) / Double(months)
            : Double(principalCents) * monthlyRate / (1 - pow(1 + monthlyRate, -Double(months)))
        let monthly = Int(payment.rounded())
        var balance = principalCents
        var total = 0
        var final = 0
        for month in 1...months {
            let interest = Int((Double(balance) * monthlyRate).rounded())
            let due = balance + interest
            let paid = month == months ? due : min(due, monthly)
            total += paid
            balance = due - paid
            final = paid
        }
        return (monthly, final, total)
    }

    static func simulate(input: CreditSimulationInput, nessie: CreditNessieContext?, save: Bool, now: Date = Date()) throws -> CreditSimulationRun {
        try input.validate()
        var scenarios: [CreditLoanScenario] = []
        func add(id: String, lender: String, months: Int, minimum: Double, maximum: Double, source: String, conditions: String) throws {
            let rate = modeledRate(score: input.score, minimum: minimum, maximum: maximum)
            let payment = try payments(principalCents: input.principalCents, annualRatePercent: rate, months: months)
            scenarios.append(CreditLoanScenario(id: id, lender: lender, months: months, annualRatePercent: rate,
                monthlyPaymentCents: payment.monthly, finalPaymentCents: payment.final, totalPaymentCents: payment.total,
                interestCents: payment.total - input.principalCents,
                debtToIncomePercent: Double(input.monthlyDebtCents + payment.monthly) / Double(input.monthlyIncomeCents) * 100,
                sourceURL: source, publishedRange: String(format: "%.2f–%.2f%% APR", minimum, maximum), conditions: conditions))
        }
        // These are scaled no-fee payment examples, not claims that this amount qualifies.
        for (months, minimum) in [(36, 7.38), (48, 8.23), (60, 9.50)] {
            try add(id: "sofi-\(months)", lender: "SoFi", months: months, minimum: minimum, maximum: 35.49,
                source: sofiURL, conditions: "Based on published $30,000 no-origination-fee examples, scaled to your amount. Assumes 0.25% autopay and 0.25% member discounts. Amount and state eligibility are not checked.")
        }
        if input.wellsFargoCustomer && input.principalCents >= 1_000_000 {
            try add(id: "wells-36", lender: "Wells Fargo", months: 36, minimum: 6.74, maximum: 26.74,
                source: wellsFargoURL, conditions: "Published example range for $10,000+ over 36 months; assumes a 0.25% relationship discount and no origination fee. Requires 12+ months as a customer; other eligibility is not checked.")
        }
        let usableContext = nessie.flatMap { context in
            now.timeIntervalSince(context.observedAt) >= -60 && now.timeIntervalSince(context.observedAt) <= 300 ? context : nil
        }
        return CreditSimulationRun(id: UUID(), createdAt: now, input: input, scenarios: scenarios,
            nessie: usableContext, selectedScenarioID: nil, savedOnMac: save, catalogVersion: catalogVersion)
    }
}

@MainActor
final class CreditSimulationStore: ObservableObject {
    @Published var borrowingRequest: CreditBorrowingRequest?
    @Published private(set) var runs: [CreditSimulationRun] = []
    @Published private(set) var savedRunIDs: Set<UUID> = []
    @Published private(set) var result: CreditSimulationRun?
    @Published private(set) var nessie: CreditNessieContext?
    @Published private(set) var accountKey: String?
    @Published var message: String?
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Flicky/credit-simulations", isDirectory: true)
    }

    func updateContext(accountKey: String?, snapshot: FinancialInsights?) {
        if self.accountKey != accountKey {
            borrowingRequest = nil
            self.accountKey = accountKey
            runs = []
            savedRunIDs = []
            result = nil
            message = nil
            restore()
        }
        nessie = snapshot.map(CreditNessieContext.init)
    }

    func resetSession() {
        borrowingRequest = nil
        accountKey = nil; nessie = nil; runs = []; savedRunIDs = []; result = nil; message = nil
    }

    func run(input: CreditSimulationInput, save: Bool) {
        do {
            let run = try CreditSimulationEngine.simulate(input: input, nessie: nessie, save: save && accountKey != nil)
            runs.insert(run, at: 0)
            runs = Array(runs.prefix(30))
            result = run
            message = nil
            persist()
        } catch { result = nil; message = error.localizedDescription }
    }

    func select(_ scenarioID: String) {
        guard var run = result, run.scenarios.contains(where: { $0.id == scenarioID }),
              let index = runs.firstIndex(where: { $0.id == run.id }) else { return }
        run.selectedScenarioID = scenarioID
        result = run
        runs[index] = run
        persist()
    }

    func review(_ id: UUID) { result = runs.first { $0.id == id } }
    func resetResult() { result = nil; message = nil }

    func clearHistory() {
        do {
            if let fileURL, FileManager.default.fileExists(atPath: fileURL.path) { try FileManager.default.removeItem(at: fileURL) }
            runs = []; savedRunIDs = []; result = nil; message = nil
        } catch { message = "Couldn’t delete saved history. Check file access and try again." }
    }

    private var fileURL: URL? {
        accountKey.map { key in
            let hash = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
            return directory.appendingPathComponent(hash + ".json")
        }
    }

    private func persist() {
        guard let fileURL else { return }
        do {
            let saved = runs.filter(\.savedOnMac)
            if saved.isEmpty {
                if FileManager.default.fileExists(atPath: fileURL.path) { try FileManager.default.removeItem(at: fileURL) }
                savedRunIDs = []
                return
            }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            let data = try JSONEncoder().encode(saved)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            savedRunIDs = Set(saved.map(\.id))
        } catch { message = "The simulation is available, but history couldn’t be saved on this Mac. Check file access and retry." }
    }

    private func restore() {
        guard let fileURL, FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            guard let size = attributes[.size] as? NSNumber, size.intValue <= 1_000_000 else {
                throw CreditSimulationError.invalid("History is too large.")
            }
            let data = try Data(contentsOf: fileURL)
            guard data.count <= 1_000_000 else { throw CreditSimulationError.invalid("History is too large.") }
            let saved = try JSONDecoder().decode([CreditSimulationRun].self, from: data)
            guard saved.count <= 30 else { throw CreditSimulationError.invalid("History is too large.") }
            for run in saved {
                try run.input.validate()
                guard run.scenarios.count <= 4, run.scenarios.allSatisfy({ scenario in
                    CreditSimulationEngine.allowedSourceURLs.contains(scenario.sourceURL)
                    && scenario.monthlyPaymentCents > 0 && scenario.totalPaymentCents >= run.input.principalCents
                    && scenario.annualRatePercent.isFinite && (0...100).contains(scenario.annualRatePercent)
                    && [36, 48, 60].contains(scenario.months)
                }) else { throw CreditSimulationError.invalid("History contains invalid results.") }
            }
            runs = saved
            savedRunIDs = Set(saved.map(\.id))
        } catch { message = "Saved history couldn’t be read. Clear history to remove it, or run a new simulation." }
    }
}
