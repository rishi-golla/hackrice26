import AppKit

@main struct ScreenControlGlowCheck {
    @MainActor static func main() throws {
        let glow = ScreenControlGlow(rendersWindows: false)
        precondition(!glow.isActive)
        glow.setActive(true, source: "browser")
        glow.setActive(true, source: "browser")
        glow.setActive(true, source: "pointer")
        glow.setActive(false, source: "browser")
        precondition(glow.isActive, "A completed browser action cannot hide an active pointer action")
        glow.setActive(false, source: "unknown")
        precondition(glow.isActive)
        glow.setActive(false, source: "pointer")
        precondition(!glow.isActive, "Glow clears when the final operation ends")
        print("PASS: overlapping control ownership, duplicate activation, unknown completion and final cleanup")
        if CommandLine.arguments.contains("--render") {
            _ = NSApplication.shared
            let view = ScreenControlGlowView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800))
            precondition(view.hitTest(NSPoint(x: 2, y: 2)) == nil)
            let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
            view.cacheDisplay(in: view.bounds, to: bitmap)
            precondition(bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)!.alphaComponent == 0,
                "The center must remain completely clear")
            try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments.last!))
            print("PASS: native glow render, transparent center and click-through hit testing")
        }
    }
}
