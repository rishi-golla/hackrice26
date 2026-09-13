import Foundation
import AppKit

private actor RequestCounter {
    var active = 0
    var peak = 0
    var requestsWithHistory = 0
    func receivedHistory(_ present: Bool) { if present { requestsWithHistory += 1 } }
    func begin() { active += 1; peak = max(peak, active) }
    func end() { active -= 1 }
}

private final class SpecialistAPI: ClaudeAPI {
    let counter = RequestCounter()
    override func analyzeImage(images: [(data: Data, label: String)], systemPrompt: String,
                               conversationHistory: [(userPlaceholder: String, assistantResponse: String)] = [],
                               userPrompt: String) async throws -> (text: String, duration: TimeInterval) {
        await counter.receivedHistory(!conversationHistory.isEmpty)
        if systemPrompt.contains("Route this Flicky request") {
            return (#"{"specialists":["Affordability","Tradeoffs","Affordability","invented role"],"metrics":[]}"#, 0)
        }
        await counter.begin()
        try? await Task.sleep(for: .milliseconds(80))
        await counter.end()
        if systemPrompt.contains("Tradeoffs specialist") {
            throw NSError(domain: "test", code: 503)
        }
        return ("Finding from supplied evidence", 0.08)
    }
}

@main
struct ResearchLifecycleCheck {
    @MainActor static func main() async {
        _ = NSApplication.shared
        precondition(FlickyResearch.fallbackPlan(for: "What is my balance?").specialists.isEmpty)
        for question in ["Can I afford this laptop?", "Compare these two options", "Use subagents to investigate", "Review my finances"] {
            precondition(FlickyResearch.fallbackPlan(for: question).specialists.count >= 2, "Explicit complex requests always have a fallback route")
        }
        let api = SpecialistAPI(proxyURL: "http://127.0.0.1:1/chat")
        let research = FlickyResearch()
        let findings = await research.investigate(question: "Compare options", images: [], context: "No data", snapshot: nil, api: api)
        precondition(research.specialists.count == 2, "Only unique allowed specialists launch")
        let peak = await api.counter.peak
        precondition(peak == 2, "Specialist requests run concurrently")
        precondition(findings.contains("Affordability") && findings.contains("unavailable"), "Partial failure reaches synthesis explicitly")
        precondition(research.specialists.allSatisfy { $0.returnedAt != nil }, "Real completion drives recall")
        research.reset()
        let request = Task { await research.investigate(question: "Compare again", images: [], context: "No data", snapshot: nil, api: api) }
        try? await Task.sleep(for: .milliseconds(20))
        request.cancel()
        research.reset()
        let cancelledFindings = await request.value
        precondition(cancelledFindings.isEmpty && research.specialists.isEmpty, "Cancellation cannot reintroduce late findings or circles")
        let investmentHistory = [(userPlaceholder: "What are the best stocks to invest in at the moment?", assistantResponse: "When do you need the money?")]
        let resolved = FlickyResearch.routingContext(question: "a year", history: investmentHistory)
        precondition(FlickyResearch.isInvestmentRequest(resolved), "Short horizon answer retains the investment topic")
        precondition(!FlickyResearch.isInvestmentRequest(FlickyResearch.routingContext(question: "What is my balance?", history: investmentHistory)), "A new balance question does not inherit the investment topic")
        _ = await research.investigate(question: "a year", images: [], context: "Nessie unavailable", snapshot: nil, api: api, history: investmentHistory)
        precondition(research.isInvestmentQuestion && research.investmentHorizon == "a year")
        precondition(research.metricKeys.contains("investing") && research.metricKeys.contains("bills"), "Investment follow-up automatically opens personal evidence")
        precondition(research.specialists.contains { $0.role == "Horizon & risk" })
        let requestsWithHistory = await api.counter.requestsWithHistory
        precondition(requestsWithHistory == 4, "Planner and every investment specialist receive the conversation")
        research.reset()
        print("PASS: Investment follow-up preserves history, horizon, specialist roles, and personal metrics")
        print("PASS: Specialist lifecycle checks (concurrency, role validation, failure, recall, cancellation)")
    }
}
