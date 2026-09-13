// CompanionPanelView.swift — PeppaPrice Financial Advisor Panel
//
// The SwiftUI content inside the menu bar panel.
// Shows: login modal → financial proof panel → permissions + controls.

import AVFoundation
import SwiftUI

enum CompanionPanelLayout {
    static let width: CGFloat = 400
    static let height: CGFloat = 480
}

struct CompanionPanelView: View {
    @ObservedObject var companionManager: CompanionManager
    var onContentHeightChange: ((CGFloat) -> Void)?
    @State private var contentHeight = CompanionPanelLayout.height
    @State private var loginCustomerId: String = ""
    @State private var loginEmail: String = ""
    @State private var isLoggingIn = false

    @FocusState private var isQuestionFocused: Bool
    @State private var question = ""
    @State private var isOptionsMenuPresented = false
    private let secondaryText = Color(red: 0.65, green: 0.67, blue: 0.73)
    private let mint = Color(red: 0.35, green: 0.94, blue: 0.64)

    var body: some View {
        GeometryReader { viewport in
        VStack(alignment: .leading, spacing: 0) {
            panelHeader
                .padding(.bottom, 18)
                .zIndex(1)

            Group {
                VStack(alignment: .leading, spacing: 14) {
                    if !companionManager.allPermissionsGranted {
                        permissionsSection
                    } else if !companionManager.isLoggedIn {
                        loginSection
                    } else {
                        financialProofSection
                        PlaidBankConnectionRow(owner: companionManager.loginState?.customerId ?? "")
                        InlineCompanionResponse(viewModel: companionManager.responseOverlayManager.viewModel)
                        questionSection
                        if companionManager.voiceState != .idle {
                            stopFlickyButton
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }

            Rectangle().fill(Color.white.opacity(0.13)).frame(height: 1)
                .padding(.top, 16)
                .padding(.bottom, 12)
            footerSection
        }
        .padding(20)
        .frame(width: CompanionPanelLayout.width, alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .background {
            GeometryReader { content in
                Color.clear.preference(key: CompanionPanelHeightKey.self, value: content.size.height)
            }
        }
        .background(panelBackground)
        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .scaleEffect(min(1, viewport.size.width / CompanionPanelLayout.width, viewport.size.height / contentHeight))
        .frame(width: viewport.size.width, height: viewport.size.height)
        }
        .onPreferenceChange(CompanionPanelHeightKey.self) { height in
            guard height > 0, abs(height - contentHeight) > 0.5 else { return }
            contentHeight = height
            onContentHeightChange?(height)
        }
        .preferredColorScheme(.dark)
        .onReceive(NotificationCenter.default.publisher(for: .flickyPanelOpened)) { _ in
            isQuestionFocused = companionManager.isLoggedIn && companionManager.allPermissionsGranted
        }
        .onExitCommand {
            if isOptionsMenuPresented { isOptionsMenuPresented = false }
            else { NotificationCenter.default.post(name: .peppapriceDismissPanel, object: nil) }
        }
    }

    // MARK: - Header

    private var panelHeader: some View {
        HStack(spacing: 10) {
            Image("PeppaPriceLogo")
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .frame(width: 32, height: 32)
                .clipShape(RoundedRectangle(cornerRadius: 9))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("PeppaPrice")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 8)
            optionsButton
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
    }

    private var optionsButton: some View {
        Button {
                withAnimation(.easeOut(duration: 0.16)) {
                    isOptionsMenuPresented.toggle()
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(secondaryText)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(.white.opacity(isOptionsMenuPresented ? 0.08 : 0.035)))
                    .overlay(Circle().strokeBorder(.white.opacity(isOptionsMenuPresented ? 0.26 : 0.16), lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .focusEffectDisabled()
            .accessibilityLabel("PeppaPrice options")
            .accessibilityHint("Show PeppaPrice actions")
            .pointerCursor()

            .overlay(alignment: .topTrailing) {
            if isOptionsMenuPresented {
                VStack(alignment: .leading, spacing: 4) {
                    optionsMenuButton(companionManager.isPeppaPriceCursorEnabled ? "Hide pet" : "Show pet", icon: "cursorarrow.motionlines") {
                        companionManager.setPeppaPriceCursorEnabled(!companionManager.isPeppaPriceCursorEnabled)
                        isOptionsMenuPresented = false
                    }
                    optionsMenuButton("Refresh account", icon: "arrow.clockwise", isDisabled: !companionManager.isLoggedIn) {
                        isOptionsMenuPresented = false
                        Task { await companionManager.refreshFinancialData() }
                    }
                    optionsMenuButton("Dismiss panel", icon: "xmark") {
                        isOptionsMenuPresented = false
                        NotificationCenter.default.post(name: .peppapriceDismissPanel, object: nil)
                    }
                    optionsMenuButton("Subscriptions", icon: "repeat") {
                        isOptionsMenuPresented = false
                        companionManager.showSubscriptions()
                    }
                    optionsMenuButton("Credit options", icon: "creditcard") {
                        isOptionsMenuPresented = false
                        companionManager.showCreditSimulation()
                    }
                    optionsMenuButton("Shopping basket", icon: "basket") {
                        isOptionsMenuPresented = false
                        companionManager.suggestionsDrawerManager.hide()
                        companionManager.shoppingBasketManager.show()
                    }
                    Rectangle()
                        .fill(.white.opacity(0.12))
                        .frame(height: 1)
                        .padding(.vertical, 4)
                    optionsMenuButton("Quit PeppaPrice", icon: "power") {
                        isOptionsMenuPresented = false
                        NSApp.terminate(nil)
                    }
                }
                .padding(8)
                .frame(width: 204)
                .background {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color(red: 0.055, green: 0.06, blue: 0.07))
                        .overlay {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(.white.opacity(0.2), lineWidth: 1)
                        }
                        .shadow(color: .black.opacity(0.45), radius: 18, y: 10)
                }
                .fixedSize(horizontal: false, vertical: true)
                .offset(y: 44)
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .topTrailing)))
                .zIndex(20)
            }
        }
        .frame(width: 34, height: 34)
    }

    private func optionsMenuButton(
        _ title: String,
        icon: String,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 18)
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(isDisabled ? secondaryText.opacity(0.4) : .white.opacity(0.9))
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.white.opacity(0.001))
            }
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .pointerCursor(isEnabled: !isDisabled)
    }

    // MARK: - Login Section

    private var loginSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Capital One branding header
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(red: 0.8, green: 0.1, blue: 0.1))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text("C1")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text("Capital One")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(DS.Colors.textPrimary)
                    Text("Connect your account")
                        .font(.system(size: 11))
                        .foregroundColor(DS.Colors.textTertiary)
                }
            }

            Text("Enter your Nessie Customer ID to load your sandbox account data.")
                .font(.system(size: 11))
                .foregroundColor(DS.Colors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            // Customer ID field (Nessie customer_id)
            VStack(alignment: .leading, spacing: 4) {
                Text("CUSTOMER ID")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                TextField("Nessie customer_id", text: $loginCustomerId)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundColor(DS.Colors.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
                    )
            }

            // Email field
            VStack(alignment: .leading, spacing: 4) {
                Text("EMAIL")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                TextField("your@email.com", text: $loginEmail)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundColor(DS.Colors.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
                    )
            }

            if let error = companionManager.loginError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundColor(Color(red: 1, green: 0.4, blue: 0.4))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: {
                isLoggingIn = true
                Task {
                    await companionManager.performLogin(
                        customerId: loginCustomerId.trimmingCharacters(in: .whitespacesAndNewlines),
                        displayEmail: loginEmail.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                    isLoggingIn = false
                }
            }) {
                HStack(spacing: 8) {
                    if isLoggingIn {
                        ProgressView()
                            .scaleEffect(0.7)
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    }
                    Text(isLoggingIn ? "Connecting…" : "Connect Account")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color(red: 0.8, green: 0.1, blue: 0.1))
                )
            }
            .buttonStyle(.plain)
            .pointerCursor()
            .disabled(isLoggingIn)
        }
    }

    // MARK: - Account and balance

    private var financialProofSection: some View {
        VStack(spacing: 12) {
            if companionManager.loginState != nil {
                HStack(spacing: 10) {
                    CapitalOneMark().fill(Color(red: 0.94, green: 0.28, blue: 0.32)).frame(width: 24, height: 18)
                    Text("Capital One").font(.system(size: 13, weight: .medium))
                    Spacer()
                    Text(companionManager.nessieCustomer?.name ?? "Account")
                        .font(.system(size: 12)).foregroundStyle(secondaryText).lineLimit(1)
                    Button { companionManager.nessieConnectionPanel.show() } label: {
                        Image(systemName: "info.circle").font(.system(size: 14)).foregroundStyle(secondaryText)
                    }.buttonStyle(.plain).pointerCursor().accessibilityLabel("Connection details")
                        .help("View account source and connection details")
                }.padding(.vertical, 8)
            }

            if let customer = companionManager.nessieCustomer {
                HStack(spacing: 10) {
                    Menu {
                        if !companionManager.demoAccounts.isEmpty {
                            Section("20 demo accounts") {
                                ForEach(companionManager.demoAccounts) { account in
                                    Button {
                                        Task { await companionManager.selectDemoAccount(account) }
                                    } label: {
                                        Label(account.nickname, systemImage: account.id == companionManager.loginState?.accountId ? "checkmark.circle.fill" : "circle")
                                    }
                                }
                            }
                            Divider()
                        }
                        ForEach(customer.accounts) { account in
                            Button {
                                Task { await companionManager.selectNessieAccount(account) }
                            } label: {
                                Label(account.nickname + " · " + account.type,
                                      systemImage: account.id == companionManager.loginState?.accountId ? "checkmark.circle.fill" : "circle")
                            }
                        }
                    } label: {
                        Text(customer.accounts.first(where: { $0.id == companionManager.loginState?.accountId })?.nickname ?? "Select account")
                            .font(.system(size: 12, weight: .medium)).lineLimit(1)
                    }
                    .menuStyle(.borderlessButton)
                    .disabled(companionManager.isLoadingFinancials)
                    .pointerCursor(isEnabled: !companionManager.isLoadingFinancials)
                    .accessibilityLabel("Select Nessie account")
                    Text("\(customer.accounts.count) account\(customer.accounts.count == 1 ? "" : "s")")
                        .font(.system(size: 11)).foregroundStyle(secondaryText)
                }
            }
            if let insights = companionManager.financialInsights {
                VStack(spacing: 10) {
                    Text("Balance")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(secondaryText)
                    Text(insights.formattedBalance)
                        .font(.system(size: 34, weight: .medium))
                        .tracking(-1.2)
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(.white)
                    HStack(spacing: 10) {
                        Text("Safe to Spend")
                            .font(.system(size: 13))
                            .foregroundStyle(secondaryText)
                        Text(insights.formattedSafeToSpend)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .padding(.top, 2)
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)

                let bills = insights.recurringBills.isEmpty ? insights.upcomingBills : insights.recurringBills
                if !bills.isEmpty {
                    Button {
                        companionManager.research.setEvidenceSuppressed(false)
                        companionManager.research.showMetrics(["bills"], snapshot: companionManager.financialInsights)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "calendar").font(.system(size: 15))
                            Text("Upcoming bills").font(.system(size: 13))
                            Spacer()
                            Text("\(bills.count)").font(.system(size: 13)).monospacedDigit()
                            Image(systemName: "chevron.right").font(.system(size: 10))
                        }.foregroundStyle(secondaryText).padding(.vertical, 6)
                    }.buttonStyle(.plain).pointerCursor()
                }
            }
            if companionManager.isLoadingFinancials {
                ProgressView("Refreshing account…").font(.system(size: 12))
            }
            if let error = companionManager.financialLoadError {
                Text(error).font(.system(size: 12)).foregroundStyle(secondaryText).lineLimit(2).help(error)
            }
        }
    }

    private var connectionCheck: some View {
        Image(systemName: "checkmark.circle.fill")
            .symbolRenderingMode(.palette)
            .foregroundStyle(Color.black.opacity(0.8), mint)
            .font(.system(size: 17))
            .accessibilityLabel("Account connected")
    }

    @ViewBuilder
    private func merchantIcon(_ name: String) -> some View {
        switch name.lowercased() {
        case "netflix":
            Text("N").font(.system(size: 23, weight: .black)).foregroundStyle(Color(red: 0.94, green: 0.12, blue: 0.17))
        case "spotify":
            Image(systemName: "waveform.circle.fill").font(.system(size: 22)).foregroundStyle(.green)
        case "airbnb":
            Image(systemName: "a.circle").font(.system(size: 22)).foregroundStyle(Color(red: 1, green: 0.42, blue: 0.46))
        default:
            Image(systemName: name.lowercased().contains("rent") ? "house" : "repeat")
                .font(.system(size: 17)).foregroundStyle(secondaryText)
        }
    }

    private var questionSection: some View {
        VStack(spacing: 10) {
            HStack(spacing: 14) {
                TextField("Ask PeppaPrice anything…", text: $question)
                    .focused($isQuestionFocused)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .onSubmit(submitQuestion)
                    .accessibilityLabel("Ask PeppaPrice anything")
                Button(action: submitQuestion) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(question.isEmpty ? mint.opacity(0.7) : Color.black.opacity(0.85))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(mint.opacity(question.isEmpty ? 0.14 : 0.85)))
                }
                .buttonStyle(.plain)
                .pointerCursor()
                .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send question")
            }
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(tileBackground(emphasized: true))

            HStack(spacing: 12) {
                suggestionButton("Analyze my spending", icon: "list.bullet.rectangle")
                suggestionButton("Find ways to save", icon: "lightbulb")
            }
        }
    }

    private func suggestionButton(_ title: String, icon: String) -> some View {
        Button { companionManager.submitPanelQuestion(title) } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(mint.opacity(0.8))
                Text(title).font(.system(size: 12)).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .medium))
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
        }
        .buttonStyle(.plain)
        .foregroundStyle(secondaryText)
        .pointerCursor()
    }

    private func submitQuestion() {
        let trimmedQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuestion.isEmpty else { return }
        companionManager.submitPanelQuestion(trimmedQuestion)
        question = ""
    }

    private func tileBackground(emphasized: Bool = false) -> some View {
        RoundedRectangle(cornerRadius: 17, style: .continuous)
            .fill(.white.opacity(emphasized ? 0.055 : 0.025))
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(.white.opacity(emphasized ? 0.24 : 0.09), lineWidth: 1)
            }
    }

    // Redundant with the stop button on the response overlay itself — this
    // one lives in the menu bar panel so the user can still cut PeppaPrice off
    // even if the overlay bubble isn't visible or easy to reach.
    private var stopFlickyButton: some View {
        Button(action: {
            companionManager.stopCurrentResponse()
        }) {
            HStack(spacing: 6) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 10))
                Text("Stop PeppaPrice")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundColor(DS.Colors.destructiveText)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(DS.Colors.destructive.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(DS.Colors.destructive.opacity(0.25), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .pointerCursor()
    }

    // MARK: - Permissions Section

    private var permissionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Setup Required")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(DS.Colors.textSecondary)
                Text("Grant the permissions below to activate PeppaPrice.")
                    .font(.system(size: 11))
                    .foregroundColor(DS.Colors.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            permissionRow(
                label: "Microphone",
                icon: "mic",
                isGranted: companionManager.hasMicrophonePermission,
                action: {
                    let status = AVCaptureDevice.authorizationStatus(for: .audio)
                    if status == .notDetermined {
                        AVCaptureDevice.requestAccess(for: .audio) { _ in }
                    } else {
                        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
                    }
                }
            )

            permissionRow(
                label: "Accessibility",
                icon: "hand.raised",
                isGranted: companionManager.hasAccessibilityPermission,
                action: { WindowPositionManager.requestAccessibilityPermission() }
            )

            permissionRow(
                label: "Screen Recording",
                icon: "rectangle.dashed.badge.record",
                isGranted: companionManager.hasScreenRecordingPermission,
                action: { WindowPositionManager.requestScreenRecordingPermission() }
            )

            if companionManager.hasScreenRecordingPermission {
                permissionRow(
                    label: "Screen Content",
                    icon: "eye",
                    isGranted: companionManager.hasScreenContentPermission,
                    action: { companionManager.requestScreenContentPermission() }
                )
            }
        }
    }

    private func permissionRow(label: String, icon: String, isGranted: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(isGranted ? DS.Colors.textTertiary : DS.Colors.warning)
                    .frame(width: 16)
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(DS.Colors.textSecondary)
            }
            Spacer()
            if isGranted {
                HStack(spacing: 4) {
                    Circle().fill(DS.Colors.success).frame(width: 6, height: 6)
                    Text("Granted").font(.system(size: 10, weight: .medium)).foregroundColor(DS.Colors.success)
                }
            } else {
                Button(action: action) {
                    Text("Grant")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DS.Colors.accent))
                }
                .buttonStyle(.plain)
                .pointerCursor()
            }
        }
        .padding(.vertical, 5)
    }

    // MARK: - Footer

    private var footerSection: some View {
        HStack(spacing: 14) {
            Image(systemName: "mic").font(.system(size: 23)).foregroundStyle(secondaryText)
            Text("⌘⇧Space to open\nHold ⌃⌥ to talk")
                .font(.system(size: 12))
                .foregroundStyle(secondaryText)
                .help("Command–Shift–Space toggles PeppaPrice. Escape closes the panel. Hold Control–Option to talk.")
            Spacer(minLength: 0)
            if companionManager.isLoggedIn {
                Rectangle().fill(.white.opacity(0.13)).frame(width: 1, height: 27)
                Button("Sign out") { companionManager.logout() }
                    .font(.system(size: 12))
                    .foregroundStyle(secondaryText)
                    .buttonStyle(.plain)
                    .pointerCursor()
            }
        }
    }

    private func safeToSpendColor(cents: Int) -> Color {
        if cents < 5000 { return Color(red: 1, green: 0.35, blue: 0.35) }    // <$50: red
        if cents < 20000 { return DS.Colors.warning }                          // <$200: orange
        return DS.Colors.success                                                // ≥$200: green
    }

    // MARK: - Status Helpers

    private var panelBackground: some View {
        Color(red: 0.075, green: 0.078, blue: 0.085)
    }

    private var statusDotColor: Color {
        if !companionManager.isLoggedIn { return DS.Colors.warning }
        if !companionManager.allPermissionsGranted { return DS.Colors.warning }
        switch companionManager.voiceState {
        case .idle:       return mint
        case .listening:  return DS.Colors.blue400
        case .processing: return DS.Colors.blue400
        case .responding: return DS.Colors.blue400
        }
    }

    private var statusText: String {
        if !companionManager.allPermissionsGranted { return "Setup" }
        if !companionManager.isLoggedIn { return "Sign in" }
        switch companionManager.voiceState {
        case .idle:       return "Ready"
        case .listening:  return "Listening"
        case .processing: return "Thinking"
        case .responding: return "Responding"
        }
    }
}

private struct FlickyGlassButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        GlassButtonContent(configuration: configuration)
    }

    private struct GlassButtonContent: View {
        let configuration: ButtonStyle.Configuration
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .foregroundStyle(Color(red: 0.75, green: 0.78, blue: 0.84))
                .background {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.white.opacity(configuration.isPressed ? 0.12 : isHovered ? 0.075 : 0.025))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(.white.opacity(isHovered ? 0.2 : 0.085), lineWidth: 1)
                }
                .onHover { isHovered = $0 }
        }
    }
}

private struct CapitalOneMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.height * 0.3))
        path.addCurve(to: CGPoint(x: rect.width * 0.87, y: rect.height * 0.16), control1: CGPoint(x: rect.width * 0.8, y: -rect.height * 0.05), control2: CGPoint(x: rect.width * 1.15, y: rect.height * 0.04))
        path.addCurve(to: CGPoint(x: rect.width * 0.25, y: rect.height), control1: CGPoint(x: rect.width * 1.12, y: rect.height * 0.38), control2: CGPoint(x: rect.width * 0.62, y: rect.height * 0.8))
        path.addCurve(to: CGPoint(x: rect.minX, y: rect.height * 0.3), control1: CGPoint(x: rect.width * 0.83, y: rect.height * 0.45), control2: CGPoint(x: rect.width * 0.44, y: rect.height * 0.23))
        path.closeSubpath()
        return path
    }
}


/// Reserves response space in the layout instead of covering account controls.
private struct InlineCompanionResponse: View {
    @ObservedObject var viewModel: CompanionResponseOverlayViewModel

    var body: some View {
        if viewModel.isShowingResponse {
            ScrollView(.vertical) {
                Text(viewModel.streamingResponseText.isEmpty ? "Working on your question…" : viewModel.streamingResponseText)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .scrollIndicators(.hidden)
            .frame(height: 72)
            .padding(12)
            .background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

private struct CompanionPanelHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
