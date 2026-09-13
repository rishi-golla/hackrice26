# Research turn reliability

The previous client threw the same terminal error for a third research call, an overlapping call, or an uncleared cancelled task. It also requested a new response immediately after each tool result, potentially before the original response finished.

RealtimeResearchQueue now deduplicates call IDs, waits for response.done, runs each batch serially, and sends all outputs before one response.create. Cancellation clears the queue and task reference; existing generation checks reject late work. Completed prior turns remain the only conversation history.

Eight calls may start within 90 seconds of the first dispatch. The budget is checked at dispatch, including queued calls. At the budget, explicit tool outputs identify work that was not performed, and the final response disables tools. Malformed requests with a call ID also receive an honest tool output. No automatic replay of potentially consequential research actions. The whole-turn watchdog is five minutes; network, quota, protocol and stalled upstream errors remain possible.

Ordering follows the [official OpenAI Realtime function-calling guide](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling).

Validation on September 13, 2026:
- RealtimeResearchQueueCheck passed: ordering, overlapping calls, ID deduplication, third through eighth calls, budget fallback, fresh-turn reset, invalid arguments.
- RealtimeVoiceCheck --multi passed against gpt-realtime / marin with synthetic results: three sequential calls, spoken result, playback completion, cancellation during connection. No microphone or real financial action.
- Full Xcode build/run succeeded at 4:35 AM, with 14 existing warnings.

Compile queue checks with swiftc using leanring-buddy/RealtimeResearchQueue.swift and scripts/checks/RealtimeResearchQueueCheck.swift. The live test compilation command is at the top of RealtimeVoiceCheck.swift.
