import Combine
import Foundation

struct CappyAuthenticatedSession: Equatable {
    let id: String
    let userID: String
    let accountID: String
}

struct CappyProfile: Equatable {
    var reserveCents: Int
    var monitoringEnabled: Bool
}

@MainActor
final class CappyAuthSessionStore: ObservableObject {
    @Published private(set) var session: CappyAuthenticatedSession?
    @Published private(set) var profile: CappyProfile?
    var onSessionInvalidated: (() -> Void)?

    var activeAccountID: String? { session?.accountID }
    var isAuthenticated: Bool { session != nil }

    func activate(session: CappyAuthenticatedSession, profile: CappyProfile) {
        if self.session?.accountID != nil, self.session?.accountID != session.accountID {
            onSessionInvalidated?()
        }
        self.session = session
        self.profile = profile
    }

    func logout() {
        guard session != nil else { return }
        session = nil
        profile = nil
        onSessionInvalidated?()
    }
}
