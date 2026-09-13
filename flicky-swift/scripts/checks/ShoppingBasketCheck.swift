import Foundation
import AppKit
import SwiftUI

@main
struct ShoppingBasketCheck {
    @MainActor static func main() throws {
        assert(BasketProduct.usdCents("$1,234.56") == 123456)
        assert(BasketProduct.usdCents("USD 9.99") == 999)
        for invalid in ["$9–$20", "$9.99/month", "from $9.99", "CA$9.99", "€9.99", "$1,23", "$0", "$99999999999999999999", "See site"] {
            assert(BasketProduct.usdCents(invalid) == nil, invalid)
        }
        let requests = ShoppingBasketRequest.parse("[SHOP: Halloween candy|2] [SHOP: Halloween candy|2] [SHOP: adult costume|1] [SHOP: bad|-1] [SHOP: too many|100]")
        assert(requests == [.init(query: "Halloween candy", quantity: 2), .init(query: "adult costume", quantity: 1)])
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("basket.json")
        let store = ShoppingBasketStore(storageURL: path)
        let decoration = ProductSearchResult(title: "Halloween hanging ghosts, pack of 3", price: "$9.99", url: "https://example.com/ghosts", source: "Example Decor", rating: nil, imageURL: nil, deliveryInfo: "Delivery confirmed at store")
        let candy = ProductSearchResult(title: "Halloween assorted candy, 60 pieces", price: "$12.49", url: "https://example.org/candy", source: "Example Candy", rating: nil, imageURL: nil, deliveryInfo: nil)
        store.add(decoration)
        store.add(candy)
        store.add(candy)
        assert(store.lines.count == 2 && store.itemCount == 3)
        assert(store.estimatedSubtotalCents == 3497 && store.merchants.count == 2)
        let restored = ShoppingBasketStore(storageURL: path)
        assert(restored.itemCount == 3 && restored.estimatedSubtotalCents == 3497)
        let permissions = try FileManager.default.attributesOfItem(atPath: path.path)[.posixPermissions] as? NSNumber
        assert(permissions?.intValue == 0o600)
        let unknown = BasketProduct(ProductSearchResult(title: "Costume with unconfirmed size", price: "See site", url: "https://example.net/costume", source: "Example Costumes", rating: nil, imageURL: nil, deliveryInfo: nil))
        let unknownID = store.addSearch(query: "adult Halloween costume", quantity: 1, products: [unknown], selectedURL: unknown.url)!
        assert(store.hasIncompletePrices && store.estimatedSubtotalCents == 3497)
        store.setQuantity(0, for: unknownID)
        assert(store.lines.last?.quantity == 1)
        store.select("https://untrusted.example/not-a-result", for: unknownID)
        assert(store.lines.last?.selectedURL == unknown.url)
        _ = store.addSearch(query: "adult Halloween costume", quantity: 9, products: [], selectedURL: nil)
        assert(store.lines.count == 3 && store.lines.last?.quantity == 1)
        store.remove(unknownID)
        assert(!store.hasIncompletePrices)
        let otherStore = ProductSearchResult(title: decoration.title, price: "$8.99", url: "https://example.org/ghosts", source: "Another store", rating: nil, imageURL: nil, deliveryInfo: nil)
        store.add(otherStore)
        assert(store.lines.count == 3 && store.lines.last?.selectedURL == otherStore.url)
        store.remove(store.lines.last!.id)
        let verified = VerifiedProductPage(productURL: decoration.url, title: decoration.title,
            imageURL: "https://example.com/product.jpg", unitPriceCents: 999, currency: "USD", availability: .inStock,
            observedAt: Date(), evidence: "Test fixture", limitations: [])
        store.applyVerifiedPage(verified, replacing: decoration.url)
        assert(store.lines.first?.product?.readyForDemoCheckout == true)
        store.recordVerificationFailure(for: decoration.url, reason: "Latest retailer check failed")
        assert(store.lines.first?.product?.readyForDemoCheckout == false)
        assert(ShoppingBasketStore(storageURL: path).lines.first?.product?.verifiedPage == nil)
        assert(BasketProduct(ProductSearchResult(title: "bad", price: "$1", url: "javascript:alert(1)", source: "bad", rating: nil, imageURL: nil, deliveryInfo: nil)).listingURL == nil)
        print("PASS: price parsing, marker validation, quantities, totals, persistence, duplicate protection, selection boundaries, secure links")
        if CommandLine.arguments.contains("--preview") {
            _ = store.addSearch(query: "adult Halloween costume", quantity: 1, products: [unknown], selectedURL: unknown.url)
            _ = store.addSearch(query: "pumpkin lights", quantity: 1, products: [], selectedURL: nil)
            let app = NSApplication.shared
            app.setActivationPolicy(.regular)
            let window = NSWindow(contentRect: NSRect(x: 100, y: 80, width: 720, height: 690), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "Flicky basket — UI test fixtures"
            let checkout = ShoppingCheckoutCoordinator(storageURL: directory.appendingPathComponent("checkout.json"))
            let hosting = NSHostingView(rootView: ShoppingBasketView(store: store, checkout: checkout, onVerify: {}, onAddURL: { _ in }, onClose: { app.terminate(nil) }))
            hosting.sizingOptions = []
            window.contentView = hosting
            window.makeKeyAndOrderFront(nil)
            app.activate(ignoringOtherApps: true)
            app.run()
        }
    }
}
