import AppKit
import AVFoundation
import Combine
import ScreenCaptureKit
import SwiftUI
import Vision

enum CappyVoiceState { case idle, listening, processing, responding }

/// The only native capture path. It is dormant until an authenticated user
/// explicitly enables monitoring and all required local permissions exist.
@MainActor
final class CappyManager: ObservableObject {
    @Published private(set) var voiceState: CappyVoiceState = .idle
    @Published private(set) var lastTranscript: String?
    @Published private(set) var currentAudioPowerLevel: CGFloat = 0
    @Published private(set) var hasAccessibilityPermission = false
    @Published private(set) var hasScreenRecordingPermission = false
    @Published private(set) var hasMicrophonePermission = false
    @Published private(set) var hasScreenContentPermission = false
    @Published private(set) var isMonitoringEnabled = false
    @Published private(set) var errorMessage: String?

    let authSessionStore = CappyAuthSessionStore()
    let dictationManager = CappyDictationManager()
    let globalPushToTalkShortcutMonitor = GlobalPushToTalkShortcutMonitor()
    let responseOverlay = CappyResponseOverlayManager()
    private let financeCoordinator: CappyFinanceCoordinator
    private var responseTask: Task<Void, Never>?
    private var shortcutCancellable: AnyCancellable?
    private var audioCancellable: AnyCancellable?
    private var permissionTimer: Timer?

    init(financeService: CappyFinanceServicing = CappyFinanceAgentClient()) {
        financeCoordinator = CappyFinanceCoordinator(service: financeService)
        authSessionStore.onSessionInvalidated = { [weak self] in self?.clearAccountState() }
    }

    var allPermissionsGranted: Bool {
        hasAccessibilityPermission && hasScreenRecordingPermission && hasMicrophonePermission && hasScreenContentPermission
    }

    func start() {
        refreshPermissions()
        audioCancellable = dictationManager.$currentAudioPowerLevel.assign(to: \.currentAudioPowerLevel, on: self)
        shortcutCancellable = globalPushToTalkShortcutMonitor.shortcutTransitionPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleShortcutTransition($0) }
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshPermissions() }
        }
    }

    func stop() {
        setMonitoringEnabled(false)
        permissionTimer?.invalidate()
        permissionTimer = nil
        audioCancellable?.cancel()
        shortcutCancellable?.cancel()
    }

    func activate(session: CappyAuthenticatedSession, profile: CappyProfile) {
        authSessionStore.activate(session: session, profile: profile)
        financeCoordinator.beginSession(accountID: session.accountID)
        if profile.monitoringEnabled { setMonitoringEnabled(true) }
    }

    func logout() { authSessionStore.logout() }

    func setMonitoringEnabled(_ enabled: Bool) {
        let mayMonitor = enabled && authSessionStore.isAuthenticated && allPermissionsGranted
        isMonitoringEnabled = mayMonitor
        if mayMonitor { globalPushToTalkShortcutMonitor.start() }
        else { stopCaptureImmediately() }
        if enabled && !mayMonitor {
            errorMessage = authSessionStore.isAuthenticated
                ? "Cappy needs accessibility, screen recording, microphone, and screen content permission before monitoring can start."
                : "Sign in to a Cappy account before enabling monitoring."
        }
    }

    func refreshPermissions() {
        hasAccessibilityPermission = WindowPositionManager.hasAccessibilityPermission()
        hasScreenRecordingPermission = WindowPositionManager.hasScreenRecordingPermission()
        hasMicrophonePermission = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        if !allPermissionsGranted && isMonitoringEnabled { setMonitoringEnabled(false) }
    }

    func requestScreenContentPermission() {
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first else { return }
                let image = try await SCScreenshotManager.captureImage(
                    contentFilter: SCContentFilter(display: display, excludingWindows: []),
                    configuration: SCStreamConfiguration()
                )
                hasScreenContentPermission = image.width > 0 && image.height > 0
                refreshPermissions()
            } catch { errorMessage = "Cappy could not confirm screen content permission." }
        }
    }

    private func handleShortcutTransition(_ transition: CappyPushToTalkShortcut.ShortcutTransition) {
        guard isMonitoringEnabled else { return }
        switch transition {
        case .pressed:
            guard !dictationManager.isDictationInProgress else { return }
            responseTask?.cancel()
            responseOverlay.hideOverlay()
            Task {
                await dictationManager.startPushToTalkFromKeyboardShortcut(
                    currentDraftText: "",
                    updateDraftText: { _ in },
                    submitDraftText: { [weak self] transcript in self?.submit(transcript: transcript) }
                )
            }
        case .released: dictationManager.stopPushToTalkFromKeyboardShortcut()
        case .none: break
        }
    }

    private func submit(transcript: String) {
        lastTranscript = transcript
        responseTask?.cancel()
        responseTask = Task { [weak self] in
            guard let self else { return }
            voiceState = .processing
            do {
                let captures = try await CappyScreenCaptureUtility.captureAllScreensAsJPEG()
                guard !Task.isCancelled else { return }
                let ocrText = await CappyLocalOCR.recognizeText(in: captures)
                guard let answer = await financeCoordinator.answer(for: transcript, ocrText: ocrText) else {
                    if !Task.isCancelled { errorMessage = "Cappy could not verify a forecast for this account." }
                    voiceState = .idle
                    return
                }
                guard !Task.isCancelled else { return }
                responseOverlay.show(card: answer.card)
                voiceState = .responding
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = "Cappy could not capture this financial question."
                voiceState = .idle
            }
        }
    }

    private func stopCaptureImmediately() {
        responseTask?.cancel()
        responseTask = nil
        dictationManager.cancelCurrentDictation()
        globalPushToTalkShortcutMonitor.stop()
        responseOverlay.hideOverlay()
        voiceState = .idle
    }

    private func clearAccountState() {
        stopCaptureImmediately()
        financeCoordinator.endSession()
        lastTranscript = nil
        errorMessage = nil
    }
}

enum CappyLocalOCR {
    static func recognizeText(in captures: [CappyScreenCapture]) async -> String {
        captures.map { recognizeText(in: $0.imageData) }.joined(separator: "\n")
    }

    private static func recognizeText(in data: Data) -> String {
        guard let image = NSImage(data: data), let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: cgImage).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
}
