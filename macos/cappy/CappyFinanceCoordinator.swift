import Foundation

struct CappyForecast: Sendable, Equatable {
    enum Disposition: String, Sendable, Equatable { case approved, caution, declined }

    let accountID: String
    let disposition: Disposition
    let summary: String

    static func approved(accountID: String, summary: String) -> Self { .init(accountID: accountID, disposition: .approved, summary: summary) }
    static func caution(accountID: String, summary: String) -> Self { .init(accountID: accountID, disposition: .caution, summary: summary) }
}

struct CappyForecastCard: Sendable, Equatable {
    let title: String
    let detail: String
}

struct CappyFinanceAnswer: Sendable, Equatable {
    let forecast: CappyForecast
    let card: CappyForecastCard
}

protocol CappyFinanceServicing: AnyObject {
    func forecast(accountID: String, question: String, ocrText: String) async -> CappyForecast?
}

/// Keeps finance results scoped to the account that initiated them. Any logout,
/// account switch, or newer question invalidates an in-flight result.
@MainActor
final class CappyFinanceCoordinator {
    private let service: CappyFinanceServicing
    private var generation = 0
    private(set) var activeAccountID: String?

    init(service: CappyFinanceServicing) {
        self.service = service
    }

    func beginSession(accountID: String) {
        guard activeAccountID != accountID else { return }
        generation += 1
        activeAccountID = accountID
    }

    func endSession() {
        generation += 1
        activeAccountID = nil
    }

    func answer(for question: String, ocrText: String) async -> CappyFinanceAnswer? {
        guard let accountID = activeAccountID else { return nil }
        let requestGeneration = generation
        guard let forecast = await service.forecast(accountID: accountID, question: question, ocrText: ocrText) else {
            return nil
        }

        guard !Task.isCancelled,
              requestGeneration == generation,
              activeAccountID == accountID,
              forecast.accountID == accountID else {
            return nil
        }

        return CappyFinanceAnswer(forecast: forecast, card: card(for: forecast))
    }

    private func card(for forecast: CappyForecast) -> CappyForecastCard {
        let title: String
        switch forecast.disposition {
        case .approved: title = "Safe to spend"
        case .caution: title = "Review this purchase"
        case .declined: title = "Hold this purchase"
        }
        return CappyForecastCard(title: title, detail: forecast.summary)
    }
}

/// The app supplies an approved finance tool at composition time. The default
/// client deliberately produces no answer, so OCR cannot leave the device or
/// become a financial claim without an authenticated tool result.
@MainActor
final class CappyFinanceAgentClient: CappyFinanceServicing {
    typealias Tool = (String, String, String) async -> CappyForecast?
    private let tool: Tool?

    init(tool: Tool? = nil) { self.tool = tool }

    func forecast(accountID: String, question: String, ocrText: String) async -> CappyForecast? {
        await tool?(accountID, question, ocrText)
    }
}
