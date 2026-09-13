// CompanionPanelView.swift — Flicky Financial Advisor Panel
//
// The SwiftUI content inside the menu bar panel.
// Shows: login modal → financial proof panel → permissions + controls.

import AVFoundation
import SwiftUI

struct CompanionPanelView: View {
    @ObservedObject var companionManager: CompanionManager
    @State private var loginCustomerId: String = ""
    @State private var loginEmail: String = ""
    @State private var isLoggingIn = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            panelHeader

            Divider()
                .background(DS.Colors.borderSubtle)
                .padding(.horizontal, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !companionManager.allPermissionsGranted {
                        permissionsSection
                            .padding(.horizontal, 16)
                            .padding(.top, 16)
                    } else if !companionManager.isLoggedIn {
                        loginSection
                            .padding(.horizontal, 16)
                            .padding(.top, 16)
                    } else {
                        // This panel is intentionally account/financial info only —
                        // shopping search results and comparisons live in the
                        // separate right-edge SuggestionsDrawer instead (see
                        // SuggestionsDrawerManager.swift), so this stays focused on
                        // "what's in my account" rather than "what Flicky is shopping for."
                        financialProofSection
                            .padding(.horizontal, 16)
                            .padding(.top, 16)

                        controlsSection
                            .padding(.horizontal, 16)
                            .padding(.top, 12)
                    }

                    Spacer().frame(height: 12)
                }
            }
            .frame(maxHeight: 520)

            Divider()
                .background(DS.Colors.borderSubtle)
                .padding(.horizontal, 16)

            footerSection
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
        }
        .frame(width: 340)
        .background(panelBackground)
    }

    // MARK: - Header

    private var panelHeader: some View {
        HStack {
            HStack(spacing: 8) {
                Circle()
                    .fill(statusDotColor)
                    .frame(width: 8, height: 8)
                    .shadow(color: statusDotColor.opacity(0.7), radius: 4)

                VStack(alignment: .leading, spacing: 1) {
                    Text("Flicky")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(DS.Colors.textPrimary)
                    Text("Financial Advisor")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DS.Colors.textTertiary)
                }
            }

            Spacer()

            Text(statusText)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(DS.Colors.textTertiary)

            Button(action: {
                NotificationCenter.default.post(name: .clickyDismissPanel, object: nil)
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)
            .pointerCursor()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
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

            Text("Enter your Nessie Customer ID to connect your Capital One data. Leave blank for demo mode.")
                .font(.system(size: 11))
                .foregroundColor(DS.Colors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)

            // Customer ID field (Nessie customer_id)
            VStack(alignment: .leading, spacing: 4) {
                Text("CUSTOMER ID")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                TextField("Nessie customer_id (or leave blank for demo)", text: $loginCustomerId)
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

    // MARK: - Financial Proof Section

    private var financialProofSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Account badge
            if let state = companionManager.loginState {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Color(red: 0.8, green: 0.1, blue: 0.1))
                        .frame(width: 24, height: 24)
                        .overlay(
                            Text("C1")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(.white)
                        )

                    VStack(alignment: .leading, spacing: 1) {
                        Text(state.displayEmail)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(DS.Colors.textSecondary)
                        Text(state.maskedCardNumber)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(DS.Colors.textTertiary)
                    }

                    Spacer()

                    Button(action: {
                        Task { await companionManager.refreshFinancialData() }
                    }) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11))
                            .foregroundColor(DS.Colors.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .pointerCursor()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
                )
            }

            if companionManager.isLoadingFinancials {
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.7)
                        .progressViewStyle(CircularProgressViewStyle(tint: DS.Colors.textTertiary))
                    Text("Loading financial data…")
                        .font(.system(size: 11))
                        .foregroundColor(DS.Colors.textTertiary)
                }
                .padding(.vertical, 4)
            } else if let insights = companionManager.financialInsights {
                // Balance + Safe to Spend
                HStack(spacing: 8) {
                    financialCard(
                        label: "Balance",
                        value: insights.formattedBalance,
                        icon: "banknote",
                        color: DS.Colors.textPrimary
                    )
                    financialCard(
                        label: "Safe to Spend",
                        value: insights.formattedSafeToSpend,
                        icon: "checkmark.shield",
                        color: safeToSpendColor(cents: insights.safeToSpendCents)
                    )
                }

                // Upcoming bills
                if !insights.upcomingBills.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("UPCOMING BILLS")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(DS.Colors.textTertiary)

                        ForEach(insights.upcomingBills.prefix(3)) { bill in
                            HStack {
                                HStack(spacing: 6) {
                                    Image(systemName: bill.recurring ? "repeat" : "calendar")
                                        .font(.system(size: 10))
                                        .foregroundColor(DS.Colors.textTertiary)
                                        .frame(width: 12)
                                    Text(bill.label)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundColor(DS.Colors.textSecondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text(bill.formattedAmount)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(DS.Colors.textPrimary)
                                    Text(bill.date)
                                        .font(.system(size: 9))
                                        .foregroundColor(DS.Colors.textTertiary)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(Color.white.opacity(0.04))
                            )
                        }
                    }
                }

                // Recent activity
                if insights.recentDepositsCents > 0 || insights.recentWithdrawalsCents > 0 {
                    HStack(spacing: 8) {
                        activityPill(
                            label: "30d In",
                            value: insights.formatCents(insights.recentDepositsCents),
                            color: DS.Colors.success
                        )
                        activityPill(
                            label: "30d Out",
                            value: insights.formatCents(insights.recentWithdrawalsCents),
                            color: Color(red: 1, green: 0.45, blue: 0.35)
                        )
                        if let points = insights.rewardsPoints, points > 0 {
                            activityPill(label: "Points", value: "\(points)", color: DS.Colors.blue400)
                        }
                    }
                }
            } else if let error = companionManager.financialLoadError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundColor(DS.Colors.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if companionManager.financialInsights != nil {
                viewFullInsightsButton
            }
        }
    }

    // Opens the toggleable insights dashboard (see
    // FinancialInsightsDashboardManager) so the user can dig into spending
    // trends, the full bill breakdown, and rewards value beyond what fits in
    // this compact menu bar panel — accessible any time, not just when Flicky
    // proactively opens it via [INSIGHTS].
    private var viewFullInsightsButton: some View {
        Button(action: {
            companionManager.insightsDashboardManager.toggle()
        }) {
            HStack(spacing: 6) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 11))
                Text("View Full Insights")
                    .font(.system(size: 11, weight: .semibold))
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 9))
            }
            .foregroundColor(DS.Colors.blue400)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(DS.Colors.blue400.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(DS.Colors.blue400.opacity(0.2), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .pointerCursor()
    }

    // MARK: - Controls Section

    private var controlsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "command")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
                Text("Hold  ctrl + option  to talk to Flicky")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(DS.Colors.textSecondary)
            }

            if companionManager.voiceState != .idle {
                stopFlickyButton
            }

            modelPickerRow
        }
    }

    // Redundant with the stop button on the response overlay itself — this
    // one lives in the menu bar panel so the user can still cut Flicky off
    // even if the overlay bubble isn't visible or easy to reach.
    private var stopFlickyButton: some View {
        Button(action: {
            companionManager.stopCurrentResponse()
        }) {
            HStack(spacing: 6) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 10))
                Text("Stop Flicky")
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

    private var modelPickerRow: some View {
        HStack {
            Text("Model")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(DS.Colors.textSecondary)

            Spacer()

            HStack(spacing: 0) {
                modelOptionButton(label: "Sonnet", modelID: "claude-sonnet-4-6")
                modelOptionButton(label: "Opus", modelID: "claude-opus-4-6")
            }
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(DS.Colors.borderSubtle, lineWidth: 0.5)
            )
        }
        .padding(.vertical, 2)
    }

    private func modelOptionButton(label: String, modelID: String) -> some View {
        let isSelected = companionManager.selectedModel == modelID
        return Button(action: { companionManager.setSelectedModel(modelID) }) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(isSelected ? DS.Colors.textPrimary : DS.Colors.textTertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(isSelected ? Color.white.opacity(0.1) : Color.clear)
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
                Text("Grant the permissions below to activate Flicky.")
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
        HStack {
            Button(action: { NSApp.terminate(nil) }) {
                HStack(spacing: 5) {
                    Image(systemName: "power").font(.system(size: 10, weight: .medium))
                    Text("Quit Flicky").font(.system(size: 11, weight: .medium))
                }
                .foregroundColor(DS.Colors.textTertiary)
            }
            .buttonStyle(.plain)
            .pointerCursor()

            Spacer()

            if companionManager.isLoggedIn {
                Button(action: { companionManager.logout() }) {
                    Text("Sign out")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(DS.Colors.textTertiary)
                }
                .buttonStyle(.plain)
                .pointerCursor()
            }
        }
    }

    // MARK: - Helper Views

    private func financialCard(label: String, value: String, icon: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundColor(color.opacity(0.8))
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(DS.Colors.textTertiary)
                Text(value)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(color)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(color.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(color.opacity(0.15), lineWidth: 0.5)
        )
    }

    private func activityPill(label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(DS.Colors.textTertiary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(color.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(color.opacity(0.2), lineWidth: 0.5)
        )
    }

    private func safeToSpendColor(cents: Int) -> Color {
        if cents < 5000 { return Color(red: 1, green: 0.35, blue: 0.35) }    // <$50: red
        if cents < 20000 { return DS.Colors.warning }                          // <$200: orange
        return DS.Colors.success                                                // ≥$200: green
    }

    // MARK: - Status Helpers

    private var panelBackground: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(DS.Colors.background)
            .shadow(color: Color.black.opacity(0.5), radius: 20, x: 0, y: 10)
            .shadow(color: Color.black.opacity(0.3), radius: 4, x: 0, y: 2)
    }

    private var statusDotColor: Color {
        if !companionManager.isLoggedIn { return DS.Colors.warning }
        if !companionManager.allPermissionsGranted { return DS.Colors.warning }
        switch companionManager.voiceState {
        case .idle:       return DS.Colors.success
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
