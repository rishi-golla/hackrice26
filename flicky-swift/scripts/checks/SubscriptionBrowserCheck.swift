import AppKit
import WebKit

@main struct SubscriptionBrowserCheck {
    @MainActor static func main() async throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SubscriptionStore(directory: directory)
        store.update(account: "fixture", snapshot: nil)
        precondition(store.add(name: "Fixture Video", amount: "12", date: "2026-10-01", website: "https://fixture.example/account"))
        let html = """
        <html><body><h1>Fixture Video subscription</h1><p>Your subscription is active.</p>
        <input type="text" value="private-form-value">
        <a href="https://fixture.example/secret-token-abcdefghijklmnopqrstuvwxyz">account@example.com</a>
        <button onclick="document.body.innerHTML='<h1>Fixture Video</h1><p>Your subscription has been canceled.</p>'">Confirm cancellation</button>
        </body></html>
        """
        var calls = 0
        let runner = SubscriptionCancellation(store: store, loadProvider: { web, url in web.loadHTMLString(html, baseURL: url) }) { _, prompt in
            precondition(!prompt.contains("private-form-value") && !prompt.contains("account@example.com") && !prompt.contains("secret-token-abcdefghijklmnopqrstuvwxyz"), "Do not send form values to the planner")
            calls += 1
            if calls == 1 { return #"{"action":"click","id":1,"reason":"Confirm cancellation","evidence":null}"# }
            return #"{"action":"done","id":null,"reason":"Cancelled","evidence":"Your subscription has been canceled."}"#
        }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = runner.webView
        runner.open(store.active[0])
        for _ in 0..<50 {
            if runner.webView.url != nil && !runner.webView.isLoading { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        precondition(runner.webView.url?.host == "fixture.example")
        runner.confirm(); runner.confirm() // Duplicate click cannot spawn another job.
        for _ in 0..<100 {
            if !runner.running { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        precondition(!runner.running && store.items[0].decision == .cancelled, runner.status)
        precondition(calls == 2 && !store.items[0].receipt.isEmpty)
        runner.confirm()
        precondition(!runner.running && calls == 2, "Completed jobs cannot replay")
        let guideHTML = """
        <html><body><h1>Fixture Video</h1>
        <button onclick="document.body.innerHTML='<h1>Subscription settings</h1><button onclick=&quot;window.cancelled=true&quot;>Cancel subscription</button>'">Manage subscription</button>
        </body></html>
        """
        var guideCalls = 0
        var controlActivity: [Bool] = []
        let guide = SubscriptionCancellation(store: store, onControlActivityChanged: { controlActivity.append($0) }, loadProvider: { web, url in web.loadHTMLString(guideHTML, baseURL: url) }) { _, _ in
            guideCalls += 1
            // Even an erroneous planner click on cancellation must only highlight it.
            return #"{"action":"click","id":0,"reason":"Next control","evidence":null}"#
        }
        window.contentView = guide.webView
        var guideItem = store.items[0]
        guideItem.decision = .review
        guide.openGuidance(guideItem)
        for _ in 0..<120 {
            if !guide.running { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        precondition(guideCalls == 2 && guide.status.contains("highlighted"), guide.status)
        precondition(controlActivity == [true, false], "Control indicator stops when highlighting hands back to the user")
        let highlighted = try await guide.webView.evaluateJavaScript("document.querySelector('[data-peppa-highlight]')?.textContent") as? String
        precondition(highlighted == "Cancel subscription")
        let cancelled = try await guide.webView.evaluateJavaScript("window.cancelled === true") as? Bool
        precondition(cancelled == false, "Guidance never submits cancellation")
        let receiptBefore = store.items[0].receipt
        guide.confirm()
        precondition(!guide.running && store.items[0].receipt == receiptBefore, "Guidance cannot enter automatic cancellation")
        precondition(!SubscriptionCancellation.safeGuidanceNavigation("Confirm cancellation"))
        precondition(!SubscriptionCancellation.safeGuidanceNavigation("Continue"))
        precondition(SubscriptionRules.matchesService(guideItem, query: "Fixture"))
        precondition(!SubscriptionRules.matchesService(guideItem, query: ""))
        guide.reset()
        print("PASS: guided navigation opens provider, navigates settings, highlights cancellation without clicking or changing receipts, and rejects unsafe automatic steps")
        print("PASS: browser fixture — observes DOM, clicks cancellation, verifies receipt, redacts form values, prevents duplicate jobs. No network or real subscription changes.")
    }
}
