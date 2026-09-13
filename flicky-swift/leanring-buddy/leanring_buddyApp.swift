// leanring_buddyApp.swift — PeppaPrice Financial Advisor
//
// Menu bar-only macOS app. No dock icon, no main window.
// Clicking the menu bar icon opens the floating PeppaPrice panel.

import ServiceManagement
import SwiftUI

@main
struct leanring_buddyApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarPanelManager: MenuBarPanelManager?
    private let companionManager = CompanionManager()

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("🐦 PeppaPrice Financial Advisor — starting")
        UserDefaults.standard.register(defaults: ["NSInitialToolTipDelay": 0])

        menuBarPanelManager = MenuBarPanelManager(companionManager: companionManager)
        companionManager.start()

        // Auto-open the panel if setup is needed
        if !companionManager.hasCompletedOnboarding || !companionManager.allPermissionsGranted {
            menuBarPanelManager?.showPanelOnLaunch()
        }

        registerAsLoginItemIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) {
        companionManager.stop()
    }

    private func registerAsLoginItemIfNeeded() {
        let loginItemService = SMAppService.mainApp
        if loginItemService.status != .enabled {
            do {
                try loginItemService.register()
                print("🐦 PeppaPrice: Registered as login item")
            } catch {
                print("⚠️ PeppaPrice: Failed to register login item: \(error)")
            }
        }
    }
}
