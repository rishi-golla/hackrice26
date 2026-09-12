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
    @Published var financialBadge: FinancialBadgeData? = nil
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
    private var cursorTrackingTimer: Timer?
    private var autoHideWorkItem: DispatchWorkItem?

    private let cursorOffsetX: CGFloat = 22
    private let cursorOffsetY: CGFloat = 6
    private let overlayMaxWidth: CGFloat = 360

    func showOverlayAndBeginStreaming() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        viewModel.streamingResponseText = ""
        viewModel.isShowingResponse = true
        createOverlayPanelIfNeeded()
        startCursorTracking()
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

    func finishStreaming() {
        let hideWork = DispatchWorkItem { [weak self] in
            self?.fadeOutAndHide()
        }
        autoHideWorkItem = hideWork
        DispatchQueue.main.asyncAfter(deadline: .now() + 7, execute: hideWork)
    }

    func hideOverlay() {
        autoHideWorkItem?.cancel()
        autoHideWorkItem = nil
        stopCursorTracking()
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
        panel.ignoresMouseEvents = true
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

    private func startCursorTracking() {
        cursorTrackingTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.repositionPanelNearCursor() }
        }
    }

    private func stopCursorTracking() {
        cursorTrackingTimer?.invalidate()
        cursorTrackingTimer = nil
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
