// CompanionManager.swift — Flicky Financial Advisor Core Manager
//
// Central state machine for the Flicky voice + financial pipeline.
// Owns: dictation, shortcut monitoring, screen capture, Nessie API,
// Claude API, ElevenLabs TTS, product search, browser navigation.
//
// Voice flow:
//   Ctrl+Option (hold) → record → release → transcribe →
//   screenshot + Nessie data → Claude → stream overlay →
//   parse [SEARCH:] / [NAVIGATE:] → ElevenLabs TTS speak

import AVFoundation
import Combine
import Foundation
import ScreenCaptureKit
import SwiftUI

@MainActor
final class CompanionManager: ObservableObject {

    // MARK: - Voice State

    @Published private(set) var voiceState: FlickyVoiceState = .idle
    @Published private(set) var lastTranscript: String?
    @Published private(set) var currentAudioPowerLevel: CGFloat = 0

    // MARK: - Permission State

    @Published private(set) var hasAccessibilityPermission = false
    @Published private(set) var hasScreenRecordingPermission = false
    @Published private(set) var hasMicrophonePermission = false
    @Published private(set) var hasScreenContentPermission = false

    var allPermissionsGranted: Bool {
        hasAccessibilityPermission && hasScreenRecordingPermission
            && hasMicrophonePermission && hasScreenContentPermission
    }

    // MARK: - Financial State

    @Published private(set) var financialInsights: FinancialInsights?
    @Published private(set) var financialLoadError: String?
    @Published private(set) var isLoadingFinancials = false

    // MARK: - Product Search & Navigation State

    @Published private(set) var productSearchResults: ProductSearchResponse?
    @Published private(set) var lastNavigatedURL: String?
    @Published private(set) var lastNavigationReason: String?

    // Every listing found across all autonomous research rounds for the current
    // question, deduplicated by URL. This is what the right-side suggestions
    // drawer displays — it grows as Flicky keeps searching/refining, instead of
    // only ever showing the most recent search's results.
    @Published private(set) var accumulatedSuggestedListings: [ProductSearchResult] = []

    // Which listing URLs Flicky has already opened as a browser tab for the
    // current question. Lets the shopping flow present listings one at a time
    // in the early rounds ("here's one — good, or next?") without ever
    // re-opening a tab the user has already seen, then do one broad sweep in
    // the final round. Reset alongside `accumulatedSuggestedListings` at the
    // start of every new question.
    private var openedListingURLsForCurrentQuestion: Set<String> = []

    // MARK: - Login State

    @Published private(set) var isLoggedIn: Bool = false
    @Published private(set) var loginState: FlickyLoginState? = nil
    @Published var loginError: String? = nil

    var hasCompletedOnboarding: Bool {
        get { UserDefaults.standard.bool(forKey: "flicky_hasCompletedOnboarding") }
        set { UserDefaults.standard.set(newValue, forKey: "flicky_hasCompletedOnboarding") }
    }

    @Published var hasSubmittedEmail: Bool = UserDefaults.standard.bool(forKey: "flicky_hasSubmittedEmail")

    func submitEmail(_ email: String) {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        hasSubmittedEmail = true
        UserDefaults.standard.set(true, forKey: "flicky_hasSubmittedEmail")
    }

    // MARK: - Overlay State

    @Published private(set) var isOverlayVisible: Bool = false
    @Published var detectedElementScreenLocation: CGPoint?
    @Published var detectedElementDisplayFrame: CGRect?
    @Published var detectedElementBubbleText: String?

    // These are referenced by OverlayWindow (kept from Clicky for compatibility)
    @Published var onboardingVideoPlayer: AVPlayer?
    @Published var showOnboardingVideo: Bool = false
    @Published var onboardingVideoOpacity: Double = 0.0
    @Published var onboardingPromptText: String = ""
    @Published var onboardingPromptOpacity: Double = 0.0
    @Published var showOnboardingPrompt: Bool = false

    // MARK: - Model Selection

    @Published var selectedModel: String = UserDefaults.standard.string(forKey: "selectedClaudeModel") ?? "claude-sonnet-4-6"

    func setSelectedModel(_ model: String) {
        selectedModel = model
        UserDefaults.standard.set(model, forKey: "selectedClaudeModel")
        claudeAPI.model = model
    }

    @Published var isClickyCursorEnabled: Bool = UserDefaults.standard.object(forKey: "isClickyCursorEnabled") == nil
        ? true
        : UserDefaults.standard.bool(forKey: "isClickyCursorEnabled")

    func setClickyCursorEnabled(_ enabled: Bool) {
        isClickyCursorEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "isClickyCursorEnabled")
        if enabled {
            overlayWindowManager.hasShownOverlayBefore = true
            overlayWindowManager.showOverlay(onScreens: NSScreen.screens, companionManager: self)
            isOverlayVisible = true
        } else {
            overlayWindowManager.hideOverlay()
            isOverlayVisible = false
        }
    }

    // MARK: - Sub-managers (from Clicky: push-to-talk + screen capture + overlay)

    let buddyDictationManager = BuddyDictationManager()
    let globalPushToTalkShortcutMonitor = GlobalPushToTalkShortcutMonitor()
    let overlayWindowManager = OverlayWindowManager()
    let responseOverlayManager = CompanionResponseOverlayManager()
    let suggestionsDrawerManager = SuggestionsDrawerManager()

    // Declared `lazy var` (instead of a plain `let`, like the sub-managers
    // above) because it needs to capture `self` in its initializer — mirrors
    // how `MenuBarPanelManager` is built externally with a `companionManager`
    // reference in `leanring_buddyApp.swift`, just done in-place here instead.
    lazy var insightsDashboardManager: FinancialInsightsDashboardManager = FinancialInsightsDashboardManager(companionManager: self)

    // MARK: - API Clients

    private static var workerBaseURL: String {
        AppBundleConfiguration.stringValue(forKey: "FLICKY_WORKER_URL")
            ?? "https://your-worker.workers.dev"
    }

    private lazy var claudeAPI: ClaudeAPI = {
        ClaudeAPI(proxyURL: "\(Self.workerBaseURL)/chat", model: selectedModel)
    }()

    /// Separate, dedicated Claude client pinned to a cheap/fast model
    /// (Haiku), used only for short fact-check verification of real listing
    /// pages (see `verifyListingAgainstRealPageContent`). Deliberately NOT
    /// the same instance as `claudeAPI` above — that instance's `model`
    /// tracks the user's Sonnet/Opus picker in the menu bar panel, and
    /// mutating it here would race with concurrent autonomous research
    /// rounds that are simultaneously using the main model.
    private lazy var pageVerificationClaudeAPI: ClaudeAPI = {
        ClaudeAPI(proxyURL: "\(Self.workerBaseURL)/chat", model: "claude-haiku-4-6")
    }()

    private lazy var elevenLabsTTSClient: ElevenLabsTTSClient = {
        ElevenLabsTTSClient(proxyURL: "\(Self.workerBaseURL)/tts")
    }()

    private var nessieClient: NessieAPIClient? {
        guard let key = AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_API_KEY"),
              !key.isEmpty else { return nil }
        let baseURL = AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_BASE_URL")
            ?? "https://prod-api.nessieisreal.com"
        let amountUnit = AppBundleConfiguration.stringValue(forKey: "FLICKY_NESSIE_AMOUNT_UNIT")
            ?? "dollars"
        return NessieAPIClient(apiKey: key, baseURL: baseURL, amountUnit: amountUnit)
    }

    // Conversation history so Claude remembers prior exchanges within a session
    private var conversationHistory: [(userTranscript: String, assistantResponse: String)] = []
    private let maxConversationHistoryCount = 8

    // Autonomous research: after one voice question, Flicky can keep searching,
    // comparing, and speaking on its own — without the user holding push-to-talk
    // again — for up to this many rounds before it must give a final answer.
    // Bounded so a single question can't loop forever or run away API costs.
    private let maxAutonomousIterationRounds = 4

    // MARK: - Task Tracking

    private var currentResponseTask: Task<Void, Never>?
    private var shortcutTransitionCancellable: AnyCancellable?
    private var voiceStateCancellable: AnyCancellable?
    private var audioPowerCancellable: AnyCancellable?
    private var accessibilityCheckTimer: Timer?
    private var pendingKeyboardShortcutStartTask: Task<Void, Never>?

    // MARK: - Lifecycle

    func start() {
        refreshAllPermissions()
        startPermissionPolling()
        bindVoiceStateObservation()
        bindAudioPowerLevel()
        bindShortcutTransitions()
        _ = claudeAPI // TLS warmup

        responseOverlayManager.onStopButtonTapped = { [weak self] in
            self?.stopCurrentResponse()
        }

        restoreLoginState()

        if hasCompletedOnboarding && allPermissionsGranted && isClickyCursorEnabled && isLoggedIn {
            overlayWindowManager.hasShownOverlayBefore = true
            overlayWindowManager.showOverlay(onScreens: NSScreen.screens, companionManager: self)
            isOverlayVisible = true
        }
    }

    func stop() {
        globalPushToTalkShortcutMonitor.stop()
        buddyDictationManager.cancelCurrentDictation()
        overlayWindowManager.hideOverlay()
        currentResponseTask?.cancel()
        currentResponseTask = nil
        shortcutTransitionCancellable?.cancel()
        voiceStateCancellable?.cancel()
        audioPowerCancellable?.cancel()
        accessibilityCheckTimer?.invalidate()
        accessibilityCheckTimer = nil
    }

    // MARK: - Login

    func performLogin(customerId: String, displayEmail: String) async {
        loginError = nil

        guard let client = nessieClient else {
            // Demo mode — no Nessie key in Info.plist, use mock data
            let mockState = FlickyLoginState(
                accountId: "demo-checking",
                customerId: customerId.isEmpty ? "demo-customer" : customerId,
                displayEmail: displayEmail.isEmpty ? "demo@capitalone.com" : displayEmail,
                maskedCardNumber: "•••• •••• •••• 4321"
            )
            loginState = mockState
            isLoggedIn = true
            hasCompletedOnboarding = true
            UserDefaults.standard.set(mockState.customerId, forKey: "flicky_customerId")
            UserDefaults.standard.set(displayEmail, forKey: "flicky_email")
            showOverlayAfterLogin()
            await refreshFinancialData()
            return
        }

        // Real Nessie login
        let accounts = await client.listCustomerAccounts(customerId: customerId)
        guard let firstAccount = accounts.first,
              let accountId = firstAccount["_id"] as? String else {
            loginError = "No accounts found. Check your Nessie customer ID."
            return
        }

        let accountNumber = firstAccount["account_number"] as? String ?? ""
        let last4 = String(accountNumber.suffix(4)).isEmpty ? "0000" : String(accountNumber.suffix(4))

        let state = FlickyLoginState(
            accountId: accountId,
            customerId: customerId,
            displayEmail: displayEmail,
            maskedCardNumber: "•••• •••• •••• \(last4)"
        )
        loginState = state
        isLoggedIn = true
        hasCompletedOnboarding = true
        UserDefaults.standard.set(customerId, forKey: "flicky_customerId")
        UserDefaults.standard.set(accountId, forKey: "flicky_accountId")
        UserDefaults.standard.set(displayEmail, forKey: "flicky_email")
        showOverlayAfterLogin()
        await refreshFinancialData()
    }

    private func showOverlayAfterLogin() {
        guard allPermissionsGranted && isClickyCursorEnabled else { return }
        overlayWindowManager.hasShownOverlayBefore = true
        overlayWindowManager.showOverlay(onScreens: NSScreen.screens, companionManager: self)
        isOverlayVisible = true
    }

    private func restoreLoginState() {
        guard let savedCustomerId = UserDefaults.standard.string(forKey: "flicky_customerId"),
              !savedCustomerId.isEmpty else { return }

        let savedAccountId = UserDefaults.standard.string(forKey: "flicky_accountId") ?? "demo-checking"
        let savedEmail = UserDefaults.standard.string(forKey: "flicky_email") ?? "user@capitalone.com"

        loginState = FlickyLoginState(
            accountId: savedAccountId,
            customerId: savedCustomerId,
            displayEmail: savedEmail,
            maskedCardNumber: "•••• •••• •••• ••••"
        )
        isLoggedIn = true
        Task { await refreshFinancialData() }
    }

    func logout() {
        loginState = nil
        isLoggedIn = false
        financialInsights = nil
        hasCompletedOnboarding = false
        conversationHistory = []
        UserDefaults.standard.removeObject(forKey: "flicky_customerId")
        UserDefaults.standard.removeObject(forKey: "flicky_accountId")
        UserDefaults.standard.removeObject(forKey: "flicky_email")
        UserDefaults.standard.removeObject(forKey: "flicky_hasCompletedOnboarding")
        overlayWindowManager.hideOverlay()
        isOverlayVisible = false
    }

    // MARK: - Financial Data

    func refreshFinancialData() async {
        guard let state = loginState else {
            financialInsights = buildMockFinancialInsights()
            return
        }

        isLoadingFinancials = true

        let nessieAccountId = (state.accountId == "demo-checking") ? nil : state.accountId
        let insights = await nessieClient?.fetchFinancialInsights(
            customerId: state.customerId,
            nessieAccountId: nessieAccountId,
            reserveCents: 50_000
        )

        isLoadingFinancials = false
        if let insights = insights {
            financialInsights = insights
            financialLoadError = nil
        } else {
            financialLoadError = "Could not load Nessie data."
            if financialInsights == nil {
                financialInsights = buildMockFinancialInsights()
            }
        }
    }

    private func getOrRefreshFinancialInsights() async -> FinancialInsights? {
        if let existing = financialInsights, !existing.isStale { return existing }
        await refreshFinancialData()
        return financialInsights
    }

    // MARK: - Onboarding compatibility hooks

    func triggerOnboarding() {
        NotificationCenter.default.post(name: .clickyDismissPanel, object: nil)
        hasCompletedOnboarding = true
        showOverlayAfterLogin()
    }

    func replayOnboarding() {
        NotificationCenter.default.post(name: .clickyDismissPanel, object: nil)
        overlayWindowManager.hasShownOverlayBefore = false
        overlayWindowManager.showOverlay(onScreens: NSScreen.screens, companionManager: self)
        isOverlayVisible = true
    }

    func clearDetectedElementLocation() {
        detectedElementScreenLocation = nil
        detectedElementDisplayFrame = nil
        detectedElementBubbleText = nil
    }

    // MARK: - Permissions

    func refreshAllPermissions() {
        hasAccessibilityPermission = WindowPositionManager.hasAccessibilityPermission()
        if hasAccessibilityPermission {
            globalPushToTalkShortcutMonitor.start()
        } else {
            globalPushToTalkShortcutMonitor.stop()
        }

        hasScreenRecordingPermission = WindowPositionManager.hasScreenRecordingPermission()

        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        hasMicrophonePermission = micStatus == .authorized

        if !hasScreenContentPermission {
            hasScreenContentPermission = UserDefaults.standard.bool(forKey: "hasScreenContentPermission")
        }
    }

    func requestScreenContentPermission() {
        Task {
            do {
                _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                hasScreenContentPermission = true
                UserDefaults.standard.set(true, forKey: "hasScreenContentPermission")
            } catch {
                print("⚠️ Flicky: Screen content permission: \(error)")
            }
        }
    }

    private func startPermissionPolling() {
        accessibilityCheckTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshAllPermissions() }
        }
    }

    // MARK: - Combine Bindings

    private func bindVoiceStateObservation() {
        voiceStateCancellable = buddyDictationManager.$isRecordingFromKeyboardShortcut
            .receive(on: RunLoop.main)
            .sink { [weak self] isRecording in
                guard let self else { return }
                if isRecording { self.voiceState = .listening }
            }
    }

    private func bindAudioPowerLevel() {
        audioPowerCancellable = buddyDictationManager.$currentAudioPowerLevel
            .receive(on: RunLoop.main)
            .sink { [weak self] level in self?.currentAudioPowerLevel = level }
    }

    private func bindShortcutTransitions() {
        shortcutTransitionCancellable = globalPushToTalkShortcutMonitor.shortcutTransitionPublisher
            .receive(on: RunLoop.main)
            .sink { [weak self] transition in
                guard let self else { return }
                switch transition {
                case .pressed:  self.handleShortcutPressed()
                case .released: self.handleShortcutReleased()
                case .none: break
                }
            }
    }

    // MARK: - Push-to-Talk

    private func handleShortcutPressed() {
        guard allPermissionsGranted else { return }

        // Cancel any in-flight response
        currentResponseTask?.cancel()
        currentResponseTask = nil
        responseOverlayManager.hideOverlay()
        elevenLabsTTSClient.stopPlayback()

        pendingKeyboardShortcutStartTask?.cancel()
        pendingKeyboardShortcutStartTask = Task {
            await buddyDictationManager.startPushToTalkFromKeyboardShortcut(
                currentDraftText: "",
                updateDraftText: { _ in },
                submitDraftText: { [weak self] transcript in
                    Task { @MainActor [weak self] in
                        self?.handleVoiceQuerySubmitted(transcript: transcript)
                    }
                }
            )
        }

        if !isOverlayVisible {
            overlayWindowManager.hasShownOverlayBefore = true
            overlayWindowManager.showOverlay(onScreens: NSScreen.screens, companionManager: self)
            isOverlayVisible = true
        }
        voiceState = .listening
    }

    private func handleShortcutReleased() {
        buddyDictationManager.stopPushToTalkFromKeyboardShortcut()
        pendingKeyboardShortcutStartTask?.cancel()
        pendingKeyboardShortcutStartTask = nil
    }

    /// Immediately interrupts Flicky mid-answer or mid-autonomous-research-loop:
    /// cancels the in-flight pipeline task, stops any TTS audio that's already
    /// playing, and hides the response bubble. Wired to the overlay's stop
    /// button (see `start()`) and available as a redundant control inside the
    /// menu bar panel for when the overlay isn't visible or easy to reach.
    func stopCurrentResponse() {
        currentResponseTask?.cancel()
        currentResponseTask = nil
        elevenLabsTTSClient.stopPlayback()
        responseOverlayManager.keepTranscriptVisibleAfterStop()
        voiceState = .idle
    }

    // MARK: - Voice Query Pipeline

    private func handleVoiceQuerySubmitted(transcript: String) {
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        lastTranscript = transcript
        voiceState = .processing
        currentResponseTask = Task { await runFlickyQueryPipeline(userTranscript: transcript) }
    }

    /// Runs the full voice pipeline for one user question, then keeps Flicky
    /// autonomously iterating — searching, refining, and speaking again — for up
    /// to `maxAutonomousIterationRounds` rounds, without requiring the user to
    /// press the push-to-talk shortcut again. Each round only continues to the
    /// next if Claude's response actually triggered a [SEARCH:], meaning it's
    /// still actively researching; the moment Claude gives an answer without
    /// searching again, that's treated as its final recommendation and the loop
    /// stops. Pressing the shortcut again mid-loop cancels `currentResponseTask`
    /// (see `handleShortcutPressed`), which this loop checks for on every await.
    private func runFlickyQueryPipeline(userTranscript: String) async {
        guard !Task.isCancelled else { return }

        // Starting a brand new question — clear out the previous question's
        // accumulated listings so the suggestions drawer doesn't mix results
        // from unrelated searches together.
        accumulatedSuggestedListings = []
        openedListingURLsForCurrentQuestion = []
        suggestionsDrawerManager.hide()

        let screenshotImages = await captureScreenshots()
        guard !Task.isCancelled else { return }

        let insights = await getOrRefreshFinancialInsights()
        let financialContext = insights?.toSystemPromptContext()
            ?? "No financial data available. Nessie API not configured or unreachable."
        guard !Task.isCancelled else { return }

        let systemPrompt = buildFlickySystemPrompt(financialContext: financialContext)

        voiceState = .responding

        var nextPromptToSend = userTranscript

        for roundIndex in 0..<maxAutonomousIterationRounds {
            guard !Task.isCancelled else { return }

            // Only the very first round repositions the bubble near the
            // cursor. Every later round in this autonomous session reuses
            // that same spot instead of jumping to wherever the mouse has
            // since drifted — see `beginNextAutonomousRound()` doc comment.
            if roundIndex == 0 {
                responseOverlayManager.beginNewAutonomousSession()
            } else {
                responseOverlayManager.beginNextAutonomousRound()
            }

            var fullResponse = ""
            do {
                let result = try await claudeAPI.analyzeImageStreaming(
                    // Only the first round needs a fresh screenshot of the user's
                    // screen — later rounds are Flicky continuing to research on
                    // its own, so there's nothing new on-screen to look at.
                    images: roundIndex == 0 ? screenshotImages : [],
                    systemPrompt: systemPrompt,
                    conversationHistory: conversationHistory.suffix(maxConversationHistoryCount).map {
                        (userPlaceholder: $0.userTranscript, assistantResponse: $0.assistantResponse)
                    },
                    userPrompt: nextPromptToSend,
                    onTextChunk: { [weak self] accumulated in
                        self?.responseOverlayManager.updateStreamingText(accumulated)
                    }
                )
                fullResponse = result.text
            } catch {
                guard !Task.isCancelled else { return }
                let errMsg = "Sorry, I couldn't process that. \(error.localizedDescription)"
                responseOverlayManager.updateStreamingText(errMsg)
                responseOverlayManager.finishStreaming()
                voiceState = .idle
                return
            }

            guard !Task.isCancelled else { return }

            let (cleanedResponse, didTriggerSearchThisRound) = await handleResponseMarkers(fullResponse: fullResponse, roundIndex: roundIndex)

            conversationHistory.append((userTranscript: nextPromptToSend, assistantResponse: cleanedResponse))
            if conversationHistory.count > maxConversationHistoryCount {
                conversationHistory.removeFirst(conversationHistory.count - maxConversationHistoryCount)
            }

            let isLastAllowedRound = roundIndex == maxAutonomousIterationRounds - 1
            let shouldKeepIterating = didTriggerSearchThisRound && !isLastAllowedRound

            responseOverlayManager.updateStreamingText(cleanedResponse)
            responseOverlayManager.finishStreaming(isFinalRound: !shouldKeepIterating)

            guard !Task.isCancelled else { return }

            let spokenText = extractSpokenText(from: cleanedResponse)
            if !spokenText.isEmpty {
                responseOverlayManager.beginSpeaking()
                do {
                    try await elevenLabsTTSClient.speakText(spokenText) { [weak self] in
                        self?.responseOverlayManager.finishSpeaking()
                    }
                } catch {
                    responseOverlayManager.finishSpeaking()
                    if !Task.isCancelled { print("⚠️ TTS: \(error.localizedDescription)") }
                }
            }

            guard !Task.isCancelled else { return }

            if !shouldKeepIterating { break }

            // Prompt Claude to keep going on its own — comparing further, trying a
            // different search angle, or settling on a final pick — instead of
            // waiting for the user to ask again.
            nextPromptToSend = """
            Keep researching on your own — the user hasn't asked anything new. \
            Based on what you just found, either [SEARCH:] again with a more \
            specific or different query to find something better (a cheaper \
            condition, a different retailer, a better spec match), or if you're \
            confident you've found the best option, give your final \
            recommendation now without a [SEARCH:] tag.
            """
        }

        guard !Task.isCancelled else { return }
        voiceState = .idle
    }

    // MARK: - Response Marker Parsing

    /// Parses embedded action tags out of Claude's response and performs their
    /// side effects (pointing the cursor, searching for products, navigating the
    /// browser, opening the insights dashboard). Returns the cleaned
    /// display/speech text plus whether a [SEARCH:] tag was present this round
    /// — the caller uses that to decide whether Flicky should keep
    /// autonomously iterating.
    ///
    /// `roundIndex` drives the shopping choreography the user asked for: a
    /// conversational, one-listing-at-a-time experience ("here's one — good,
    /// or want me to check another?") for the first two rounds, then a wider
    /// sweep ("I searched everywhere, here's everything") once Flicky has
    /// already shown the user a couple of options.
    private func handleResponseMarkers(fullResponse: String, roundIndex: Int) async -> (cleanedText: String, didTriggerSearch: Bool) {
        var text = fullResponse
        var didTriggerSearch = false

        // [POINT:x,y:label] or [POINT:x,y:label:screenN]
        let pointPattern = #"\[POINT:\s*(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+)(?::[^\]]*)?\]"#
        if let regex = try? NSRegularExpression(pattern: pointPattern, options: .caseInsensitive) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: nsRange) {
                let xStr = (text as NSString).substring(with: match.range(at: 1))
                let yStr = (text as NSString).substring(with: match.range(at: 2))
                let label = match.range(at: 3).location != NSNotFound
                    ? (text as NSString).substring(with: match.range(at: 3)) : "element"
                if let xPct = Double(xStr), let yPct = Double(yStr) {
                    await handleElementPointing(xPercent: xPct, yPercent: yPct, label: label)
                }
                text = regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
            }
        }

        // [INSIGHTS] — Flicky proactively surfaces the financial insights
        // dashboard when it thinks the user would benefit from seeing the
        // full picture (spending trends, bill breakdown, rewards value)
        // rather than just hearing one number spoken aloud.
        let insightsPattern = #"\[INSIGHTS\]"#
        if let regex = try? NSRegularExpression(pattern: insightsPattern, options: .caseInsensitive) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if regex.firstMatch(in: text, range: nsRange) != nil {
                text = regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
                insightsDashboardManager.show()
            }
        }

        // [SEARCH: query]
        let searchPattern = #"\[SEARCH:\s*([^\]]+)\]"#
        if let regex = try? NSRegularExpression(pattern: searchPattern, options: .caseInsensitive) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: nsRange) {
                didTriggerSearch = true
                let query = (text as NSString).substring(with: match.range(at: 1))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                text = regex.stringByReplacingMatches(in: text,
                    range: NSRange(text.startIndex..., in: text), withTemplate: "")

                let results = await performProductSearch(query: query)
                if let results = results {
                    productSearchResults = results
                    appendToAccumulatedSuggestedListings(results.results, query: results.query)

                    // Rounds 0–1: conversational, one listing at a time, like a
                    // friend physically walking into a store with you. Round 2+:
                    // Flicky has already shown a couple of options, so it now
                    // does one broad sweep and dumps everything it found into
                    // the suggestions drawer at once.
                    let isStillOneAtATimePhase = roundIndex < 2
                    let maxNewTabsToOpen = isStillOneAtATimePhase ? 1 : 3
                    let newlyOpenedListings = await openComparisonTabsForVisibleAgenticBrowsing(
                        results: results.results,
                        maxNewTabsToOpen: maxNewTabsToOpen
                    )

                    // Real-page fact-check: only for the 1-3 listings just
                    // opened above (never the full result set) — this is
                    // what keeps the extra page-fetch + Haiku token cost
                    // bounded no matter how big `results.results` is.
                    let verificationNotes = await verifyNewlyOpenedListings(newlyOpenedListings)

                    if isStillOneAtATimePhase, let justOpened = newlyOpenedListings.first {
                        text += "\n\nFirst up: \(justOpened.title) for \(justOpened.price) on \(justOpened.source). Good, or want me to check another one?"
                        if let note = verificationNotes.first {
                            text += " (\(note))"
                        }
                    } else if !newlyOpenedListings.isEmpty {
                        text += "\n\nOkay, I searched everywhere — pulled together the best matches and put them on the right side of your screen for you to compare."
                        if let note = verificationNotes.first {
                            text += " Heads up: \(note)"
                        }
                    } else if let top = results.results.first {
                        text += "\n\nSearched online — best price found: \(top.title) at \(top.price) on \(top.source)."
                    }
                }
            }
        }

        // [NAVIGATE: https://url|reason]
        let navPattern = #"\[NAVIGATE:\s*(https://[^\]|]+?)(?:\|([^\]]*))?\]"#
        if let regex = try? NSRegularExpression(pattern: navPattern, options: .caseInsensitive) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: nsRange) {
                let url = (text as NSString).substring(with: match.range(at: 1))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let reason = match.range(at: 2).location != NSNotFound
                    ? (text as NSString).substring(with: match.range(at: 2)) : "Opening link"
                text = regex.stringByReplacingMatches(in: text,
                    range: NSRange(text.startIndex..., in: text), withTemplate: "")
                await navigateBrowser(url: url, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }

        return (text.trimmingCharacters(in: .whitespacesAndNewlines), didTriggerSearch)
    }

    private func handleElementPointing(xPercent: Double, yPercent: Double, label: String) async {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let screenX = screen.frame.origin.x + (CGFloat(xPercent) / 100.0) * screen.frame.width
        // macOS Y is bottom-up; Claude gives top-down percentage
        let screenY = screen.frame.origin.y + screen.frame.height
            - (CGFloat(yPercent) / 100.0) * screen.frame.height
        detectedElementScreenLocation = CGPoint(x: screenX, y: screenY)
        detectedElementDisplayFrame = screen.frame
        detectedElementBubbleText = label
    }

    // MARK: - Product Search

    private func performProductSearch(query: String) async -> ProductSearchResponse? {
        guard let url = URL(string: "\(Self.workerBaseURL)/search") else {
            return buildFallbackSearchResponse(query: query)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["q": query])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return buildFallbackSearchResponse(query: query)
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return buildFallbackSearchResponse(query: query)
            }

            let rawResults = json["results"] as? [[String: Any]] ?? []
            let results: [ProductSearchResult] = rawResults.prefix(8).compactMap { item in
                guard let title = item["title"] as? String,
                      let itemURL = item["url"] as? String else { return nil }
                return ProductSearchResult(
                    title: title,
                    price: item["price"] as? String ?? "See site",
                    url: itemURL,
                    source: item["source"] as? String ?? "Web",
                    rating: item["rating"] as? Double,
                    imageURL: item["imageUrl"] as? String,
                    deliveryInfo: item["delivery"] as? String
                )
            }
            let searchUrls = json["searchUrls"] as? [String: String] ?? [:]
            return ProductSearchResponse(results: results, searchUrls: searchUrls, query: query)
        } catch {
            print("⚠️ Flicky: search error: \(error.localizedDescription)")
            return buildFallbackSearchResponse(query: query)
        }
    }

    private func buildFallbackSearchResponse(query: String) -> ProductSearchResponse {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return ProductSearchResponse(
            results: [],
            searchUrls: [
                "google": "https://www.google.com/shopping?q=\(encoded)",
                "amazon": "https://www.amazon.com/s?k=\(encoded)",
                "ebay": "https://www.ebay.com/sch/i.html?_nkw=\(encoded)",
                "ebayUsed": "https://www.ebay.com/sch/i.html?_nkw=\(encoded)&LH_ItemCondition=4",
                "facebook": "https://www.facebook.com/marketplace/search/?query=\(encoded)",
            ],
            query: query
        )
    }

    func navigateBrowser(url: String, reason: String) async {
        guard let validURL = URL(string: url), url.hasPrefix("https://") else { return }
        lastNavigatedURL = url
        lastNavigationReason = reason
        NSWorkspace.shared.open(validURL)
        print("🌐 Flicky: Navigated to \(url) — \(reason)")
    }

    /// Opens real browser tabs for the top comparison results the user hasn't
    /// already seen this question, one at a time with a short pause in
    /// between, so the user can visually watch Flicky "go shopping" —
    /// checking listing after listing — instead of the agent silently picking
    /// a single link behind the scenes.
    ///
    /// `maxNewTabsToOpen` caps how many *new* tabs this call opens — 1 during
    /// the early, conversational one-at-a-time rounds, and up to 3 during the
    /// later broad-sweep round. Already-opened URLs (tracked in
    /// `openedListingURLsForCurrentQuestion`) are always skipped so Flicky
    /// never re-shows the user something it already opened earlier in the
    /// same question. Returns exactly the listings newly opened by this call
    /// so the caller can describe them accurately back to the user.
    @discardableResult
    private func openComparisonTabsForVisibleAgenticBrowsing(results: [ProductSearchResult], maxNewTabsToOpen: Int) async -> [ProductSearchResult] {
        let notYetShownListings = results.filter { !openedListingURLsForCurrentQuestion.contains($0.url) }
        let listingsToOpenThisCall = Array(notYetShownListings.prefix(maxNewTabsToOpen))

        var newlyOpenedListings: [ProductSearchResult] = []
        for listing in listingsToOpenThisCall {
            guard !Task.isCancelled else { return newlyOpenedListings }
            guard listing.url.hasPrefix("https://"), let listingURL = URL(string: listing.url) else { continue }

            NSWorkspace.shared.open(listingURL)
            openedListingURLsForCurrentQuestion.insert(listing.url)
            newlyOpenedListings.append(listing)
            lastNavigatedURL = listing.url
            lastNavigationReason = "\(listing.title) — \(listing.price)"
            print("🌐 Flicky: Opened comparison tab — \(listing.title) (\(listing.price)) on \(listing.source)")

            // Stagger the opens so each tab visibly appears one after another
            // rather than all four flashing open simultaneously.
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return newlyOpenedListings
    }

    /// Merges newly found listings into the running list for the current
    /// question (deduplicated by URL) and pushes the updated list to the
    /// right-side suggestions drawer.
    private func appendToAccumulatedSuggestedListings(_ newListings: [ProductSearchResult], query: String) {
        var seenURLs = Set(accumulatedSuggestedListings.map { $0.url })
        for listing in newListings where !seenURLs.contains(listing.url) {
            accumulatedSuggestedListings.append(listing)
            seenURLs.insert(listing.url)
        }
        suggestionsDrawerManager.show(listings: accumulatedSuggestedListings, query: query)
    }

    // MARK: - Real-Page Reading & Fact-Checking (Tier 1 agentic browsing)
    //
    // Flicky's "browsing" is search-result comparison, not true computer-use
    // (no synthesized clicks/keystrokes). This tier adds genuine multi-site
    // *reading*: for the handful of listings actually shown to the user each
    // round, fetch the real page's readable text via the Worker's
    // `/fetch-page` route and have a cheap/fast model (Haiku) fact-check the
    // listing against it — catching things like "out of stock" or "price
    // doesn't match the search snippet" that a search-result card alone
    // wouldn't reveal. Deliberately scoped to only newly-opened listings
    // (never the full result set) to keep the extra fetch + token cost
    // bounded, per the cost-conscious design agreed with the user.

    /// Readable text extracted from a single listing's real web page by the
    /// Worker's `/fetch-page` route (title + up to ~6000 characters of
    /// visible body copy, with script/nav/footer/etc. stripped out).
    private struct FetchedPageContent {
        let url: String
        let title: String
        let text: String
    }

    /// Fetches and extracts readable text from a single listing's real page.
    /// Mirrors `performProductSearch`'s networking pattern. Returns `nil` on
    /// any failure (timeout, non-HTML page, blocked request, etc.) — this is
    /// an enrichment, never something the core shopping flow should block on.
    private func fetchReadablePageContent(url: String) async -> FetchedPageContent? {
        guard let requestURL = URL(string: "\(Self.workerBaseURL)/fetch-page") else { return nil }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["url": url])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pageURL = json["url"] as? String,
                  let pageText = json["text"] as? String, !pageText.isEmpty else {
                return nil
            }
            let pageTitle = json["title"] as? String ?? ""
            return FetchedPageContent(url: pageURL, title: pageTitle, text: pageText)
        } catch {
            print("⚠️ Flicky: page fetch error for \(url): \(error.localizedDescription)")
            return nil
        }
    }

    /// Asks the cheap/fast Haiku model to compare a listing (title, price,
    /// source) against the real text of its own page, returning ONE short
    /// fact-check sentence — e.g. flagging out-of-stock, a price mismatch,
    /// extra shipping/tax, or condition red flags. Returns `nil` when
    /// nothing stands out (page looks consistent with the listing) or on
    /// any API failure, so callers can simply skip adding a note.
    private func verifyListingAgainstRealPageContent(listing: ProductSearchResult, pageContent: FetchedPageContent) async -> String? {
        let systemPrompt = """
        You are a fast fact-checking assistant for online shopping listings. \
        You'll be given a shopping listing (title, price, source) and the real, \
        raw text scraped from that listing's actual web page. Compare them and \
        respond with exactly ONE short, plain sentence (under 20 words) flagging \
        anything a shopper should know that isn't obvious from the listing alone \
        — for example: out of stock, a price that doesn't match, extra shipping \
        or tax, poor condition, or a misleading title. If nothing meaningful \
        stands out, respond with exactly: OK. Do not add any preamble, \
        formatting, quotation marks, or explanation — only the sentence or OK.
        """

        let userPrompt = """
        Listing: \(listing.title) — \(listing.price) on \(listing.source)
        Listing URL: \(listing.url)

        Real page title: \(pageContent.title)
        Real page text (truncated): \(String(pageContent.text.prefix(4000)))
        """

        do {
            let (responseText, _) = try await pageVerificationClaudeAPI.analyzeImage(
                images: [],
                systemPrompt: systemPrompt,
                userPrompt: userPrompt
            )
            let trimmedResponseText = responseText.trimmingCharacters(in: .whitespacesAndNewlines)
            let looksLikeNothingToFlag = trimmedResponseText.isEmpty
                || trimmedResponseText.caseInsensitiveCompare("OK") == .orderedSame
                || trimmedResponseText.caseInsensitiveCompare("OK.") == .orderedSame
            return looksLikeNothingToFlag ? nil : trimmedResponseText
        } catch {
            print("⚠️ Flicky: page verification error for \(listing.url): \(error.localizedDescription)")
            return nil
        }
    }

    /// Fetches + fact-checks every listing in `listings` concurrently and
    /// returns the resulting short fact-check sentences (skipping any
    /// listing whose fetch/verification failed or came back clean). Always
    /// called with only the listings already opened/shown this round — see
    /// the call site in `handleResponseMarkers` — so this never scales with
    /// the full search result set.
    private func verifyNewlyOpenedListings(_ listings: [ProductSearchResult]) async -> [String] {
        guard !listings.isEmpty else { return [] }

        return await withTaskGroup(of: String?.self) { taskGroup in
            for listing in listings {
                taskGroup.addTask { [weak self] in
                    guard let self else { return nil }
                    guard let pageContent = await self.fetchReadablePageContent(url: listing.url) else { return nil }
                    return await self.verifyListingAgainstRealPageContent(listing: listing, pageContent: pageContent)
                }
            }

            var verificationNotes: [String] = []
            for await note in taskGroup {
                if let note, !note.isEmpty {
                    verificationNotes.append(note)
                }
            }
            return verificationNotes
        }
    }

    // MARK: - Screen Capture

    private func captureScreenshots() async -> [(data: Data, label: String)] {
        guard hasScreenContentPermission else { return [] }
        do {
            let capturedScreens = try await CompanionScreenCaptureUtility.captureAllScreensAsJPEG()
            return capturedScreens.map { (data: $0.imageData, label: $0.label) }
        } catch {
            print("⚠️ Flicky: Screenshot capture failed: \(error.localizedDescription)")
            return []
        }
    }

    // MARK: - System Prompt

    // The persona/tone/scope rules below come from the user-authored
    // `FlickyPersonaConfig.content` (mirrors "CLAUDE.md — Finance Agent.md",
    // which the user dropped in as their own behavior config, as they said
    // they eventually would). It's layered on TOP of — not instead of — the
    // action-tag / shopping-choreography / financial-data-rules sections
    // below it, since those are structurally required for
    // `handleResponseMarkers` to keep parsing [SEARCH:]/[NAVIGATE:]/
    // [POINT:]/[INSIGHTS] tags out of Claude's responses correctly.
    private func buildFlickySystemPrompt(financialContext: String) -> String {
        """
You are Flicky, a real-time financial decision-making agent embedded as a cursor overlay on the user's desktop. You have live access to their Capital One bank account data and can see their current screen via screenshots.

\(financialContext)

\(FlickyPersonaConfig.content)

## Embedded Action Tags (include in your response to trigger side effects — always use this exact bracket syntax so the app can parse them out)

[SEARCH: product name and model] — searches for price comparisons. Use for any purchase/comparison decision — products, flights, hotels, subscriptions, anything with a price — not just literal "shopping."
[NAVIGATE: https://example.com|reason] — opens URL in user's browser (announce verbally first)
[POINT: x,y:label] — points cursor at screen element (x,y are 0-100 percentages)
[INSIGHTS] — opens the full financial insights dashboard (spending trends, bill breakdown, rewards value). Use whenever a quick spoken number wouldn't do the picture justice — e.g. "how am I doing this month," "break down my spending."

## Shopping: Conversational, One at a Time
When the user is comparing or buying something, don't dump a wall of links — walk them through it like you're standing next to them in a store:
1. [SEARCH:] once, then talk about only the single best listing you found: name it, its price, and a one-line reason it's good. Ask if that works or if they want you to check another one.
2. If they want another (or you keep researching on your own), [SEARCH:] again with a different angle — a different retailer, a used option, a different spec — and again present just that one new listing.
3. After a couple of rounds like that, switch modes: say something like "let me just search everywhere and bring you the best of everything," [SEARCH:] one more time, and this time refer to the full set — "check them out on the right side of your screen" — since by then every listing found so far (including this round's) is already sitting in the suggestions drawer.

## Non-Negotiable Financial Data Rules
1. Never invent financial numbers. Use only the live data above.
2. Safe to spend = balance minus upcoming bills and $500 reserve.
3. Bills due in 14 days are certain obligations — always mention them.
4. Data is in cents — display as dollars ($4999 = $49.99).
5. For shopping/comparison questions: always [SEARCH:] first, then advise.
6. Auto-navigate to used deals >30% cheaper, new deals >10% cheaper.
7. Never execute or simulate any financial transaction.
"""
    }

    // MARK: - TTS Text Extraction

    private func extractSpokenText(from text: String) -> String {
        var spoken = text
        for pattern in [#"\[SEARCH:[^\]]*\]"#, #"\[NAVIGATE:[^\]]*\]"#, #"\[POINT:[^\]]*\]"#] {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                spoken = regex.stringByReplacingMatches(
                    in: spoken, range: NSRange(spoken.startIndex..., in: spoken), withTemplate: "")
            }
        }
        return spoken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Mock Data

    private func buildMockFinancialInsights() -> FinancialInsights {
        let calendar = Calendar.current
        let today = Date()
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"

        return FinancialInsights(
            balanceCents: 131200,
            safeToSpendCents: 31200,
            upcomingBills: [
                UpcomingBill(id: "1", label: "Rent", date: fmt.string(from: calendar.date(byAdding: .day, value: 8, to: today)!), amountCents: 65000, recurring: true),
                UpcomingBill(id: "2", label: "Netflix", date: fmt.string(from: calendar.date(byAdding: .day, value: 3, to: today)!), amountCents: 1599, recurring: true),
            ],
            expectedIncome: [],
            recentDepositsCents: 285000,
            recentWithdrawalsCents: 152300,
            accountNickname: "Everyday Checking",
            accountLast4: "4321",
            accountType: "Savings",
            rewardsPoints: 12450,
            asOf: Date()
        )
    }
}

// MARK: - Onboarding Video Stubs (no-ops for Flicky — no onboarding video)

extension CompanionManager {
    func setupOnboardingVideo() {
        // Flicky has no onboarding video — skip immediately
        // OverlayWindow calls this after the welcome text animation
    }

    func tearDownOnboardingVideo() {
        // No-op for Flicky
    }
}

// MARK: - Financial Badge in Response Overlay

extension CompanionManager {
    /// Updates the financial badge shown in the cursor overlay whenever insights change.
    func updateResponseOverlayBadge() {
        responseOverlayManager.updateFinancialBadge(financialInsights)
    }
}
