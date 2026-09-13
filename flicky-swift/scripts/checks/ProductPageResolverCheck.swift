import Foundation

@main
struct ProductPageResolverCheck {
    static func main() async throws {
        if CommandLine.arguments.count > 1 {
            let result = try await ProductPageResolver().resolve(url: CommandLine.arguments[1], merchantHint: CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil)
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            print(String(decoding: try encoder.encode(result), as: UTF8.self))
            return
        }
        let pageURL = URL(string: "https://merchant.example/products/candy")!
        func parse(_ json: String, extra: String = "") throws -> VerifiedProductPage {
            try ProductPageResolver.parse(html: "<script type='application/ld+json'>\(json)</script>\(extra)", pageURL: pageURL)
        }
        let exact = try parse(#"{"@type":"Product","name":"Candy &amp; treats","image":[{"url":"/candy.jpg"}],"offers":{"@type":"Offer","price":"14.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}"#)
        precondition(exact.title == "Candy & treats" && exact.unitPriceCents == 1499 && exact.availability == .inStock)
        precondition(exact.imageURL == "https://merchant.example/candy.jpg")
        let graph = try parse(#"{"@graph":[{"@type":"Product","name":"Candy","offers":{"price":12.5,"priceCurrency":"USD"}}]}"#)
        precondition(graph.unitPriceCents == 1250 && graph.availability == .unknown)
        for offer in [
            #"{"@type":"AggregateOffer","lowPrice":"9.99","highPrice":"19.99","priceCurrency":"USD"}"#,
            #"[{"price":"9.99","priceCurrency":"USD"},{"price":"10.99","priceCurrency":"USD"}]"#,
            #"{"price":"9.99","priceCurrency":"CAD"}"#,
            #"{"price":"9.999","priceCurrency":"USD"}"#,
            #"{"price":true,"priceCurrency":"USD"}"#,
            #"{"price":"9.99","priceCurrency":"USD","priceValidUntil":"2020-01-01"}"#
        ] {
            let result = try parse("{\"@type\":\"Product\",\"name\":\"Candy\",\"offers\":\(offer)}")
            precondition(result.unitPriceCents == nil)
        }
        for identity in [#""url":"/products/costume""#, #""@id":"https://other.example/products/candy""#] {
            do {
                _ = try parse("{\"@type\":\"Product\",\"name\":\"Unrelated product\",\(identity),\"offers\":{\"price\":\"9.99\",\"priceCurrency\":\"USD\"}}")
                fatalError("Sole Product with mismatched identity accepted")
            } catch ProductPageResolutionError.noProduct {}
        }
        let fragmentIdentity = try parse(##"{"@type":"Product","@id":"#product","url":"/products/candy","name":"Candy","offers":{"price":"9.99","priceCurrency":"USD"}}"##)
        precondition(fragmentIdentity.unitPriceCents == 999)
        let openGraph = try ProductPageResolver.parse(html: #"<meta property="og:type" content="product"><meta content="Real candy" property="og:title"><meta property="og:image" content="https://merchant.example/candy.jpg"><meta property="product:price:amount" content="99.99">"#, pageURL: pageURL)
        precondition(openGraph.unitPriceCents == nil && openGraph.imageURL != nil)
        let unavailable = try parse(#"{"@type":"Product","name":"Candy","offers":{"price":"2.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}}"#)
        precondition(unavailable.availability == .outOfStock)
        do {
            _ = try parse(#"[{"@type":"Product","name":"Candy"},{"@type":"Product","name":"Costume"}]"#)
            fatalError("Ambiguous product list accepted")
        } catch ProductPageResolutionError.noProduct {}
        let match = try parse(#"[{"@type":"Product","name":"Candy","url":"/products/candy"},{"@type":"Product","name":"Costume","url":"/products/costume"}]"#)
        precondition(match.title == "Candy")
        for url in ["https://www.google.com/search?udm=28", "https://www.google.com/shopping/product/123", "https://merchant.example/search?q=candy", "http://merchant.example/p/1", "https://localhost/p/1", "https://127.0.0.1/p/1"] {
            do { _ = try ProductPageResolver.merchantURL(from: url); fatalError("Bad URL accepted") } catch {}
        }
        let wrapped = try ProductPageResolver.merchantURL(from: "https://www.google.com/url?url=https%3A%2F%2Fmerchant.example%2Fproducts%2Fcandy")
        precondition(wrapped == pageURL)
        let linked = try ProductPageResolver.merchantLink(in: #"<a href="https://walmart.com/ip/candy/123?utm_source=google">Buy</a><a href="https://example.com/unrelated">Other</a>"#, merchantHint: "Walmart")
        precondition(linked.host == "walmart.com" && linked.path == "/ip/candy/123")
        do {
            _ = try ProductPageResolver.merchantLink(in: #"<a href="https://walmart.com/ip/1">One</a><a href="https://walmart.com/ip/2">Two</a>"#, merchantHint: "Walmart")
            fatalError("Ambiguous merchant choices accepted")
        } catch ProductPageResolutionError.searchIntermediary {}
        let retailerHTML = #"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{"product":{"usItemId":"123","name":"Exact candy","imageInfo":{"thumbnailUrl":"https://i5.walmartimages.com/candy.jpg"},"availabilityStatus":"IN_STOCK","priceInfo":{"currentPrice":{"price":29.97,"currencyUnit":"USD"},"wasPrice":{"price":39.99}},"recommendations":[{"priceInfo":{"currentPrice":{"price":1.00}}}]}}}}}}</script>"#
        let retailerPage = try ProductPageResolver.parse(html: retailerHTML, pageURL: URL(string: "https://www.walmart.com/ip/candy/123")!)
        precondition(retailerPage.unitPriceCents == 2997 && retailerPage.availability == .inStock)
        precondition(retailerPage.evidence.contains("item ID matched"))
        do {
            _ = try ProductPageResolver.parse(html: retailerHTML, pageURL: URL(string: "https://www.walmart.com/ip/candy/456")!)
            fatalError("Unmatched retailer item ID accepted")
        } catch ProductPageResolutionError.noProduct {}
        do {
            _ = try ProductPageResolver.parse(html: retailerHTML, pageURL: URL(string: "https://other.example/ip/candy/123")!)
            fatalError("Retailer-specific schema applied to unrelated host")
        } catch ProductPageResolutionError.noProduct {}
        print("Product resolver checks passed: exact/ambiguous/expired prices, images, graph matching, stock evidence, links and intermediaries.")
    }
}
