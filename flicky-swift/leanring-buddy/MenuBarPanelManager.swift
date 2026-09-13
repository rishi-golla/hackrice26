//
//  MenuBarPanelManager.swift
//  leanring-buddy
//
//  Manages the NSStatusItem (menu bar icon) and a custom borderless NSPanel
//  that drops down below it when clicked. The panel hosts a SwiftUI view
//  (CompanionPanelView) via NSHostingView. Uses the same NSPanel pattern as
//  FloatingSessionButton and GlobalPushToTalkOverlay for consistency.
//
//  The panel is non-activating so it does not steal focus from the user's
//  current app, and auto-dismisses when the user clicks outside.
//

import AppKit
import Carbon
import SwiftUI

extension Notification.Name {
    static let peppapriceShowAccountPanel = Notification.Name("peppapriceShowAccountPanel")
    static let flickyPanelOpened = Notification.Name("flickyPanelOpened")
    static let peppapriceDismissPanel = Notification.Name("peppapriceDismissPanel")
}

/// Custom NSPanel subclass that can become the key window even with
/// .nonactivatingPanel style, allowing text fields to receive focus.
private class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
final class MenuBarPanelManager: NSObject {
    private var panelKeyMonitor: Any?
    private var panelHotKey: EventHotKeyRef?
    private var panelHotKeyHandler: EventHandlerRef?
    private var statusItem: NSStatusItem?
    private var panel: NSPanel?
    private var clickOutsideMonitor: Any?
    private var dismissPanelObserver: NSObjectProtocol?
    private var showAccountPanelObserver: NSObjectProtocol?

    private let companionManager: CompanionManager
    private let panelWidth = CompanionPanelLayout.width
    private var panelHeight = CompanionPanelLayout.height

    init(companionManager: CompanionManager) {
        self.companionManager = companionManager
        super.init()
        createStatusItem()
        registerPanelShortcut()
        // Also handle app-directed key events while our nonactivating panel has
        // focus. System hotkeys are consumed upstream and won't reach this path.
        panelKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
            if event.keyCode == UInt16(kVK_Space), flags == [.command, .shift] {
                if !event.isARepeat { self?.statusItemClicked() }
                return nil
            }
            return event
        }

        showAccountPanelObserver = NotificationCenter.default.addObserver(
            forName: .peppapriceShowAccountPanel, object: nil, queue: .main
        ) { [weak self] _ in self?.showPanel() }

        dismissPanelObserver = NotificationCenter.default.addObserver(
            forName: .peppapriceDismissPanel,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.hidePanel()
        }
    }

    deinit {
        if let observer = showAccountPanelObserver { NotificationCenter.default.removeObserver(observer) }
        if let panelKeyMonitor { NSEvent.removeMonitor(panelKeyMonitor) }
        if let panelHotKey { UnregisterEventHotKey(panelHotKey) }
        if let panelHotKeyHandler { RemoveEventHandler(panelHotKeyHandler) }
        if let monitor = clickOutsideMonitor {
            NSEvent.removeMonitor(monitor)
        }
        if let observer = dismissPanelObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Status Item

    private func createStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        guard let button = statusItem?.button else { return }

        button.image = NSImage(named: "PeppaPriceLogo")?.copy() as? NSImage
        button.image?.size = NSSize(width: 20, height: 20)
        button.setAccessibilityLabel("PeppaPrice")
        button.toolTip = "PeppaPrice — ⌘⇧Space to open"
        button.image?.isTemplate = false
        button.action = #selector(statusItemClicked)
        button.target = self
    }

    /// Opens the panel automatically on app launch so the user sees
    /// permissions and the start button right away.
    func showPanelOnLaunch() {
        // Small delay so the status item has time to appear in the menu bar
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.showPanel()
        }
    }

    @objc private func statusItemClicked() {
        if let panel, panel.isVisible {
            hidePanel()
        } else {
            showPanel()
        }
    }

    // Register a real system hotkey: works before Accessibility permission and
    // consumes the chord so it doesn't also type into the foreground app.
    private func registerPanelShortcut() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: UInt32(kEventHotKeyPressed))
        let handlerStatus = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let result = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size,
                nil, &identifier)
            guard result == noErr, identifier.signature == 0x464C4B59, identifier.id == 1 else {
                return OSStatus(eventNotHandledErr)
            }
            let manager = Unmanaged<MenuBarPanelManager>.fromOpaque(context).takeUnretainedValue()
            Task { @MainActor [weak manager] in manager?.statusItemClicked() }
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &panelHotKeyHandler)
        guard handlerStatus == noErr else {
            print("PeppaPrice: couldn't install panel shortcut handler (\(handlerStatus))")
            return
        }
        let identifier = EventHotKeyID(signature: 0x464C4B59, id: 1)
        let status = RegisterEventHotKey(UInt32(kVK_Space), UInt32(cmdKey | shiftKey),
                                        identifier, GetApplicationEventTarget(), 0, &panelHotKey)
        if status != noErr {
            print("PeppaPrice: couldn't register ⌘⇧Space (\(status)); shortcut may be in use")
            statusItem?.button?.toolTip = "PeppaPrice — panel shortcut unavailable (⌘⇧Space may be in use)"
        }
    }

    // MARK: - Panel Lifecycle

    private func showPanel() {
        if panel == nil {
            createPanel()
        }

        positionPanelBelowStatusItem()

        companionManager.responseOverlayManager.setPresentedInMainPanel(true)
        panel?.makeKeyAndOrderFront(nil)
        panel?.orderFrontRegardless()
        installClickOutsideMonitor()
        NotificationCenter.default.post(name: .flickyPanelOpened, object: nil)
    }

    private func hidePanel() {
        panel?.orderOut(nil)
        companionManager.responseOverlayManager.setPresentedInMainPanel(false)
        removeClickOutsideMonitor()
    }

    private func createPanel() {
        let companionPanelView = CompanionPanelView(companionManager: companionManager) { [weak self] height in
            guard let self, abs(self.panelHeight - height) > 0.5 else { return }
            self.panelHeight = height
            DispatchQueue.main.async { [weak self] in self?.positionPanelBelowStatusItem() }
        }


        let hostingView = NSHostingView(rootView: companionPanelView)
        hostingView.frame = NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight)
        hostingView.sizingOptions = []
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = .clear
        hostingView.focusRingType = .none

        let menuBarPanel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        menuBarPanel.isFloatingPanel = true
        menuBarPanel.level = .floating
        menuBarPanel.isOpaque = false
        menuBarPanel.backgroundColor = .clear
        menuBarPanel.hasShadow = true
        menuBarPanel.hidesOnDeactivate = false
        menuBarPanel.isExcludedFromWindowsMenu = true
        menuBarPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        menuBarPanel.isMovableByWindowBackground = false
        menuBarPanel.titleVisibility = .hidden
        menuBarPanel.titlebarAppearsTransparent = true

        menuBarPanel.contentView = hostingView
        panel = menuBarPanel
    }

    private func positionPanelBelowStatusItem() {
        guard let panel else { return }
        guard let buttonWindow = statusItem?.button?.window else { return }

        let visibleFrame = buttonWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? buttonWindow.frame
        let scale = min(1, (visibleFrame.width - 40) / panelWidth, (visibleFrame.height - 40) / panelHeight)
        let size = CGSize(width: panelWidth * scale, height: panelHeight * scale)
        panel.setFrame(NSRect(x: visibleFrame.midX - size.width / 2,
                              y: visibleFrame.midY - size.height / 2,
                              width: size.width, height: size.height), display: true)

    }

    // MARK: - Click Outside Dismissal

    /// Installs a global event monitor that hides the panel when the user clicks
    /// anywhere outside it — the same transient dismissal behavior as NSPopover.
    /// Uses a short delay so that system permission dialogs (triggered by Grant
    /// buttons in the panel) don't immediately dismiss the panel when they appear.
    private func installClickOutsideMonitor() {
        removeClickOutsideMonitor()

        clickOutsideMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] event in
            guard let self, let panel = self.panel else { return }

            // Check if the click is inside the status item button — if so, the
            // statusItemClicked handler will toggle the panel, so don't also hide.
            let clickLocation = NSEvent.mouseLocation
            if panel.frame.contains(clickLocation) {
                return
            }

            // Delay dismissal slightly to avoid closing the panel when
            // a system permission dialog appears (e.g. microphone access).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                guard panel.isVisible else { return }

                // If permissions aren't all granted yet, a system dialog
                // may have focus — don't dismiss during onboarding.
                if !self.companionManager.allPermissionsGranted && !NSApp.isActive {
                    return
                }

                self.hidePanel()
            }
        }
    }

    private func removeClickOutsideMonitor() {
        if let monitor = clickOutsideMonitor {
            NSEvent.removeMonitor(monitor)
            clickOutsideMonitor = nil
        }
    }
}
