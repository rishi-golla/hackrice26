import Foundation
import Combine

struct BasketProduct: Codable, Identifiable, Equatable, Sendable {
    var id: String { url }
    let title: String
    let price: String
    let url: String
    let source: String
    let imageURL: String?
    let deliveryInfo: String?
    var verifiedPage: VerifiedProductPage?

    init(_ listing: ProductSearchResult) {
        title = listing.title
        price = listing.price
        url = listing.url
        source = listing.source
        imageURL = listing.imageURL
        deliveryInfo = listing.deliveryInfo
        verifiedPage = nil
    }

    init(page: VerifiedProductPage) {
        title = page.title
        price = page.unitPriceCents.map(Self.money) ?? "Price not confirmed"
        url = page.productURL
        source = URL(string: page.productURL)?.host?.replacingOccurrences(of: "www.", with: "") ?? "Retailer"
        imageURL = page.imageURL
        deliveryInfo = nil
        verifiedPage = page
    }

    var isVerifiedOption: Bool {
        guard let page = verifiedPage, page.hasVerifiedPrice, page.availability == .inStock,
              let cents = page.unitPriceCents, cents > 0, cents == unitPriceCents,
              page.productURL == url, !page.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              (try? ProductPageResolver.merchantURL(from: url)) != nil,
              let image = page.imageURL.flatMap(URL.init(string:)), image.scheme == "https", image.host != nil else { return false }
        return true
    }

    var readyForDemoCheckout: Bool {
        guard isVerifiedOption, let page = verifiedPage else { return false }
        return (0..<(15 * 60)).contains(Date().timeIntervalSince(page.observedAt))
    }

    var unitPriceCents: Int? { Self.usdCents(price) }

    // Reject ranges, installments, other currencies and "from" prices rather
    // than quietly turning an ambiguous search snippet into an order total.
    static func usdCents(_ price: String) -> Int? {
        let value = price.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = #"^(?:US\$|USD\s*|\$)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              let range = Range(match.range(at: 1), in: value),
              let dollars = Decimal(string: String(value[range]).replacingOccurrences(of: ",", with: ""), locale: Locale(identifier: "en_US_POSIX")),
              dollars > 0, dollars <= 1_000_000 else { return nil }
        return NSDecimalNumber(decimal: dollars * 100).intValue
    }

    var listingURL: URL? {
        guard let parsed = URL(string: url), parsed.scheme == "https",
              parsed.host != nil, parsed.user == nil, parsed.password == nil else { return nil }
        return parsed
    }

    var merchant: String {
        let label = source.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty || label.lowercased() == "web" ? (listingURL?.host ?? "Store") : label
    }

    nonisolated static func money(_ cents: Int) -> String { String(format: "$%.2f", Double(cents) / 100) }
}

struct ShoppingBasketLine: Codable, Identifiable {
    let id: UUID
    let query: String
    var quantity: Int
    var options: [BasketProduct]
    var selectedURL: String?
    let foundAt: Date

    var product: BasketProduct? { options.first { $0.url == selectedURL } }
    var subtotalCents: Int? { product?.unitPriceCents.map { $0 * quantity } }
}

struct ShoppingBasketRequest: Equatable {
    let query: String
    let quantity: Int

    static func parse(_ response: String) -> [Self] {
        guard let regex = try? NSRegularExpression(pattern: #"\[SHOP:\s*([^\]|]+)\|\s*(\d+)\s*\]"#, options: .caseInsensitive) else { return [] }
        var seen = Set<String>()
        return regex.matches(in: response, range: NSRange(response.startIndex..., in: response)).compactMap { match in
            let query = (response as NSString).substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty, query.count <= 240, seen.insert(query.lowercased()).inserted,
                  let quantity = Int((response as NSString).substring(with: match.range(at: 2))),
                  (1...99).contains(quantity) else { return nil }
            return Self(query: query, quantity: quantity)
        }.prefix(6).map { $0 }
    }
}

@MainActor
final class ShoppingBasketStore: ObservableObject {
    @Published private(set) var lines: [ShoppingBasketLine] = []
    @Published var progress: String?
    @Published var message: String?
    @Published private(set) var isSaved = true
    @Published var verificationIssues: [String: String] = [:]
    @Published var isLocked = false
    private let storageURL: URL?

    init(storageURL: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("Flicky/shopping-basket.json")) {
        self.storageURL = storageURL
        guard let storageURL, FileManager.default.fileExists(atPath: storageURL.path) else { return }
        do {
            let saved = try JSONDecoder().decode([ShoppingBasketLine].self, from: Data(contentsOf: storageURL))
            lines = saved.prefix(24).map { line in
                var validated = line
                validated.quantity = min(99, max(1, line.quantity))
                validated.options = line.options.filter { $0.isVerifiedOption }
                return validated
            }.filter { $0.product != nil }
            if lines.count != saved.count {
                message = "Removed old suggestions that weren’t verified in-stock products."
                save()
            }
        } catch {
            isSaved = false
            message = "Your saved basket couldn’t be loaded. You can start a new one."
        }
    }

    var itemCount: Int { lines.reduce(0) { $0 + $1.quantity } }
    var estimatedSubtotalCents: Int { lines.compactMap(\.subtotalCents).reduce(0, +) }
    var hasIncompletePrices: Bool { lines.contains { $0.subtotalCents == nil } }
    var merchants: [String] {
        Array(Set(lines.compactMap { $0.product?.merchant })).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    @discardableResult
    func addSearch(query: String, quantity: Int, products: [BasketProduct], selectedURL: String?, deduplicateQuery: Bool = true) -> UUID? {
        guard !isLocked else { message = "Finish the current demo checkout before changing the basket."; return nil }
        // Repeated model rounds must not duplicate or overwrite a basket the user edited.
        if deduplicateQuery, let existing = lines.first(where: { $0.query.caseInsensitiveCompare(query) == .orderedSame }) { return existing.id }
        guard lines.count < 24 else { message = "Your basket has 24 different items. Remove one before adding more."; return nil }
        var seen = Set<String>()
        let options = products.filter { $0.readyForDemoCheckout && seen.insert($0.url).inserted }
        guard let selectedURL, options.contains(where: { $0.url == selectedURL }) else { return nil }
        let line = ShoppingBasketLine(id: UUID(), query: query, quantity: min(99, max(1, quantity)), options: options,
            selectedURL: options.contains { $0.url == selectedURL } ? selectedURL : nil, foundAt: Date())
        lines.append(line)
        save()
        return line.id
    }

    func setQuantity(_ quantity: Int, for id: UUID) {
        guard !isLocked else { return }
        guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
        lines[index].quantity = min(99, max(1, quantity))
        save()
    }

    func select(_ url: String, for id: UUID) {
        guard !isLocked else { return }
        guard let index = lines.firstIndex(where: { $0.id == id }), lines[index].options.contains(where: { $0.url == url && $0.readyForDemoCheckout }) else { return }
        lines[index].selectedURL = url
        save()
    }

    func remove(_ id: UUID) { guard !isLocked else { return }; lines.removeAll { $0.id == id }; save() }

    func applyVerifiedPage(_ page: VerifiedProductPage, replacing originalURL: String) {
        guard !isLocked else { return }
        let verified = BasketProduct(page: page)
        guard verified.readyForDemoCheckout else {
            recordVerificationFailure(for: originalURL, reason: "Removed an item whose price, photo, or in-stock status could not be confirmed.")
            return
        }
        for index in lines.indices {
            lines[index].options = lines[index].options.map { $0.url == originalURL ? verified : $0 }
            if lines[index].selectedURL == originalURL { lines[index].selectedURL = verified.url }
        }
        verificationIssues[originalURL] = nil
        save()
    }

    func recordVerificationFailure(for url: String, reason: String) {
        guard !isLocked else { return }
        verificationIssues[url] = reason
        for index in lines.indices { lines[index].options.removeAll { $0.url == url } }
        lines.removeAll { $0.product == nil }
        message = reason
        save()
    }

    func addVerifiedPage(_ page: VerifiedProductPage) {
        let product = BasketProduct(page: page)
        guard product.readyForDemoCheckout else {
            message = "Not added: the retailer must confirm a product link, photo, price, and in-stock status."
            return
        }
        if let existing = lines.first(where: { $0.selectedURL == product.url }) {
            applyVerifiedPage(page, replacing: product.url)
            setQuantity(existing.quantity + 1, for: existing.id)
        } else {
            _ = addSearch(query: product.title, quantity: 1, products: [product], selectedURL: product.url, deduplicateQuery: false)
        }
    }

    func removePaidLines(_ ids: Set<UUID>) {
        lines.removeAll { ids.contains($0.id) }
        save()
    }

    var readyForDemoCheckout: Bool {
        !lines.isEmpty && lines.allSatisfy { $0.product?.readyForDemoCheckout == true }
    }

    var context: String {
        guard !lines.isEmpty else { return "Shopping basket is empty." }
        return "Current draft basket (not orders; tax/shipping unconfirmed):\n" + lines.map {
            "\($0.quantity) × \($0.query): \($0.product?.title ?? "selection needed") — \($0.product?.price ?? "unknown price") each, \($0.product?.merchant ?? "store not selected")"
        }.joined(separator: "\n")
    }

    private func save() {
        guard let storageURL else { isSaved = false; return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(lines).write(to: storageURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
            isSaved = true
        } catch {
            isSaved = false
            message = "Your basket is available now, but couldn’t be saved for next time."
        }
    }
}
