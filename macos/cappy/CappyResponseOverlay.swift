import AppKit
import SwiftUI

@MainActor
final class CappyResponseOverlayManager {
    private var panel: NSPanel?

    func show(card: CappyForecastCard) {
        let view = NSHostingView(rootView: CappyForecastCardView(card: card).padding(12))
        let size = view.fittingSize
        let visibleFrame = NSScreen.main?.visibleFrame ?? .zero
        let frame = NSRect(x: visibleFrame.maxX - size.width - 24,
                           y: visibleFrame.maxY - size.height - 72,
                           width: max(280, size.width), height: size.height)
        if panel == nil {
            panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel?.level = .statusBar
            panel?.isOpaque = false
            panel?.backgroundColor = .clear
            panel?.hasShadow = true
            panel?.hidesOnDeactivate = false
            panel?.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            // Forecast cards are passive and never intercept system-pointer input.
            panel?.ignoresMouseEvents = true
        }
        panel?.contentView = view
        panel?.setFrame(frame, display: true)
        panel?.orderFrontRegardless()
    }

    func hideOverlay() { panel?.orderOut(nil) }
}

private struct CappyForecastCardView: View {
    let card: CappyForecastCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(card.title).font(.headline)
            Text(card.detail).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 310, alignment: .leading)
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
