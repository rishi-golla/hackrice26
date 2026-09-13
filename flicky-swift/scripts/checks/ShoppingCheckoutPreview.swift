import AppKit
import SwiftUI

/// UI-only test executable. Its injected bank session never leaves this process.
private final class PreviewBankProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var balanceCents = 100_000
    private static var withdrawals: [[String: Any]] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        do {
            var status = 200
            let object: Any
            if request.httpMethod == "POST" {
                var data = request.httpBody ?? Data()
                if data.isEmpty, let stream = request.httpBodyStream {
                    stream.open()
                    defer { stream.close() }
                    var buffer = [UInt8](repeating: 0, count: 4096)
                    while stream.hasBytesAvailable {
                        let count = stream.read(&buffer, maxLength: buffer.count)
                        if count <= 0 { break }
                        data.append(buffer, count: count)
                    }
                }
                let payload = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                let amount = payload["amount"] as! Double
                Self.balanceCents -= Int((amount * 100).rounded())
                let withdrawal: [String: Any] = ["_id": "fixture-\(UUID())", "status": "completed", "amount": amount,
                    "description": payload["description"]!]
                Self.withdrawals.append(withdrawal)
                object = ["objectCreated": withdrawal]
                status = 201
            } else if request.url!.path.hasSuffix("/withdrawals") {
                object = Self.withdrawals
            } else {
                object = ["_id": "fixture-account", "customer_id": "fixture-customer", "nickname": "Fixture checking",
                          "balance": Double(Self.balanceCents) / 100]
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: object))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main private struct ShoppingCheckoutPreview {
    @MainActor static func main() throws {
        guard CommandLine.arguments.contains("--preview") else {
            print("Run with --preview for the fixture UI. No live banking or retailer order requests.")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("FlickyCheckoutPreview-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PreviewBankProtocol.self]
        let bankSession = URLSession(configuration: configuration)
        defer { bankSession.invalidateAndCancel() }
        let ledger = try DemoCheckoutLedger(apiKey: "fixture-only-not-a-key", storageURL: directory.appendingPathComponent("ledger.json"), session: bankSession)
        let store = ShoppingBasketStore(storageURL: directory.appendingPathComponent("basket.json"))
        let checkout = ShoppingCheckoutCoordinator(storageURL: directory.appendingPathComponent("draft.json"), ledger: ledger,
            animateTasks: true, openProductLink: { _ in true })
        checkout.currentIdentity = { ("fixture-customer", "fixture-account") }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 690), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Checkout UI fixture — no account changes"
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black
        func addProduct(_ url: String) {
            guard !store.isLocked else { return }
            store.progress = "Reading the live retailer photo and price…"
            Task { @MainActor in
                defer { store.progress = nil }
                do { store.addVerifiedPage(try await ProductPageResolver().resolve(url: url)) }
                catch { store.message = "Live retailer preview: \(error.localizedDescription)" }
            }
        }
        let hosting = NSHostingView(rootView: ShoppingBasketView(store: store, checkout: checkout, onVerify: {
            Task { @MainActor in
                guard !store.isLocked else { return }
                store.progress = "Rechecking live retailer metadata…"
                defer { store.progress = nil }
                for product in store.lines.compactMap(\.product) {
                    do { store.applyVerifiedPage(try await ProductPageResolver().resolve(url: product.url), replacing: product.url) }
                    catch { store.recordVerificationFailure(for: product.url, reason: error.localizedDescription) }
                }
            }
        }, onAddURL: addProduct, onClose: { app.terminate(nil) }))
        hosting.sizingOptions = []
        window.contentView = hosting
        window.center()
        window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            addProduct("https://www.walmart.com/ip/Frankford-Mega-Mix-XXL-Bag/19425265570?selectedSellerId=0")
        }
        app.run()
    }
}
