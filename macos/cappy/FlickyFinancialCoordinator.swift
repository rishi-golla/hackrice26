//
// Flicky financial guardrail built on Clicky's native macOS capture and voice loop.
// Clicky owns permissions, dictation, audio and cursor windows; this file owns
// only deterministic financial interpretation and never sends a screenshot to a
// language model or provider.
//

import AppKit
import Foundation
import Vision

struct FlickyFinancialForecast {
    let purchaseCents: Int
    let minimumCents: Int
    let minimumDate: String
    let safeToSpendCents: Int
    let status: String
    let reason: String
}

@MainActor
final class FlickyFinancialCoordinator {
    private struct CashEvent {
        let date: String
        let cents: Int
        let label: String
    }

    private let startingBalanceCents = 80_000
    private let reserveCents = 10_000
    private let today = "2026-09-12"
    private var lastPurchaseCents: Int?
    private var lastPurchaseLabel = "screen purchase"

    /// Returns a grounded answer only for money questions. Other Clicky
    /// questions continue through Clicky's normal Claude pipeline.
    func answer(for transcript: String, screenCaptures: [CompanionScreenCapture]) async -> String? {
        let normalized = transcript.lowercased()
        guard isFinancialQuestion(normalized) else { return nil }

        let screenText = await Self.recognizeText(in: screenCaptures.first?.imageData)
        let detectedCents = parseCents(from: transcript) ?? parseCheckoutCents(from: screenText)
        if let detectedCents { lastPurchaseCents = detectedCents }

        guard let purchaseCents = lastPurchaseCents, purchaseCents > 0 else {
            return "i couldn't find a final usd total on screen. say the amount, like two hundred dollars, and i'll project it."
        }

        let purchaseDate = resolveDate(normalized)
        let forecast = forecast(purchaseCents: purchaseCents, date: purchaseDate)
        let amount = formatUSD(purchaseCents)
        let minimum = formatUSD(forecast.minimumCents)
        let reserve = formatUSD(reserveCents)
        let answer: String
        switch forecast.status {
        case "negative":
            answer = "no. (amount) for (lastPurchaseLabel) projects (minimum) on (forecast.minimumDate). (forecast.reason)"
        case "below-reserve":
            answer = "careful. (amount) leaves a projected low of (minimum) on (forecast.minimumDate), below your (reserve) reserve. (forecast.reason)"
        default:
            answer = "yes. (amount) leaves a projected low of (minimum) on (forecast.minimumDate), within your (reserve) reserve. (forecast.reason)"
        }
        lastPurchaseLabel = "screen purchase"
        return answer
    }

    func reset() {
        lastPurchaseCents = nil
        lastPurchaseLabel = "screen purchase"
    }

    private func isFinancialQuestion(_ text: String) -> Bool {
        text.contains("afford") || text.contains("balance") || text.contains("spend")
            || text.contains("purchase") || text.contains("buy") || text.contains("checkout")
            || text.contains("rent") || text.contains("bill") || text.contains("money")
            || text.contains("dollar") || text.contains("what if")
    }

    private func forecast(purchaseCents: Int, date: String) -> FlickyFinancialForecast {
        let events = [
            CashEvent(date: "2026-09-14", cents: -60_000, label: "rent"),
            CashEvent(date: "2026-09-16", cents: -8_000, label: "utilities"),
            CashEvent(date: "2026-09-19", cents: 100_000, label: "scheduled income"),
        ]
        var balance = startingBalanceCents
        var minimum = startingBalanceCents
        var minimumDate = today
        for offset in 0..<14 {
            let currentDate = addDays(today, offset)
            var dayEvents = events.filter { $0.date == currentDate }
            if currentDate == date { dayEvents.append(CashEvent(date: date, cents: -purchaseCents, label: "purchase")) }
            dayEvents.sort { ($0.cents < 0 ? 0 : 1) < ($1.cents < 0 ? 0 : 1) }
            for event in dayEvents {
                balance += event.cents
                if balance < minimum { minimum = balance; minimumDate = currentDate }
            }
        }
        let status = minimum < 0 ? "negative" : (minimum < reserveCents ? "below-reserve" : "within-reserve")
        let reason = minimum < 0
            ? "rent and utilities arrive before the scheduled income, so the purchase creates an overdraft risk."
            : "the forecast includes rent, utilities, and scheduled income in date order."
        return FlickyFinancialForecast(purchaseCents: purchaseCents, minimumCents: minimum, minimumDate: minimumDate,
                                       safeToSpendCents: max(0, startingBalanceCents - 60_000 - 8_000 + 100_000 - reserveCents),
                                       status: status, reason: reason)
    }

    private func parseCents(from text: String) -> Int? {
        let pattern = #"\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)|\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b"#
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = expression.firstMatch(in: text, range: range) else { return nil }
        let matchedRange = match.range(at: match.range(at: 1).location != NSNotFound ? 1 : 2)
        guard let amountRange = Range(matchedRange, in: text) else { return nil }
        let raw = String(text[amountRange]).replacingOccurrences(of: ",", with: "")
        guard let amount = Double(raw), amount >= 0, amount <= 9_000_000_000 else { return nil }
        return Int((amount * 100).rounded())
    }

    private func parseCheckoutCents(from text: String) -> Int? {
        let lines = text.components(separatedBy: .newlines)
        let preferred = lines.first { $0.range(of: #"\b(order\s+total|grand\s+total|total)\b"#, options: [.regularExpression, .caseInsensitive]) != nil }
        return parseCents(from: preferred ?? text)
    }

    private func resolveDate(_ text: String) -> String {
        if text.contains("next saturday") { return "2026-09-19" }
        if text.contains("then sunday") || text.contains("sunday") { return "2026-09-20" }
        if text.contains("september 19") { return "2026-09-19" }
        if text.contains("september 20") { return "2026-09-20" }
        return today
    }

    private func addDays(_ date: String, _ days: Int) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        guard let parsed = formatter.date(from: "\(date)T00:00:00Z") else { return date }
        return formatter.string(from: parsed.addingTimeInterval(Double(days) * 86_400))
    }

    private func formatUSD(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        return String(format: "%@$%.2f", sign, Double(abs(cents)) / 100.0)
    }

    private static func recognizeText(in imageData: Data?) async -> String {
        guard let imageData, let image = NSImage(data: imageData),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
        return await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, _ in
                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                continuation.resume(returning: text)
            }
            request.recognitionLevel = .fast
            request.usesLanguageCorrection = false
            do { try VNImageRequestHandler(cgImage: cgImage).perform([request]) }
            catch { continuation.resume(returning: "") }
        }
    }
}
