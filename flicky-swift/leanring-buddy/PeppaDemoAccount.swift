import Foundation

/// An index of seeded sandbox IDs, not a source of financial values.
/// Selection always verifies customer/account ownership through Nessie.
struct PeppaDemoAccount: Decodable, Identifiable {
    let id: String
    let customerId: String
    let customerName: String
    let nickname: String
    let type: String

    static func load() -> [Self] {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let data = try? Data(contentsOf: support.appendingPathComponent("Flicky/peppaprice-demo-accounts.json")),
              let accounts = try? JSONDecoder().decode([Self].self, from: data) else { return [] }
        return accounts
    }
}
