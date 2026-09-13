import Foundation

@main struct RealtimeResearchQueueCheck {
    static func main() {
        var queue = RealtimeResearchQueue()
        func add(_ id: String) { queue.append(id: id, name: "research_financial_question", arguments: #"{"question":"Check evidence"}"#) }
        add("a"); add("b"); add("a")
        precondition(queue.next(now: 0) == nil, "Cannot dispatch before response.done")
        queue.responseEnded()
        precondition(queue.next(now: 0)?.id == "a")
        precondition(queue.next(now: 0) == nil, "Overlapping calls must wait")
        precondition(queue.takeContinuation() == nil)
        queue.complete(id: "wrong")
        precondition(queue.next(now: 0) == nil)
        queue.complete(id: "a")
        precondition(queue.next(now: 1)?.id == "b")
        queue.complete(id: "b")
        precondition(queue.takeContinuation() == false)
        precondition(queue.takeContinuation() == nil, "Only one continuation")
        for i in 3...8 {
            add("\(i)"); queue.responseEnded()
            precondition(queue.next(now: 2)?.immediateOutput == nil, "Third and subsequent research must work")
            queue.complete(id: "\(i)")
            precondition(queue.takeContinuation() == (i == 8))
        }
        add("9"); queue.responseEnded()
        precondition(queue.next(now: 3)?.immediateOutput?.contains("Do not claim") == true)
        queue.complete(id: "9")
        precondition(queue.count == 8 && queue.takeContinuation() == true)
        queue = RealtimeResearchQueue() // Stop/new question discards queued/in-flight state.
        add("a"); queue.responseEnded()
        precondition(queue.next(now: 100)?.question != nil)
        queue.complete(id: "a")
        _ = queue.takeContinuation()
        add("slow"); queue.responseEnded()
        precondition(queue.next(now: 190)?.immediateOutput != nil)
        queue.complete(id: "slow")
        precondition(queue.takeContinuation() == true && queue.count == 1)
        queue = RealtimeResearchQueue()
        queue.append(id: "bad", name: "unknown", arguments: "{")
        queue.responseEnded()
        precondition(queue.next()?.immediateOutput != nil)
        queue.complete(id: "bad")
        precondition(queue.takeContinuation() == true && queue.count == 0)
        print("PASS: response ordering, overlap, deduplication, eight calls, budget fallback, reset, invalid arguments")
    }
}
