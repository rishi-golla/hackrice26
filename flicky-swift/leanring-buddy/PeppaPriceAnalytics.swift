// PeppaPriceAnalytics.swift — Stubbed out for PeppaPrice (PostHog removed)
// All methods are no-ops. This stub keeps the rest of the codebase compiling
// without requiring the PostHog Swift SDK.

import Foundation

enum PeppaPriceAnalytics {
    static func configure() {}
    static func trackAppOpened() {}
    static func trackOnboardingStarted() {}
    static func trackOnboardingReplayed() {}
    static func trackPermissionGranted(permission: String) {}
    static func trackAllPermissionsGranted() {}
    static func trackVoiceTurnStarted() {}
    static func trackVoiceTurnCompleted(durationSeconds: Double, responseLength: Int) {}
    static func trackError(domain: String, message: String) {}
}
