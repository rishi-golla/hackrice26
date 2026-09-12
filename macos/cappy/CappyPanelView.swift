import SwiftUI

struct CappyPanelView: View {
    @ObservedObject var cappyManager: CappyManager

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Cappy").font(.headline)
                Spacer()
                Text(status).foregroundStyle(.secondary).font(.caption)
            }
            Divider()
            Text(description).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            if !cappyManager.allPermissionsGranted {
                Text("Grant Accessibility, Screen Recording, Microphone, and Screen Content access to use finance monitoring.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Confirm screen content permission") { cappyManager.requestScreenContentPermission() }
            }
            Toggle("Monitor financial questions", isOn: Binding(
                get: { cappyManager.isMonitoringEnabled },
                set: { cappyManager.setMonitoringEnabled($0) }
            ))
            .disabled(!cappyManager.authSessionStore.isAuthenticated || !cappyManager.allPermissionsGranted)
            Text(cappyManager.isMonitoringEnabled
                 ? "Monitoring is on. Hold Control + Option to ask Cappy about a purchase."
                 : "Monitoring is off. Cappy does not capture your screen or microphone.")
                .font(.caption).foregroundStyle(.secondary)
            if let errorMessage = cappyManager.errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.red)
            }
            if cappyManager.authSessionStore.isAuthenticated {
                Button("Log out") { cappyManager.logout() }
            } else {
                Text("Sign in to your Cappy account to enable finance monitoring.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(width: 330)
    }

    private var status: String {
        if cappyManager.isMonitoringEnabled { return "Monitoring" }
        if !cappyManager.authSessionStore.isAuthenticated { return "Sign in required" }
        if !cappyManager.allPermissionsGranted { return "Permissions needed" }
        return "Ready"
    }

    private var description: String {
        cappyManager.isMonitoringEnabled
            ? "Cappy reads a screen only after you invoke the hotkey, uses local OCR, and displays an answer only when your account’s finance tool returns a forecast."
            : "Cappy keeps monitoring disabled until you turn it on."
    }
}
