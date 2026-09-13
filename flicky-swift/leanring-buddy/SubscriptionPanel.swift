import AppKit
import SwiftUI
import WebKit

@MainActor
final class SubscriptionManager {
    let store = SubscriptionStore()
    private let plan: (String, String) async throws -> String
    private var browser: SubscriptionCancellation
    private var panel: NSPanel?
    init(plan: @escaping (String, String) async throws -> String) {
        self.plan = plan
        browser = SubscriptionCancellation(store: store, onControlActivityChanged: { ScreenControlGlow.shared.setActive($0, source: "subscription-navigation") }, plan: plan)
    }
    func show() {
        if browser.profileKey != store.accountKey {
            browser.reset(); panel?.close(); panel = nil
            browser = SubscriptionCancellation(store: store, profileKey: store.accountKey, onControlActivityChanged: { ScreenControlGlow.shared.setActive($0, source: "subscription-navigation") }, plan: plan)
        }
        if panel == nil {
            let window = SubscriptionWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Subscriptions · PeppaPrice"
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 850, height: 600)
            window.contentView = NSHostingView(rootView: SubscriptionPanel(store: store, browser: browser))
            window.center(); panel = window
        }
        if let screen = NSScreen.main {
            let rect = screen.visibleFrame.insetBy(dx: 20, dy: 20)
            if panel!.frame.width > rect.width || panel!.frame.height > rect.height { panel!.setFrame(rect, display: true) }
        }
        NSApp.activate(ignoringOtherApps: true)
        panel?.makeKeyAndOrderFront(nil)
    }
    func guideCancellation(service: String) -> Bool {
        show()
        let matches = store.items.filter { SubscriptionRules.matchesService($0, query: service) }
        guard matches.count == 1, let item = matches.first,
              SubscriptionRules.website(item.website) != nil else { return false }
        browser.openGuidance(item)
        return browser.selected?.id == item.id
    }
    func reset() {
        browser.reset(); panel?.close(); panel = nil
        store.update(account: nil, snapshot: nil)
        browser = SubscriptionCancellation(store: store, onControlActivityChanged: { ScreenControlGlow.shared.setActive($0, source: "subscription-navigation") }, plan: plan)
    }
}
private final class SubscriptionWindow: NSPanel {
    override var canBecomeKey: Bool { true }
}

struct SubscriptionPanel: View {
    @ObservedObject var store: SubscriptionStore
    @ObservedObject var browser: SubscriptionCancellation
    @State private var adding = false
    @State private var selectedDemoID: String?
    @State private var editingID: String?
    @State private var name = ""
    @State private var amount = ""
    @State private var date = ""
    @State private var website = ""
    private let accent = Color(red: 0.35, green: 0.94, blue: 0.64)
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Image("PeppaPriceLogo").resizable().scaledToFit().frame(width: 34, height: 34)
                    Text("Subscriptions").font(.title2.weight(.semibold))
                    Spacer()
                    Button { adding.toggle() } label: { Image(systemName: "plus") }
                        .help("Add a real subscription").accessibilityLabel("Add subscription")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(store.active.count) subscriptions")
                        .font(.headline).monospacedDigit()
                    Text("\(store.active.filter { SubscriptionRules.soon($0) }.count) recorded renewals in the next 14 days")
                        .font(.subheadline).foregroundStyle(.secondary)
                    DisclosureGroup("Data sources") {
                        Text("Sample services use illustrative prices. User-added entries and Nessie bill candidates are tracked separately.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.font(.caption)
                }
                if let error = store.error { Text(error).font(.callout).foregroundStyle(.orange) }
                if adding { addForm }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if store.items.isEmpty {
                            ContentUnavailableView("Your subscription list starts here", systemImage: "repeat",
                                description: Text("Add a subscription with its renewal date and provider's account URL."))
                        }
                        ForEach(store.items.filter { $0.decision != .ignored }.sorted { $0.nextCharge < $1.nextCharge }) { item in
                            subscriptionRow(item)
                            Divider().padding(.vertical, 16)
                        }
                    }
                }
                Text("Renewal dates are recorded dates, not a guarantee of the next charge. Past dates need verification.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(24).frame(minWidth: 340, idealWidth: 400, maxWidth: 440)
            Divider()
            VStack(alignment: .leading, spacing: 0) {
                if let item = browser.selected {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(item.name).font(.title3.weight(.semibold))
                            Spacer()
                            if browser.running { Button("Stop") { browser.stop() } }
                        }
                        Text(browser.currentURL.isEmpty ? item.website : browser.currentURL)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                        Text(browser.status).font(.callout).fixedSize(horizontal: false, vertical: true)
                    }.padding(20)
                    ZStack {
                        SubscriptionWebView(webView: browser.webView)
                        if browser.running { Color.clear.contentShape(Rectangle()).onTapGesture {} }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Button(browser.running ? "Finding control…" : "Continue") { browser.resumeGuidance() }
                            .buttonStyle(.borderedProminent).tint(accent).foregroundStyle(.black)
                            .disabled(browser.running).pointerCursor(isEnabled: !browser.running)
                        Text("I’ll navigate and highlight the control. You make the cancellation click.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(20)
                } else if let item = selectedDemo {
                    demoDetail(item)
                } else {
                    Spacer()
                    VStack(alignment: .leading, spacing: 14) {
                        Image(systemName: "repeat").font(.system(size: 36, weight: .light)).foregroundStyle(accent)
                        Text("Keep what you use.").font(.title.weight(.semibold))
                        Text("Review upcoming renewals, then choose Keep or Cancel. Choose Cancel to open the provider and find its cancellation control.")
                            .foregroundStyle(.secondary)
                        Text("Sign in if needed. PeppaPrice will point out where to click.")
                            .foregroundStyle(.secondary)
                    }.frame(maxWidth: 380).padding(32)
                    Spacer()
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(red: 0.07, green: 0.085, blue: 0.09))
        .preferredColorScheme(.dark)
    }
    private var selectedDemo: ManagedSubscription? {
        if let selectedDemoID, let item = store.items.first(where: { $0.id == selectedDemoID && $0.source == .demo }) { return item }
        return store.urgentDemoRenewal ?? store.items.first(where: { $0.source == .demo && $0.isActive })
    }

    private func serviceIcon(_ item: ManagedSubscription, size: CGFloat) -> some View {
        let asset: String? = item.source == .demo ? (
            item.id.hasSuffix(":spotify") ? "SubscriptionSpotify" :
            item.id.hasSuffix(":netflix") ? "SubscriptionNetflix" :
            item.id.hasSuffix(":icloud") ? "SubscriptionICloud" : nil) : nil
        return Group {
            if let asset {
                Image(asset).resizable().scaledToFit()
            } else {
                Image(systemName: "repeat").resizable().scaledToFit().padding(size * 0.24)
                    .foregroundStyle(accent).background(.white.opacity(0.06))
            }
        }.frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: size * 0.22))
            .accessibilityLabel("\(item.name) icon")
    }

    private func demoDetail(_ item: ManagedSubscription) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 16) {
                    serviceIcon(item, size: 64)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.name).font(.system(size: 23, weight: .semibold))
                        Text("Monthly")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.decision == .cancelled ? "Review provider status" : SubscriptionRules.renewalLabel(item))
                        .font(.system(size: 32, weight: .semibold))
                    Text(item.decision == .cancelled ? "Check the provider for the current subscription status." :
                         "\(item.amount) on \(item.nextCharge). Still worth keeping?")
                        .font(.system(size: 16)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider()
                HStack(alignment: .top, spacing: 12) {
                    Image("PeppaPriceLogo").resizable().scaledToFit().frame(width: 32, height: 32)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("PeppaPrice noticed").font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
                        Text(item.decision == .keep ? "You’ve decided to keep this one." :
                             item.decision == .cancelled ? "Open the provider to review this subscription." :
                             "This renewal is coming up. Keep it, or I can find the cancellation control for you.")
                            .font(.system(size: 14)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
                    }
                }
                if item.isActive {
                    HStack(spacing: 12) {
                        Button(item.decision == .keep ? "Keeping subscription" : "Keep subscription") {
                            selectedDemoID = item.id
                            store.change(item.id, decision: .keep, note: "Keeping this mock subscription. No provider account was changed.")
                        }.buttonStyle(.borderedProminent).tint(accent).foregroundStyle(.black).pointerCursor()
                        Button("Cancel") {
                            selectedDemoID = item.id
                            browser.openGuidance(item)
                        }.buttonStyle(.bordered).pointerCursor()
                    }.disabled(browser.running || store.error != nil)
                }
                if let url = SubscriptionRules.website(item.website) {
                    Link(destination: url) {
                        Label("Open \(item.name) website", systemImage: "arrow.up.right")
                    }.font(.system(size: 13, weight: .medium)).foregroundStyle(accent).pointerCursor()
                }

            }.padding(40).frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(editingID == nil ? "Add a real subscription" : "Edit subscription").font(.headline)
            TextField("Service name", text: $name).accessibilityLabel("Service name")
            HStack {
                TextField("USD per charge", text: $amount).accessibilityLabel("Amount per charge in USD")
                TextField("YYYY-MM-DD", text: $date).accessibilityLabel("Next renewal date YYYY-MM-DD")
            }
            TextField("https://provider.com/account", text: $website).accessibilityLabel("Provider account URL")
            Text("Use the provider's actual account or subscription page. You'll sign in inside this window.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let message = store.validationError { Text(message).font(.caption).foregroundStyle(.orange) }
            HStack {
                Button("Save subscription") {
                    if store.add(name: name, amount: amount, date: date, website: website, editing: editingID) {
                        editingID = nil; adding = false; name = ""; amount = ""; date = ""; website = ""
                    }
                }.disabled(browser.running)
                Button("Dismiss") { adding = false; editingID = nil; name = ""; amount = ""; date = ""; website = "" }
            }
        }.textFieldStyle(.roundedBorder)
    }
    private func subscriptionRow(_ item: ManagedSubscription) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                serviceIcon(item, size: 40)
                if item.source == .demo {
                    Button(item.name) { browser.reset(); selectedDemoID = item.id }
                        .buttonStyle(.plain).font(.headline).pointerCursor()
                } else { Text(item.name).font(.headline) }
                Spacer()
                Text(item.amount).monospacedDigit().font(.headline)
            }
            Text(item.nextCharge.isEmpty ? "Date unknown" : item.nextCharge)
                .font(.caption).foregroundStyle(.secondary)
            if SubscriptionRules.soon(item) { Label(SubscriptionRules.renewalLabel(item), systemImage: "calendar").font(.caption).foregroundStyle(accent) }
            if !item.confirmed {
                Text("Is this a subscription?").font(.callout)
                HStack {
                    Button("Yes, track it") { store.change(item.id, decision: .review, confirm: true) }
                    Button("Not a subscription") { store.change(item.id, decision: .ignored) }
                }
            } else if item.decision == .cancelled {
                Label(item.source == .demo ? "Check provider status" : "Cancelled · receipt saved", systemImage: "checkmark.circle").foregroundStyle(accent)
            } else {
                HStack {
                    Button(item.decision == .keep ? "Keeping" : "Keep") {
                        store.change(item.id, decision: .keep, note: "You chose to continue this subscription.")
                    }
                    Button("Cancel") {
                        browser.openGuidance(item)
                    }.disabled(SubscriptionRules.website(item.website) == nil)
                    if item.source == .manual {
                        Button("Edit") {
                            browser.reset()
                            editingID = item.id; name = item.name; amount = String(format: "%.2f", Double(item.amountCents) / 100)
                            date = item.nextCharge; website = item.website; adding = true
                        }
                    }
                }.disabled(browser.running || store.error != nil)
            }
            if !item.note.isEmpty && item.source != .demo { Text(item.note).font(.caption).foregroundStyle(.secondary) }
            if !item.receipt.isEmpty && item.source != .demo {
                DisclosureGroup("Cancellation receipt") {
                    Text(item.receipt).font(.caption).textSelection(.enabled).padding(.top, 6)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
private struct SubscriptionWebView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
