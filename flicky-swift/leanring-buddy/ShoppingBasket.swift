import Foundation
import Combine

struct BasketProduct: Codable, Identifiable, Equatable {
    var id: String { url }
    let title: String
    let price: String
    let url: String
    let source: String
    let imageURL: String?
    let deliveryInfo: String?

    init(_ listing: ProductSearchResult) {
        title = listing.title
        price = listing.price
        url = listing.url
        source = listing.source
        imageURL = listing.imageURL
        deliveryInfo = listing.deliveryInfo
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

    static func money(_ cents: Int) -> String { String(format: "$%.2f", Double(cents) / 100) }
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
    private let storageURL: URL?

    init(storageURL: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("Flicky/shopping-basket.json")) {
        self.storageURL = storageURL
        guard let storageURL, FileManager.default.fileExists(atPath: storageURL.path) else { return }
        do {
            let saved = try JSONDecoder().decode([ShoppingBasketLine].self, from: Data(contentsOf: storageURL))
            lines = saved.prefix(24).map { line in
                var validated = line
                validated.quantity = min(99, max(1, line.quantity))
                validated.options = line.options.filter { $0.listingURL != nil }
                return validated
            }
        } catch {
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
    func addSearch(query: String, quantity: Int, products: [BasketProduct], selectedURL: String?) -> UUID? {
        // Repeated model rounds must not duplicate or overwrite a basket the user edited.
        if let existing = lines.first(where: { $0.query.caseInsensitiveCompare(query) == .orderedSame }) { return existing.id }
        guard lines.count < 24 else { message = "Your basket has 24 different items. Remove one before adding more."; return nil }
        var seen = Set<String>()
        let options = products.filter { $0.listingURL != nil && seen.insert($0.url).inserted }
        let line = ShoppingBasketLine(id: UUID(), query: query, quantity: min(99, max(1, quantity)), options: options,
            selectedURL: options.contains { $0.url == selectedURL } ? selectedURL : nil, foundAt: Date())
        lines.append(line)
        save()
        return line.id
    }

    func add(_ listing: ProductSearchResult) {
        let product = BasketProduct(listing)
        guard product.listingURL != nil else { message = "This listing doesn’t have a valid secure link."; return }
        if let existing = lines.first(where: { $0.selectedURL == product.url }) {
            setQuantity(existing.quantity + 1, for: existing.id)
        } else {
            _ = addSearch(query: product.title, quantity: 1, products: [product], selectedURL: product.url)
        }
    }

    func setQuantity(_ quantity: Int, for id: UUID) {
        guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
        lines[index].quantity = min(99, max(1, quantity))
        save()
    }

    func select(_ url: String, for id: UUID) {
        guard let index = lines.firstIndex(where: { $0.id == id }), lines[index].options.contains(where: { $0.url == url }) else { return }
        lines[index].selectedURL = url
        save()
    }

    func remove(_ id: UUID) { lines.removeAll { $0.id == id }; save() }

    var context: String {
        guard !lines.isEmpty else { return "Shopping basket is empty." }
        return "Current draft basket (not orders; tax/shipping unconfirmed):\n" + lines.map {
            "\($0.quantity) × \($0.query): \($0.product?.title ?? "selection needed") — \($0.product?.price ?? "unknown price") each, \($0.product?.merchant ?? "store not selected")"
        }.joined(separator: "\n")
    }

    private func save() {
        guard let storageURL else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(lines).write(to: storageURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
        } catch { message = "Your basket is available now, but couldn’t be saved for next time." }
    }
}
