// CompanionResponseOverlay.swift — PeppaPrice cursor-following response overlay
//
// Displays streaming response text and speech controls next to the cursor.
// Non-activating NSPanel: floats above all apps without stealing focus.

import AppKit
import Combine
import SwiftUI

// MARK: - View Model

@MainActor
final class CompanionResponseOverlayViewModel: ObservableObject {
    @Published var streamingResponseText: String = ""
    @Published var isShowingResponse: Bool = false
    @Published var isSpeaking: Bool = false

    // Set by CompanionResponseOverlayManager so the stop button rendered inside
    // FlickyResponseOverlayView can reach back out to CompanionManager without
    // the view itself needing a reference to it.
    var onStopButtonTapped: (() -> Void)?
}

// MARK: - Overlay Manager

@MainActor
final class CompanionResponseOverlayManager {
    let viewModel = CompanionResponseOverlayViewModel()
    private var isPresentedInMainPanel = false

    func setPresentedInMainPanel(_ presented: Bool) {
        isPresentedInMainPanel = presented
        if presented {
            overlayPanel?.orderOut(nil)
        } else if viewModel.isShowingResponse {
            repositionPanelNearCursor()
            overlayPanel?.alphaValue = 1
            overlayPanel?.orderFrontRegardless()
        }
    }
    private var overlayPanel: NSPanel?
    private var autoHideWorkItem: DispatchWorkItem?
    private var cursorTrackingTimer: Timer?
    private var shouldAutoHideAfterSpeaking = false

    private let cursorOffsetX: CGFloat = 90
    private let cursorOffsetY: CGFloat = 6
    private let overlayMaxWidth: CGFloat = 360

    /// Exposes the stop-button tap to whoever owns this manager (CompanionManager),
    /// without the SwiftUI view needing a direct reference back to it.
    var onStopButtonTapped: (() -> Void)? {
        get { viewModel.onStopButtonTapped }
        set { viewModel.onStopButtonTapped = newValue }
    }

    /// Starts a new response beside the cursor and follows it while visible.
    func beginNewAutonomousSession() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        shouldAutoHideAfterSpeaking = false
        viewModel.isSpeaking = false
        viewModel.streamingResponseText = ""
        viewModel.isShowingResponse = true
        createOverlayPanelIfNeeded()
        repositionPanelNearCursor()
        overlayPanel?.alphaValue = 1
        if !isPresentedInMainPanel { overlayPanel?.orderFrontRegardless() }
        startFollowingCursor()
    }

    /// Replaces the response for the next round without interrupting cursor tracking.
    func beginNextAutonomousRound() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        shouldAutoHideAfterSpeaking = false
        viewModel.isSpeaking = false
        viewModel.streamingResponseText = ""
        viewModel.isShowingResponse = true
        createOverlayPanelIfNeeded()
        overlayPanel?.alphaValue = 1
        if !isPresentedInMainPanel { overlayPanel?.orderFrontRegardless() }
        startFollowingCursor()
    }

    func updateStreamingText(_ accumulatedText: String) {
        // Hide complete and partial control tags while SSE is still arriving.
        let controlTags = #"\[(?:CANCEL_SUBSCRIPTION|SUBSCRIPTIONS|CREDIT|METRIC|SEARCH|SHOP|BASKET|NAVIGATE|POINT|INSIGHTS|SIMULATE)(?:[^\]]*\]|[^\]]*$)"#
        viewModel.streamingResponseText = accumulatedText.replacingOccurrences(
            of: controlTags, with: "", options: [.regularExpression, .caseInsensitive]
        )
        resizePanelToFitContent()
    }

    /// Marks the current round's text as fully streamed in.
    ///
    /// `isFinalRound` distinguishes a truly finished answer from a round that is
    /// part of an ongoing autonomous research session (see
    /// `CompanionManager.runFlickyQueryPipeline`). Only the final round schedules
    /// the auto-hide timer — while PeppaPrice is still iterating, the bubble should
    /// stay on screen and simply get replaced by the next round's text instead
    /// of disappearing and reappearing between rounds.
    func finishStreaming(isFinalRound: Bool = true) {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        shouldAutoHideAfterSpeaking = isFinalRound

        guard isFinalRound, !viewModel.isSpeaking else { return }

        scheduleAutoHide()
    }

    func beginSpeaking() {
        viewModel.isSpeaking = true
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        resizePanelToFitContent()
    }

    func finishSpeaking() {
        viewModel.isSpeaking = false
        resizePanelToFitContent()
        guard shouldAutoHideAfterSpeaking else { return }
        scheduleAutoHide()
    }

    func keepTranscriptVisibleAfterStop() {
        viewModel.isSpeaking = false
        resizePanelToFitContent()
        finishStreaming()
    }

    private func scheduleAutoHide() {
        autoHideWorkItem?.cancel()

        let hideWork = DispatchWorkItem { [weak self] in
            self?.fadeOutAndHide()
        }
        autoHideWorkItem = hideWork
        DispatchQueue.main.asyncAfter(deadline: .now() + 7, execute: hideWork)
    }

    func hideOverlay() {
        cursorTrackingTimer?.invalidate()
        cursorTrackingTimer = nil
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        shouldAutoHideAfterSpeaking = false
        viewModel.isSpeaking = false
        viewModel.isShowingResponse = false
        viewModel.streamingResponseText = ""
        overlayPanel?.orderOut(nil)
    }

    // MARK: - Private

    private func createOverlayPanelIfNeeded() {
        if overlayPanel != nil { return }

        let initialFrame = NSRect(x: 0, y: 0, width: overlayMaxWidth, height: 40)
        let panel = NSPanel(
            contentRect: initialFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        // Must accept mouse events (not click-through) so the stop button
        // rendered inside the bubble is actually clickable.
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isExcludedFromWindowsMenu = true

        let hostingView = NSHostingView(
            rootView: FlickyResponseOverlayView(viewModel: viewModel)
                .frame(maxWidth: overlayMaxWidth)
        )
        hostingView.frame = initialFrame
        panel.contentView = hostingView
        overlayPanel = panel
    }

    private func startFollowingCursor() {
        guard cursorTrackingTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated { [weak self] in
                guard let self else {
                    timer.invalidate()
                    return
                }
                guard let panel = self.overlayPanel, panel.isVisible else { return }
                // Hold still over the bubble so its Stop button remains clickable.
                guard !panel.frame.insetBy(dx: -16, dy: -16).contains(NSEvent.mouseLocation),
                      NSEvent.pressedMouseButtons == 0 else { return }
                self.repositionPanelNearCursor(smoothly: true)
            }
        }
        cursorTrackingTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func repositionPanelNearCursor(smoothly: Bool = false) {
        guard let panel = overlayPanel else { return }
        let mouse = NSEvent.mouseLocation
        let size = panel.frame.size

        var originX = mouse.x + cursorOffsetX
        var originY = mouse.y - cursorOffsetY - size.height

        if let screen = screenContainingPoint(mouse) {
            let vis = screen.visibleFrame
            if originX + size.width > vis.maxX { originX = mouse.x - cursorOffsetX - size.width }
            if originY < vis.minY { originY = mouse.y + cursorOffsetY }
            originX = max(vis.minX, min(originX, vis.maxX - size.width))
            originY = max(vis.minY, min(originY, vis.maxY - size.height))
        }
        var targetOrigin = CGPoint(x: originX, y: originY)
        // A short glide lets the pointer reach the controls without a chasing effect.
        // Cross-display moves snap directly to the new screen instead.
        if smoothly, screenContainingPoint(panel.frame.origin) == screenContainingPoint(mouse),
           !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let currentOrigin = panel.frame.origin
            targetOrigin.x = currentOrigin.x + (originX - currentOrigin.x) * 0.18
            targetOrigin.y = currentOrigin.y + (originY - currentOrigin.y) * 0.18
            if abs(targetOrigin.x - currentOrigin.x) < 0.5,
               abs(targetOrigin.y - currentOrigin.y) < 0.5 {
                targetOrigin = CGPoint(x: originX, y: originY)
            }
        }
        if panel.frame.origin != targetOrigin {
            panel.setFrameOrigin(targetOrigin)
        }
    }

    private func resizePanelToFitContent() {
        guard let panel = overlayPanel, let content = panel.contentView else { return }
        let fit = content.fittingSize
        let newWidth = min(fit.width, overlayMaxWidth)
        let newHeight = fit.height
        var frame = panel.frame
        let delta = newHeight - frame.height
        frame.size = CGSize(width: newWidth, height: newHeight)
        frame.origin.y -= delta
        panel.setFrame(frame, display: true)
        content.frame = NSRect(origin: .zero, size: frame.size)
    }

    private func fadeOutAndHide() {
        guard let panel = overlayPanel else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.4
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            Task { @MainActor in self?.hideOverlay() }
        })
    }

    private func screenContainingPoint(_ point: CGPoint) -> NSScreen? {
        NSScreen.screens.first { $0.frame.contains(point) }
    }
}

// MARK: - SwiftUI View

private struct FlickyResponseOverlayView: View {
    @ObservedObject var viewModel: CompanionResponseOverlayViewModel

    var body: some View {
        if viewModel.isShowingResponse {
            VStack(alignment: .leading, spacing: 0) {
                // Stop button — lets the user cut off PeppaPrice mid-answer or
                // mid-autonomous-research-loop, since until now there was no
                // way to interrupt it once it started talking.
                if viewModel.isSpeaking {
                    HStack {
                        Spacer()
                        Button(action: { viewModel.onStopButtonTapped?() }) {
                            HStack(spacing: 3) {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 7))
                                Text("Stop")
                                    .font(.system(size: 9, weight: .semibold))
                            }
                            .foregroundColor(DS.Colors.textTertiary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color.white.opacity(0.08)))
                        }
                        .buttonStyle(.plain)
                        .pointerCursor()
                        .accessibilityLabel("Stop speaking")
                        .accessibilityHint("Stops the audio and keeps the transcript visible")
                    }
                    .padding(.bottom, 6)
                }

                // Main response text
                Text(viewModel.streamingResponseText.isEmpty ? "…" : viewModel.streamingResponseText)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(DS.Colors.textPrimary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 310, alignment: .leading)


            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DS.Colors.surface1.opacity(0.96))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(DS.Colors.borderSubtle.opacity(0.5), lineWidth: 0.8)
                    )
                    .shadow(color: Color.black.opacity(0.4), radius: 18, x: 0, y: 8)
            )
        }
    }
}
