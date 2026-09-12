import Testing
@testable import cappy

@MainActor
struct CappyFinanceCoordinatorTests {
    @Test func logoutCancelsTheActiveForecast() async {
        let service = CappyFinanceServiceStub()
        let coordinator = CappyFinanceCoordinator(service: service)
        coordinator.beginSession(accountID: "account-a")

        let answerTask = Task { await coordinator.answer(for: "Can I afford $20?", ocrText: "Total $20.00") }
        await service.waitForRequest()
        coordinator.endSession()
        await service.resolveNext(with: .approved(accountID: "account-a", summary: "approved"))

        let answer = await answerTask.value
        #expect(answer == nil)
    }

    @Test func accountSwitchSuppressesThePreviousAccountResult() async {
        let service = CappyFinanceServiceStub()
        let coordinator = CappyFinanceCoordinator(service: service)
        coordinator.beginSession(accountID: "account-a")

        let oldTask = Task { await coordinator.answer(for: "Can I afford $20?", ocrText: "Total $20.00") }
        await service.waitForRequest()
        coordinator.beginSession(accountID: "account-b")
        await service.resolveNext(with: .approved(accountID: "account-a", summary: "old answer"))

        let oldAnswer = await oldTask.value
        #expect(oldAnswer == nil)
        #expect(coordinator.activeAccountID == "account-b")
    }

    @Test func staleForecastDoesNotReplaceANewerRequest() async {
        let service = CappyFinanceServiceStub()
        let coordinator = CappyFinanceCoordinator(service: service)
        coordinator.beginSession(accountID: "account-a")

        let firstTask = Task { await coordinator.answer(for: "Can I afford $20?", ocrText: "Total $20.00") }
        await service.waitForRequest()
        let secondTask = Task { await coordinator.answer(for: "Can I afford $30?", ocrText: "Total $30.00") }
        await service.waitForRequest()
        await service.resolveNext(with: .approved(accountID: "account-a", summary: "first"))
        await service.resolveNext(with: .approved(accountID: "account-a", summary: "second"))

        let firstAnswer = await firstTask.value
        let secondAnswer = await secondTask.value
        #expect(firstAnswer == nil)
        #expect(secondAnswer?.forecast.summary == "second")
    }

    @Test func forecastResponseRendersAsACappyCard() async {
        let service = CappyFinanceServiceStub()
        let coordinator = CappyFinanceCoordinator(service: service)
        coordinator.beginSession(accountID: "account-a")

        let answerTask = Task { await coordinator.answer(for: "Can I afford $20?", ocrText: "Total $20.00") }
        await service.waitForRequest()
        await service.resolveNext(with: .caution(accountID: "account-a", summary: "Cash falls below your reserve."))

        let answer = await answerTask.value
        #expect(answer?.card.title == "Review this purchase")
        #expect(answer?.card.detail == "Cash falls below your reserve.")
    }
}

@MainActor
private final class CappyFinanceServiceStub: CappyFinanceServicing {
    private var continuations: [CheckedContinuation<CappyForecast, Never>] = []
    private var requestWaiters: [CheckedContinuation<Void, Never>] = []

    func forecast(accountID: String, question: String, ocrText: String) async -> CappyForecast? {
        for waiter in requestWaiters { waiter.resume() }
        requestWaiters.removeAll()
        return await withCheckedContinuation { continuations.append($0) }
    }

    func waitForRequest() async {
        guard continuations.isEmpty else { return }
        await withCheckedContinuation { requestWaiters.append($0) }
    }

    func resolveNext(with forecast: CappyForecast) {
        continuations.removeFirst().resume(returning: forecast)
    }
}
