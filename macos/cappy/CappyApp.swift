import ServiceManagement
import SwiftUI

@main
struct CappyApp: App {
    @NSApplicationDelegateAdaptor(CappyAppDelegate.self) var appDelegate

    var body: some Scene { Settings { EmptyView() } }
}

@MainActor
final class CappyAppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarPanelManager: MenuBarPanelManager?
    private let cappyManager = CappyManager()

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["NSInitialToolTipDelay": 0])
        menuBarPanelManager = MenuBarPanelManager(cappyManager: cappyManager)
        cappyManager.start()
        menuBarPanelManager?.showPanelOnLaunch()
        registerAsLoginItemIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) { cappyManager.stop() }

    private func registerAsLoginItemIfNeeded() {
        let loginItemService = SMAppService.mainApp
        if loginItemService.status != .enabled { try? loginItemService.register() }
    }
}
