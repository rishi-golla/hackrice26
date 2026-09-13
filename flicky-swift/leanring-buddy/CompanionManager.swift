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

    // MARK: - API Clients

    private static var workerBaseURL: String {
        AppBundleConfiguration.stringValue(forKey: "FLICKY_WORKER_URL")
            ?? "https://your-worker.workers.dev"
    }

    private lazy var claudeAPI: ClaudeAPI = {
        ClaudeAPI(proxyURL: "\(Self.workerBaseURL)/chat", model: selectedModel)
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

    // MARK: - Voice Query Pipeline

    private func handleVoiceQuerySubmitted(transcript: String) {
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        lastTranscript = transcript
        voiceState = .processing
        currentResponseTask = Task { await runFlickyQueryPipeline(userTranscript: transcript) }
    }

    private func runFlickyQueryPipeline(userTranscript: String) async {
        guard !Task.isCancelled else { return }

        let screenshotImages = await captureScreenshots()
        guard !Task.isCancelled else { return }

        let insights = await getOrRefreshFinancialInsights()
        let financialContext = insights?.toSystemPromptContext()
            ?? "No financial data available. Nessie API not configured or unreachable."
        guard !Task.isCancelled else { return }

        let systemPrompt = buildFlickySystemPrompt(financialContext: financialContext)

        voiceState = .responding
        responseOverlayManager.showOverlayAndBeginStreaming()

        var fullResponse = ""
        do {
            let result = try await claudeAPI.analyzeImageStreaming(
                images: screenshotImages,
                systemPrompt: systemPrompt,
                conversationHistory: conversationHistory.suffix(maxConversationHistoryCount).map {
                    (userPlaceholder: $0.userTranscript, assistantResponse: $0.assistantResponse)
                },
                userPrompt: userTranscript,
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

        let cleanedResponse = await handleResponseMarkers(fullResponse: fullResponse)

        conversationHistory.append((userTranscript: userTranscript, assistantResponse: cleanedResponse))
        if conversationHistory.count > maxConversationHistoryCount {
            conversationHistory.removeFirst(conversationHistory.count - maxConversationHistoryCount)
        }

        responseOverlayManager.updateStreamingText(cleanedResponse)
        responseOverlayManager.finishStreaming()

        guard !Task.isCancelled else { return }

        let spokenText = extractSpokenText(from: cleanedResponse)
        if !spokenText.isEmpty {
            do {
                try await elevenLabsTTSClient.speakText(spokenText)
            } catch {
                if !Task.isCancelled { print("⚠️ TTS: \(error.localizedDescription)") }
            }
        }

        guard !Task.isCancelled else { return }
        voiceState = .idle
    }

    // MARK: - Response Marker Parsing

    private func handleResponseMarkers(fullResponse: String) async -> String {
        var text = fullResponse

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

        // [SEARCH: query]
        let searchPattern = #"\[SEARCH:\s*([^\]]+)\]"#
        if let regex = try? NSRegularExpression(pattern: searchPattern, options: .caseInsensitive) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if let match = regex.firstMatch(in: text, range: nsRange) {
                let query = (text as NSString).substring(with: match.range(at: 1))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                text = regex.stringByReplacingMatches(in: text,
                    range: NSRange(text.startIndex..., in: text), withTemplate: "")

                let results = await performProductSearch(query: query)
                if let results = results {
                    productSearchResults = results
                    if let bestDeal = findBestDeal(results: results.results) {
                        text += "\n\nOpening the best deal for you now: \(bestDeal.title) — \(bestDeal.price) on \(bestDeal.source)."
                        await navigateBrowser(url: bestDeal.url, reason: "\(bestDeal.title) — \(bestDeal.price)")
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

        return text.trimmingCharacters(in: .whitespacesAndNewlines)
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
                    rating: item["rating"] as? Double
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

    private func findBestDeal(results: [ProductSearchResult]) -> ProductSearchResult? {
        // Prefer used/eBay/Marketplace results as "best deal"R
        return results.first { $0.isUsed }
    }

    func navigateBrowser(url: String, reason: String) async {
        guard let validURL = URL(string: url), url.hasPrefix("https://") else { return }
        lastNavigatedURL = url
        lastNavigationReason = reason
        NSWorkspace.shared.open(validURL)
        print("🌐 Flicky: Navigated to \(url) — \(reason)")
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

    private func buildFlickySystemPrompt(financialContext: String) -> String {
        """
You are Flicky, a real-time personal financial advisor embedded as a cursor overlay on the user's desktop. You have live access to their Capital One bank account data and can see their current screen via screenshots.

\(financialContext)

## Your Style
You are the user's trusted financial advisor — warm, specific, direct. You give short, grounded answers using their actual numbers. Never fabricate figures. If data is missing, say so honestly.

## Embedded Action Tags (include in your response to trigger side effects)

[SEARCH: product name and model] — searches for price comparisons (use when user asks about buying something)
[NAVIGATE: https://example.com|reason] — opens URL in user's browser (announce verbally first)
[POINT: x,y:label] — points cursor at screen element (x,y are 0-100 percentages)

## Financial Rules
1. Never invent financial numbers. Use only the data above.
2. Safe to spend = balance minus upcoming bills and $500 reserve.
3. Bills due in 14 days are certain obligations — always mention them.
4. Data is in cents — display as dollars ($4999 = $49.99).
5. For shopping questions: always [SEARCH:] first, then advise.
6. Auto-navigate to used deals >30% cheaper, new deals >10% cheaper.
7. Never execute or simulate any financial transaction.

## Format
- 2-3 sentences, lead with the key number or decision
- Be specific: "$312 safe to spend", "$650 rent due in 8 days"
- Shopping: "I searched — best price: [result]"
- Navigation: "Opening [site] for you now" then [NAVIGATE:...]
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
