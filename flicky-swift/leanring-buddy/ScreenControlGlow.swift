import AppKit

/// Shared ownership keeps overlapping screen actions from hiding each other's indicator.
@MainActor
final class ScreenControlGlow: NSObject {
    static let shared = ScreenControlGlow()
    private var activeSources: Set<String> = []
    private var windows: [NSPanel] = []
    private let rendersWindows: Bool
    var isActive: Bool { !activeSources.isEmpty }

    init(rendersWindows: Bool = true) {
        self.rendersWindows = rendersWindows
        super.init()
        if rendersWindows {
            NotificationCenter.default.addObserver(self, selector: #selector(displaysChanged),
                name: NSApplication.didChangeScreenParametersNotification, object: nil)
        }
    }

    func setActive(_ active: Bool, source: String) {
        let wasActive = isActive
        if active { activeSources.insert(source) } else { activeSources.remove(source) }
        guard rendersWindows, wasActive != isActive else { return }
        if isActive { show() } else { hide() }
    }

    /// Brief feedback for a one-shot external browser launch.
    func flash() {
        let source = UUID().uuidString
        setActive(true, source: source)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            self?.setActive(false, source: source)
        }
    }

    @objc private func displaysChanged() {
        guard isActive else { return }
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        show()
    }

    private func show() {
        for screen in NSScreen.screens {
            let panel = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered, defer: false)
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.ignoresMouseEvents = true
            panel.hidesOnDeactivate = false
            panel.isReleasedWhenClosed = false
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue - 1)
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            panel.isExcludedFromWindowsMenu = true
            panel.contentView = ScreenControlGlowView(frame: NSRect(origin: .zero, size: screen.frame.size))
            panel.alphaValue = 0
            windows.append(panel)
            panel.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
                panel.animator().alphaValue = 1
            }
        }
    }

    private func hide() {
        // An old fade may finish after a new action starts; it owns only these windows.
        let retiringWindows = windows
        windows.removeAll()
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.12
            retiringWindows.forEach { $0.animator().alphaValue = 0 }
        }, completionHandler: {
            retiringWindows.forEach { $0.orderOut(nil) }
        })
    }
}

final class ScreenControlGlowView: NSView {
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        let pink = NSColor(srgbRed: 1, green: 0.48, blue: 0.69, alpha: 1)
        let edge = NSGradient(starting: pink.withAlphaComponent(0.18), ending: pink.withAlphaComponent(0))!
        let depth: CGFloat = 22
        edge.draw(in: NSRect(x: 0, y: 0, width: bounds.width, height: depth), angle: 90)
        edge.draw(in: NSRect(x: 0, y: bounds.height - depth, width: bounds.width, height: depth), angle: 270)
        edge.draw(in: NSRect(x: 0, y: 0, width: depth, height: bounds.height), angle: 0)
        edge.draw(in: NSRect(x: bounds.width - depth, y: 0, width: depth, height: bounds.height), angle: 180)
        let corner = NSGradient(starting: pink.withAlphaComponent(0.23), ending: pink.withAlphaComponent(0))!
        for point in [NSPoint(x: 0, y: 0), NSPoint(x: bounds.width, y: 0),
                      NSPoint(x: 0, y: bounds.height), NSPoint(x: bounds.width, y: bounds.height)] {
            corner.draw(fromCenter: point, radius: 0, toCenter: point, radius: 95, options: [])
        }
        pink.withAlphaComponent(0.3).setStroke()
        let outline = NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 12, yRadius: 12)
        outline.lineWidth = 1.25
        outline.stroke()
    }
}
