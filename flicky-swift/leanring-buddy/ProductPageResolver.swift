import Foundation
import CoreFoundation

struct VerifiedProductPage: Codable, Equatable, Sendable {
    enum Availability: String, Codable, Sendable { case inStock, outOfStock, preorder, unknown }
    let productURL: String
    let title: String
    let imageURL: String?
    let unitPriceCents: Int?
    let currency: String?
    let availability: Availability
    let observedAt: Date
    let evidence: String
    let limitations: [String]

    var hasVerifiedPrice: Bool { unitPriceCents != nil && currency == "USD" }
}

enum ProductPageResolutionError: LocalizedError {
    case invalidURL, searchIntermediary, unavailable(Int), tooLarge, notHTML, noProduct
    var errorDescription: String? {
        switch self {
        case .invalidURL: return "A direct HTTPS retailer product link is needed."
        case .searchIntermediary: return "This is a shopping search link. Choose a direct retailer product page."
        case .unavailable(let status): return "The retailer did not allow the product check (HTTP \(status))."
        case .tooLarge: return "The retailer page exceeded the product-check size limit."
        case .notHTML: return "The retailer did not return a readable product page."
        case .noProduct: return "The page did not identify a single product. Open the retailer to select an exact item."
        }
    }
}

/// Reads published retailer metadata, never search snippets or model-generated prices.
struct ProductPageResolver {
    private static let maximumPageBytes = 3_000_000
    private let session: URLSession

    init(session: URLSession = .shared) { self.session = session }

    func resolve(url: String, merchantHint: String? = nil) async throws -> VerifiedProductPage {
        let merchantURL: URL
        do { merchantURL = try Self.merchantURL(from: url) }
        catch ProductPageResolutionError.searchIntermediary {
            guard let intermediary = URL(string: url), intermediary.scheme == "https",
                  intermediary.user == nil, intermediary.password == nil,
                  let host = intermediary.host, Self.isSearchHost(host), let merchantHint else {
                throw ProductPageResolutionError.searchIntermediary
            }
            let (html, _) = try await fetchHTML(intermediary)
            merchantURL = try Self.merchantLink(in: html, merchantHint: merchantHint)
        }
        let (html, finalURL) = try await fetchHTML(merchantURL)
        _ = try Self.merchantURL(from: finalURL.absoluteString)
        return try Self.parse(html: html, pageURL: finalURL)
    }

    private func fetchHTML(_ url: URL) async throws -> (String, URL) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 14
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        request.setValue("FlickyProductPreview/1.0", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse else { throw ProductPageResolutionError.notHTML }
        guard (200...299).contains(response.statusCode) else { throw ProductPageResolutionError.unavailable(response.statusCode) }
        guard response.expectedContentLength <= Int64(Self.maximumPageBytes) else { throw ProductPageResolutionError.tooLarge }
        let mime = response.mimeType?.lowercased() ?? ""
        guard mime == "text/html" || mime == "application/xhtml+xml" else { throw ProductPageResolutionError.notHTML }
        var data = Data()
        for try await byte in bytes {
            if data.count >= Self.maximumPageBytes { throw ProductPageResolutionError.tooLarge }
            data.append(byte)
        }
        try Task.checkCancellation()
        guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            throw ProductPageResolutionError.notHTML
        }
        return (html, response.url ?? url)
    }

    /// Resolve only an explicit outbound link to the named store, never invent a
    /// retailer URL from a title or assume a search page itself is a product.
    static func merchantLink(in html: String, merchantHint: String) throws -> URL {
        let normalizedHint = merchantHint.lowercased().filter { $0.isLetter || $0.isNumber }
        guard normalizedHint.count >= 3 else { throw ProductPageResolutionError.searchIntermediary }
        var destinations: [String: URL] = [:]
        for match in matches(#"(?is)<a\b([^>]+)>(.*?)</a\s*>"#, in: html) {
            guard var href = attributes(in: match[1])["href"] else { continue }
            if href.hasPrefix("/url?") { href = "https://www.google.com" + href }
            guard let destination = try? merchantURL(from: href), let host = destination.host?.lowercased() else { continue }
            let labels: [String] = host.components(separatedBy: ".").filter { !["www", "com", "co"].contains($0) }
            let anchorText = decodeEntities(match[2].replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression))
            let normalizedAnchor = anchorText.lowercased().filter { $0.isLetter || $0.isNumber }
            let hostMatches = labels.contains(where: { $0.filter { $0.isLetter || $0.isNumber } == normalizedHint })
            guard hostMatches || normalizedAnchor == normalizedHint,
                  destination.path != "/", !destination.path.isEmpty else { continue }
            var identity = URLComponents(url: destination, resolvingAgainstBaseURL: false)
            identity?.fragment = nil
            let queryItems = identity?.queryItems?.filter { !$0.name.hasPrefix("utm_") && !["gclid", "msclkid", "ved", "sa", "wmlspartner", "veh", "cn", "wl13"].contains($0.name) }
            identity?.queryItems = queryItems?.isEmpty == true ? nil : queryItems
            let cleaned = identity?.url ?? destination
            destinations[cleaned.absoluteString] = cleaned
        }
        guard destinations.count == 1, let result = destinations.values.first else {
            throw ProductPageResolutionError.searchIntermediary
        }
        return result
    }

    static func merchantURL(from raw: String) throws -> URL {
        guard let url = URL(string: raw), url.scheme == "https", let host = url.host?.lowercased(),
              url.user == nil, url.password == nil, !host.isEmpty,
              host != "localhost", !host.hasSuffix(".local"), !host.contains(":"),
              !host.split(separator: ".").allSatisfy({ Int($0) != nil }) else {
            throw ProductPageResolutionError.invalidURL
        }
        if isSearchHost(host) {
            // Search redirect wrappers may include the actual retailer destination.
            let fields = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            for key in ["url", "q", "adurl", "u"] {
                if let target = fields.first(where: { $0.name == key })?.value,
                   let destination = URL(string: target), let targetHost = destination.host,
                   !isSearchHost(targetHost), let validated = try? merchantURL(from: target) { return validated }
            }
            throw ProductPageResolutionError.searchIntermediary
        }
        let path = url.path.lowercased()
        if path == "/search" || path.hasPrefix("/search/") || path == "/s" {
            throw ProductPageResolutionError.searchIntermediary
        }
        return url
    }

    private static func isSearchHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        return lower == "google.com" || lower.hasSuffix(".google.com") || lower.hasPrefix("www.google.") || lower.hasPrefix("shopping.google.") || lower == "googleadservices.com" || lower.hasSuffix(".googleadservices.com") || lower == "bing.com" || lower.hasSuffix(".bing.com") || lower == "duckduckgo.com" || lower.hasSuffix(".duckduckgo.com")
    }

    static func parse(html: String, pageURL: URL, observedAt: Date = Date()) throws -> VerifiedProductPage {
        _ = try merchantURL(from: pageURL.absoluteString)
        let scriptPattern = #"(?is)<script\b([^>]*)>(.*?)</script\s*>"#
        var products: [[String: Any]] = []
        var retailerProduct: [String: Any]?
        for match in matches(scriptPattern, in: html) {
            let attributes = attributes(in: match[1])
            guard let data = match[2].data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) else { continue }
            if attributes["type"]?.lowercased() == "application/ld+json" { collectProducts(json, into: &products) }
            if attributes["id"] == "__NEXT_DATA__" { retailerProduct = walmartPrimaryProduct(json, pageURL: pageURL) }
        }
        let meta = metadata(in: html)
        // Pages often include recommended products. Match the page URL when possible;
        // otherwise refuse to silently select the cheapest unrelated recommendation.
        let matching = products.filter { productPageIdentity($0, pageURL: pageURL) == true }
        let product: [String: Any]?
        if matching.count == 1 {
            product = matching.first
        } else if products.count == 1, let soleProduct = products.first {
            guard productPageIdentity(soleProduct, pageURL: pageURL) != false else {
                throw ProductPageResolutionError.noProduct
            }
            product = soleProduct
        } else {
            product = retailerProduct
        }
        if products.count > 1 && product == nil { throw ProductPageResolutionError.noProduct }
        guard let title = clean(product?["name"] as? String ?? meta["og:title"]),
              product != nil || meta["og:type"]?.lowercased().contains("product") == true else {
            throw ProductPageResolutionError.noProduct
        }
        let image = imageValue(product?["image"]) ?? meta["og:image"]
        let resolvedImage: URL? = image.flatMap { URL(string: decodeEntities($0), relativeTo: pageURL)?.absoluteURL }
        let imageURL: String?
        if let resolvedImage, resolvedImage.scheme == "https", resolvedImage.user == nil, resolvedImage.password == nil {
            imageURL = resolvedImage.absoluteString
        } else { imageURL = nil }
        var limitations = ["Shipping, tax, variants and the final checkout price require retailer confirmation."]
        let offers: [[String: Any]]
        if let offer = product?["offers"] as? [String: Any] { offers = [offer] }
        else { offers = product?["offers"] as? [[String: Any]] ?? [] }
        var cents: Int?
        var currency: String?
        var availability: VerifiedProductPage.Availability = .unknown
        if offers.count == 1, let offer = offers.first, !hasType(offer, "AggregateOffer") {
            currency = (offer["priceCurrency"] as? String)?.uppercased()
            if currency == "USD" { cents = exactCents(offer["price"]) }
            if let expiration = offer["priceValidUntil"] as? String {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "yyyy-MM-dd"
                if let date = formatter.date(from: String(expiration.prefix(10))), date.addingTimeInterval(86400) < observedAt {
                    cents = nil
                    limitations.append("The retailer’s published offer has expired.")
                }
            }
            switch (offer["availability"] as? String)?.components(separatedBy: "/").last?.lowercased() {
            case "instock", "limitedavailability": availability = .inStock
            case "outofstock", "soldout", "discontinued": availability = .outOfStock
            case "preorder", "presale", "backorder": availability = .preorder
            default: break
            }
        } else if !offers.isEmpty {
            limitations.append("Multiple offers or a price range require selecting an exact retailer variant.")
        }
        if cents == nil { limitations.append("No single current USD price was verified on this page.") }
        if availability == .unknown { limitations.append("Availability was not provided in retailer metadata.") }
        if imageURL == nil { limitations.append("The retailer did not publish a usable product image.") }
        return VerifiedProductPage(productURL: pageURL.absoluteString, title: title, imageURL: imageURL,
            unitPriceCents: cents, currency: currency, availability: availability, observedAt: observedAt,
            evidence: product == nil ? "Retailer Open Graph metadata; price unverified" : (products.isEmpty && retailerProduct != nil ? "Walmart primary product metadata; item ID matched to retailer URL" : "Retailer Product / Offer JSON-LD metadata"),
            limitations: limitations)
    }

    private static func productPageIdentity(_ product: [String: Any], pageURL: URL) -> Bool? {
        var hasComparableIdentity = false
        for key in ["url", "@id"] {
            guard let candidate = product[key] as? String,
                  let resolved = URL(string: candidate, relativeTo: pageURL)?.absoluteURL,
                  ["https", "http"].contains(resolved.scheme?.lowercased() ?? ""),
                  resolved.host != nil else { continue }
            hasComparableIdentity = true
            // Fragment IDs identify the Product within this page. A different
            // path or host identifies another product, even when it is the only schema.
            guard resolved.host?.lowercased() == pageURL.host?.lowercased(),
                  resolved.path == pageURL.path else { return false }
        }
        return hasComparableIdentity ? true : nil
    }

    private static func walmartPrimaryProduct(_ json: Any, pageURL: URL) -> [String: Any]? {
        guard let host = pageURL.host?.lowercased(), host == "walmart.com" || host.hasSuffix(".walmart.com"),
              pageURL.path.hasPrefix("/ip/"),
              let root = json as? [String: Any], let props = root["props"] as? [String: Any],
              let pageProps = props["pageProps"] as? [String: Any],
              let initialData = pageProps["initialData"] as? [String: Any],
              let data = initialData["data"] as? [String: Any], let product = data["product"] as? [String: Any],
              let itemID = product["usItemId"] as? String, itemID == pageURL.lastPathComponent,
              let title = product["name"] as? String else { return nil }
        let priceInfo = product["priceInfo"] as? [String: Any] ?? [:]
        let currentPrice = priceInfo["currentPrice"] as? [String: Any] ?? [:]
        let imageInfo = product["imageInfo"] as? [String: Any] ?? [:]
        var offer: [String: Any] = ["@type": "Offer"]
        offer["price"] = currentPrice["price"]
        offer["priceCurrency"] = currentPrice["currencyUnit"]
        switch product["availabilityStatus"] as? String {
        case "IN_STOCK": offer["availability"] = "https://schema.org/InStock"
        case "OUT_OF_STOCK": offer["availability"] = "https://schema.org/OutOfStock"
        case "PREORDER": offer["availability"] = "https://schema.org/PreOrder"
        default: break
        }
        var result: [String: Any] = ["@type": "Product", "name": title, "offers": offer]
        result["image"] = imageInfo["thumbnailUrl"]
        return result
    }

    private static func exactCents(_ raw: Any?) -> Int? {
        let text: String
        if let string = raw as? String { text = string }
        else if let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { text = number.stringValue }
        else { return nil }
        guard text.range(of: #"^\d+(?:\.\d{1,2})?$"#, options: .regularExpression) != nil,
              let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), value > 0, value <= 1_000_000 else { return nil }
        return NSDecimalNumber(decimal: value * 100).intValue
    }

    private static func collectProducts(_ value: Any, into products: inout [[String: Any]]) {
        if let array = value as? [Any] { for item in array { collectProducts(item, into: &products) } }
        else if let object = value as? [String: Any] {
            if hasType(object, "Product") { products.append(object); return }
            // Follow graph/container structure, excluding recommendation/review trees.
            for key in ["@graph", "mainEntity"] { if let child = object[key] { collectProducts(child, into: &products) } }
        }
    }

    private static func hasType(_ object: [String: Any], _ type: String) -> Bool {
        let types = (object["@type"] as? [String]) ?? [object["@type"] as? String ?? ""]
        return types.contains { $0.components(separatedBy: "/").last == type }
    }

    private static func imageValue(_ value: Any?) -> String? {
        if let text = value as? String { return text }
        if let array = value as? [Any] { return array.first.flatMap { imageValue($0) } }
        if let object = value as? [String: Any] { return object["url"] as? String ?? object["contentUrl"] as? String }
        return nil
    }

    private static func metadata(in html: String) -> [String: String] {
        var result: [String: String] = [:]
        for match in matches(#"(?is)<meta\b([^>]+)>"#, in: html) {
            let values = attributes(in: match[1])
            if let key = values["property"] ?? values["name"], let content = values["content"] { result[key.lowercased()] = content }
        }
        return result
    }

    private static func attributes(in text: String) -> [String: String] {
        var result: [String: String] = [:]
        for match in matches(#"([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#, in: text) {
            result[match[1].lowercased()] = decodeEntities(match.dropFirst(2).first(where: { !$0.isEmpty }) ?? "")
        }
        return result
    }

    private static func matches(_ pattern: String, in text: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let source = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: source.length)).map { match in
            (0..<match.numberOfRanges).map { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? "" : source.substring(with: range)
            }
        }
    }

    private static func clean(_ text: String?) -> String? {
        guard let text else { return nil }
        let cleaned = decodeEntities(text).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : String(cleaned.prefix(500))
    }

    private static func decodeEntities(_ text: String) -> String {
        var result = text
        for (entity, replacement) in [("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")] {
            result = result.replacingOccurrences(of: entity, with: replacement)
        }
        return result
    }
}
