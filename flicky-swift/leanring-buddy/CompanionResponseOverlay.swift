// CompanionResponseOverlay.swift — Flicky cursor-following response overlay
//
// Displays streaming AI response text + financial proof data next to the cursor.
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
    @Published var financialBadge: FinancialBadgeData? = nil

    // Set by CompanionResponseOverlayManager so the stop button rendered inside
    // FlickyResponseOverlayView can reach back out to CompanionManager without
    // the view itself needing a reference to it.
    var onStopButtonTapped: (() -> Void)?
}

struct FinancialBadgeData {
    let balanceText: String
    let safeToSpendText: String
    let safeToSpendColor: Color
}

// MARK: - Overlay Manager

@MainActor
final class CompanionResponseOverlayManager {
    private let viewModel = CompanionResponseOverlayViewModel()
    private var overlayPanel: NSPanel?
    private var autoHideWorkItem: DispatchWorkItem?
    private var shouldAutoHideAfterSpeaking = false

    private let cursorOffsetX: CGFloat = 22
    private let cursorOffsetY: CGFloat = 6
    private let overlayMaxWidth: CGFloat = 360

    /// Exposes the stop-button tap to whoever owns this manager (CompanionManager),
    /// without the SwiftUI view needing a direct reference back to it.
    var onStopButtonTapped: (() -> Void)? {
        get { viewModel.onStopButtonTapped }
        set { viewModel.onStopButtonTapped = newValue }
    }

    /// Begins a brand-new autonomous question/session. Positions the bubble once
    /// near the cursor's current location and then holds that position for every
    /// round of the session, including any autonomous follow-up rounds Flicky
    /// runs on its own without the user pressing push-to-talk again.
    ///
    /// Previously this repositioned the panel every frame to continuously chase
    /// the live mouse position (via a 60Hz timer), even while the user was just
    /// reading the response. If the user moved their mouse at all after asking
    /// a question, the bubble would visibly teleport around the screen following
    /// it — which read as the UI "crashing and going to different places."
    ///
    /// Later, `beginNextAutonomousRound()` was introduced for the multi-round
    /// research loop, but the loop was calling this method again at the top of
    /// every round — which repositions near wherever the mouse happens to be at
    /// that moment. Since rounds are seconds apart (TTS playback time) and the
    /// user's mouse naturally drifts in between, the bubble still visibly jumped
    /// around over the course of one autonomous session. Repositioning only here,
    /// once per whole session, fixes that for good.
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
        overlayPanel?.orderFrontRegardless()
    }

    /// Begins the next round of an already-visible autonomous session: clears
    /// the streamed text so the next round's answer types in fresh, but
    /// deliberately does NOT move the panel — it stays exactly where
    /// `beginNewAutonomousSession()` first placed it.
    func beginNextAutonomousRound() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        shouldAutoHideAfterSpeaking = false
        viewModel.isSpeaking = false
        viewModel.streamingResponseText = ""
        viewModel.isShowingResponse = true
        createOverlayPanelIfNeeded()
        overlayPanel?.alphaValue = 1
        overlayPanel?.orderFrontRegardless()
    }

    func updateStreamingText(_ accumulatedText: String) {
        viewModel.streamingResponseText = accumulatedText
        resizePanelToFitContent()
    }

    func updateFinancialBadge(_ insights: FinancialInsights?) {
        guard let insights else {
            viewModel.financialBadge = nil
            return
        }
        let safeColor: Color = insights.safeToSpendCents < 5000
            ? Color(red: 1, green: 0.35, blue: 0.35)
            : insights.safeToSpendCents < 20000
                ? Color.orange
                : Color.green
        viewModel.financialBadge = FinancialBadgeData(
            balanceText: insights.formattedBalance,
            safeToSpendText: insights.formattedSafeToSpend,
            safeToSpendColor: safeColor
        )
    }

    /// Marks the current round's text as fully streamed in.
    ///
    /// `isFinalRound` distinguishes a truly finished answer from a round that is
    /// part of an ongoing autonomous research session (see
    /// `CompanionManager.runFlickyQueryPipeline`). Only the final round schedules
    /// the auto-hide timer — while Flicky is still iterating, the bubble should
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

    private func repositionPanelNearCursor() {
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
        panel.setFrameOrigin(CGPoint(x: originX, y: originY))
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
                // Stop button — lets the user cut off Flicky mid-answer or
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

                // Financial badge (balance + safe to spend)
                if let badge = viewModel.financialBadge {
                    Divider()
                        .background(DS.Colors.borderSubtle.opacity(0.5))
                        .padding(.top, 8)
                        .padding(.bottom, 6)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Balance")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(DS.Colors.textTertiary)
                            Text(badge.balanceText)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(DS.Colors.textPrimary)
                        }

                        Rectangle()
                            .fill(DS.Colors.borderSubtle)
                            .frame(width: 0.5)
                            .frame(height: 24)

                        VStack(alignment: .leading, spacing: 1) {
                            Text("Safe to Spend")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(DS.Colors.textTertiary)
                            Text(badge.safeToSpendText)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(badge.safeToSpendColor)
                        }
                    }
                }
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
