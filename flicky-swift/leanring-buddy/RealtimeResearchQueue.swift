import Foundation

/// Per-turn scheduling, separate from socket/audio state for deterministic checks.
struct RealtimeResearchQueue {
    struct Call {
        let id: String
        let question: String?
        var immediateOutput: String?
    }
    private var pending: [Call] = []
    private var seen: Set<String> = []
    private var inFlight: String?
    private var responseFinished = false
    private var startedAt: TimeInterval?
    private(set) var count = 0
    private var forceFinal = false
    var hasWork: Bool { !pending.isEmpty || inFlight != nil }

    mutating func append(id: String, name: String?, arguments: String?) {
        guard seen.insert(id).inserted else { return }
        let body = arguments.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
        let question = (body?["question"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let valid = name == "research_financial_question" && question?.isEmpty == false
        pending.append(Call(id: id, question: valid ? question : nil, immediateOutput: valid ? nil :
            "This tool request could not be executed because its name or question was invalid. Answer from existing evidence and state what is unverified."))
        if !valid { forceFinal = true }
    }

    mutating func responseEnded() { responseFinished = true }

    mutating func next(now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Call? {
        guard responseFinished, inFlight == nil, !pending.isEmpty else { return nil }
        var call = pending.removeFirst()
        if call.immediateOutput == nil {
            if startedAt == nil { startedAt = now }
            if count >= 8 || now - (startedAt ?? now) >= 90 {
                call.immediateOutput = "No additional research was run within this turn's research budget. Use the results already collected to answer now, explicitly identify unverified details, and do not ask the user to repeat the question. Do not claim this requested action succeeded."
                forceFinal = true
            } else {
                count += 1
                if count == 8 { forceFinal = true }
            }
        }
        inFlight = call.id
        return call
    }

    mutating func complete(id: String) {
        guard inFlight == id else { return }
        inFlight = nil
    }

    /// nil means more work remains; true asks the model to answer without tools.
    mutating func takeContinuation() -> Bool? {
        guard responseFinished, !hasWork else { return nil }
        responseFinished = false
        return forceFinal
    }
}
