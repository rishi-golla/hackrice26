import AppKit
import Combine
import SwiftUI

/// Local-development integration only. Never bundles credentials or calls Production.
@MainActor
final class PlaidBankConnection: ObservableObject {
    @Published private(set) var isConnecting = false
    @Published private(set) var message: String?
    @Published private(set) var accounts: [String] = []
    private var work: Task<Void, Never>?
    private var generation = UUID()

    static var credentialsURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Flicky/plaid.plist")
    }

    func reset() {
        generation = UUID()
        work?.cancel()
        work = nil
        isConnecting = false
        message = nil
        accounts = []
    }

    func connect() {
        guard !isConnecting else { return }
        reset()
        guard let data = try? Data(contentsOf: Self.credentialsURL),
              let config = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let clientID = config["PLAID_CLIENT_ID"], !clientID.isEmpty,
              let secret = config["PLAID_SANDBOX_SECRET"], !secret.isEmpty else {
            message = "Plaid connection isn’t configured yet."
            return
        }
        isConnecting = true
        message = "Opening Plaid…"
        let run = generation
        work = Task {
            do {
                let api = PlaidSandboxAPI(clientID: clientID, secret: secret)
                let link = try await api.post("/link/token/create", body: [
                    "client_name": "PeppaPrice", "language": "en", "country_codes": ["US"],
                    "products": ["auth"], "user": ["client_user_id": UUID().uuidString],
                    "hosted_link": [:] as [String: String]
                ])
                try Task.checkCancellation()
                guard run == generation else { return }
                guard let token = link["link_token"] as? String, token.hasPrefix("link-sandbox-"),
                      let rawURL = link["hosted_link_url"] as? String,
                      let url = Self.hostedURL(rawURL), NSWorkspace.shared.open(url) else {
                    throw PlaidConnectionError.unavailable
                }
                message = "Complete the bank connection in Plaid."
                for _ in 0..<180 {
                    try await Task.sleep(for: .seconds(5))
                    let state = try await api.post("/link/token/get", body: ["link_token": token])
                    try Task.checkCancellation()
                    guard run == generation else { return }
                    if let publicToken = Self.publicToken(in: state) {
                        let item = try await api.post("/item/public_token/exchange", body: ["public_token": publicToken])
                        guard let access = item["access_token"] as? String, access.hasPrefix("access-sandbox-") else {
                            throw PlaidConnectionError.unavailable
                        }
                        let auth = try await api.post("/auth/get", body: ["access_token": access])
                        try Task.checkCancellation()
                        guard run == generation else { return }
                        accounts = Self.authenticatedAccounts(in: auth)
                        guard !accounts.isEmpty else { throw PlaidConnectionError.pending }
                        message = "Connected through Plaid"
                        isConnecting = false
                        return
                    }
                    let sessions = state["link_sessions"] as? [[String: Any]] ?? []
                    if sessions.contains(where: { $0["finished_at"] is String }) {
                        throw PlaidConnectionError.incomplete
                    }
                }
                throw PlaidConnectionError.expired
            } catch {
                guard run == generation, !Task.isCancelled else { return }
                message = (error as? PlaidConnectionError)?.errorDescription ?? "Couldn’t connect to Plaid. Try again."
                isConnecting = false
            }
        }
    }

    static func hostedURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil,
              let host = url.host, host == "plaid.com" || host.hasSuffix(".plaid.com") else { return nil }
        return url
    }

    static func publicToken(in response: [String: Any]) -> String? {
        for session in response["link_sessions"] as? [[String: Any]] ?? [] {
            let results = session["results"] as? [String: Any]
            let items = results?["item_add_results"] as? [[String: Any]] ?? []
            let legacy = session["on_success"] as? [String: Any]
            for item in items + [legacy ?? [:]] {
                if let token = item["public_token"] as? String, token.hasPrefix("public-sandbox-") { return token }
            }
        }
        return nil
    }

    static func authenticatedAccounts(in response: [String: Any]) -> [String] {
        let numbers = response["numbers"] as? [String: Any]
        let ach = numbers?["ach"] as? [[String: Any]] ?? []
        let ids = Set(ach.compactMap { $0["account_id"] as? String })
        return (response["accounts"] as? [[String: Any]] ?? []).compactMap { account in
            guard let id = account["account_id"] as? String, ids.contains(id),
                  let name = account["name"] as? String else { return nil }
            let status = account["verification_status"] as? String
            guard status == nil || ["automatically_verified", "manually_verified"].contains(status!) else { return nil }
            let mask = account["mask"] as? String
            return name + (mask.map { " · •••• " + $0 } ?? "")
        }
    }
}

private enum PlaidConnectionError: LocalizedError {
    case unavailable, pending, incomplete, expired
    var errorDescription: String? {
        switch self {
        case .unavailable: return "Couldn’t start Plaid. Try again."
        case .pending: return "Account verification is still pending. Try again after it completes."
        case .incomplete: return "Bank connection wasn’t completed. Try again."
        case .expired: return "The connection session expired. Try again."
        }
    }
}

private struct PlaidSandboxAPI {
    let clientID: String
    let secret: String
    func post(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://sandbox.plaid.com" + path)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("2020-09-14", forHTTPHeaderField: "Plaid-Version")
        var payload = body
        payload["client_id"] = clientID
        payload["secret"] = secret
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PlaidConnectionError.unavailable
        }
        return json
    }
}

struct PlaidBankConnectionRow: View {
    let owner: String
    @StateObject private var connection = PlaidBankConnection()
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button { connection.connect() } label: {
                    Label(connection.accounts.isEmpty ? "Connect bank with Plaid" : "Connect another bank", systemImage: "building.columns")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.plain)
                .disabled(connection.isConnecting)
                .help("Connect a Plaid sandbox test bank. This does not verify the Nessie account above.")
                Spacer()
                if connection.isConnecting {
                    ProgressView().controlSize(.mini)
                    Button("Cancel") { connection.reset() }.buttonStyle(.plain).font(.system(size: 11))
                } else {
                    Image(systemName: "arrow.up.right").font(.system(size: 10))
                }
            }
            if let message = connection.message {
                Text(message).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            ForEach(connection.accounts, id: \.self) { account in
                Label(account, systemImage: "checkmark.circle").font(.system(size: 11))
            }
        }
        .foregroundStyle(Color(red: 0.35, green: 0.94, blue: 0.64))
        .onChange(of: owner) { _, _ in connection.reset() }
        .onDisappear { connection.reset() }
    }
}
