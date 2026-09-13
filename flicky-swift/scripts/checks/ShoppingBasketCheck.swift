import Foundation

@main struct ShoppingBasketCheck {
    @MainActor static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("basket.json")
        let store = ShoppingBasketStore(storageURL: path)
        func page(_ url: String = "https://example.com/ghosts", price: Int? = 999,
                  image: String? = "https://example.com/photo.jpg", availability: VerifiedProductPage.Availability = .inStock,
                  observedAt: Date = Date()) -> VerifiedProductPage {
            VerifiedProductPage(productURL: url, title: "Hanging ghost decoration", imageURL: image,
                unitPriceCents: price, currency: "USD", availability: availability, observedAt: observedAt,
                evidence: "Test fixture", limitations: [])
        }
        let verified = BasketProduct(page: page())
        let raw = BasketProduct(ProductSearchResult(title: "Halloween costumes", price: "$9.99", url: "https://www.google.com/search?q=costumes", source: "Search", rating: nil, imageURL: nil, deliveryInfo: nil))
        assert(store.addSearch(query: "Halloween costumes", quantity: 1, products: [], selectedURL: nil) == nil)
        assert(store.addSearch(query: "Halloween costumes", quantity: 1, products: [raw], selectedURL: raw.url) == nil)
        assert(store.lines.isEmpty)
        for invalid in [page(price: nil), page(price: 0), page(image: nil), page(image: "not-a-url"), page(availability: .outOfStock), page(availability: .unknown), page(availability: .preorder), page("https://www.google.com/search?q=product"), page(observedAt: Date().addingTimeInterval(-901))] {
            store.addVerifiedPage(invalid)
            assert(store.lines.isEmpty, "Invalid listing entered basket")
        }
        let id = store.addSearch(query: "Halloween decorations", quantity: 2, products: [raw, verified], selectedURL: verified.url)!
        assert(store.lines.count == 1 && store.lines[0].options.count == 1)
        assert(store.readyForDemoCheckout && store.estimatedSubtotalCents == 1998)
        store.setQuantity(3, for: id)
        assert(store.estimatedSubtotalCents == 2997)
        store.select(raw.url, for: id)
        assert(store.lines[0].selectedURL == verified.url)
        store.addVerifiedPage(page("https://another.example/ghosts"))
        assert(store.lines.count == 2, "Same title at a different retailer must not be discarded")
        store.addVerifiedPage(page())
        assert(store.lines[0].quantity == 4)
        let restored = ShoppingBasketStore(storageURL: path)
        assert(restored.lines.count == 2 && restored.estimatedSubtotalCents == 4995)
        store.recordVerificationFailure(for: verified.url, reason: "Unavailable")
        assert(store.lines.count == 1 && store.lines.allSatisfy { $0.product != nil })
        store.applyVerifiedPage(page("https://another.example/ghosts", availability: .outOfStock), replacing: "https://another.example/ghosts")
        assert(store.lines.isEmpty)
        let legacy = ShoppingBasketLine(id: UUID(), query: "Halloween candy", quantity: 1, options: [raw], selectedURL: nil, foundAt: Date())
        try JSONEncoder().encode([legacy]).write(to: path)
        assert(ShoppingBasketStore(storageURL: path).lines.isEmpty, "Old placeholder rows survived migration")
        let cleaned = try JSONDecoder().decode([ShoppingBasketLine].self, from: Data(contentsOf: path))
        assert(cleaned.isEmpty)
        assert(BasketProduct.usdCents("$1,234.56") == 123456)
        for price in ["$9–$20", "from $9.99", "CA$9.99", "$9.99/month", "$0", "See site"] { assert(BasketProduct.usdCents(price) == nil) }
        let requests = ShoppingBasketRequest.parse("[SHOP: candy|2] [SHOP: candy|2] [SHOP: costume|1] [SHOP: bad|100]")
        assert(requests.count == 2 && requests[0].quantity == 2)
        print("PASS: verified-only insertion/options, missing metadata and non-stock rejection, no placeholders, quantities/totals, persistence migration, failed refresh removal, direct links, marker parsing.")
    }
}
