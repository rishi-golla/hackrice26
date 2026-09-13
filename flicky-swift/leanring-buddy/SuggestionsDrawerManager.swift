// SuggestionsDrawerManager.swift — Flicky right-edge shopping suggestions drawer
//
// A slide-in NSPanel anchored to the right edge of the main screen showing every
// listing Flicky has found for the current question, as a scrollable list of
// minimal cards (photo, price, delivery estimate, source, clickable link).
//
// This is intentionally separate from the menu bar panel (CompanionPanelView),
// which shows only account/financial info per the product split: the menu bar
// widget is "my bank account", this drawer is "what Flicky is shopping for me."

import AppKit
import Combine
import SwiftUI

extension Notification.Name {
    static let flickyDismissSuggestionsDrawer = Notification.Name("flickyDismissSuggestionsDrawer")
}

// MARK: - View Model

@MainActor
final class SuggestionsDrawerViewModel: ObservableObject {
    @Published var listings: [ProductSearchResult] = []
    @Published var query: String = ""
    @Published var isVisible: Bool = false
}

// MARK: - Drawer Manager

@MainActor
final class SuggestionsDrawerManager: NSObject {
    private let viewModel = SuggestionsDrawerViewModel()
    private var drawerPanel: NSPanel?
    private var dismissObserver: NSObjectProtocol?

    // The drawer takes up roughly one seventh of the screen's width, per the
    // user's request, so it reads as a slim side rail rather than a full panel.
    private let drawerWidthFraction: CGFloat = 1.0 / 7.0

    override init() {
        super.init()
        dismissObserver = NotificationCenter.default.addObserver(
            forName: .flickyDismissSuggestionsDrawer,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.hide()
        }
    }

    deinit {
        if let dismissObserver {
            NotificationCenter.default.removeObserver(dismissObserver)
        }
    }

    /// Shows (or updates) the drawer with the current list of listings. Safe to
    /// call repeatedly as new search rounds add more listings — the drawer just
    /// refreshes its contents in place instead of re-animating in each time.
    func show(listings: [ProductSearchResult], query: String) {
        viewModel.listings = listings
        viewModel.query = query

        let wasAlreadyVisible = viewModel.isVisible
        viewModel.isVisible = true

        guard let targetScreen = NSScreen.main else { return }
        createPanelIfNeeded(onScreen: targetScreen)
        resizePanelToScreen(targetScreen)

        guard let panel = drawerPanel else { return }

        if wasAlreadyVisible {
            panel.orderFrontRegardless()
            return
        }

        // Slide in from off-screen to the right, so its arrival visibly reads as
        // Flicky surfacing suggestions rather than content just popping into view.
        let finalFrame = panel.frame
        var startFrame = finalFrame
        startFrame.origin.x = targetScreen.frame.maxX
        panel.setFrame(startFrame, display: false)
        panel.alphaValue = 1
        panel.orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.32
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(finalFrame, display: true)
        }
    }

    func hide() {
        guard let panel = drawerPanel, viewModel.isVisible else { return }
        viewModel.isVisible = false

        guard let targetScreen = NSScreen.main else {
            panel.orderOut(nil)
            return
        }

        var offscreenFrame = panel.frame
        offscreenFrame.origin.x = targetScreen.frame.maxX

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.25
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().setFrame(offscreenFrame, display: true)
        }, completionHandler: {
            panel.orderOut(nil)
        })
    }

    // MARK: - Private

    private func createPanelIfNeeded(onScreen screen: NSScreen) {
        if drawerPanel != nil { return }

        let width = screen.frame.width * drawerWidthFraction
        let initialFrame = NSRect(
            x: screen.frame.maxX - width,
            y: screen.visibleFrame.minY,
            width: width,
            height: screen.visibleFrame.height
        )

        let panel = NSPanel(
            contentRect: initialFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isExcludedFromWindowsMenu = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let hostingView = NSHostingView(rootView: SuggestionsDrawerView(viewModel: viewModel))
        hostingView.frame = NSRect(origin: .zero, size: initialFrame.size)
        panel.contentView = hostingView

        drawerPanel = panel
    }

    private func resizePanelToScreen(_ screen: NSScreen) {
        guard let panel = drawerPanel else { return }
        let width = screen.frame.width * drawerWidthFraction
        let frame = NSRect(
            x: screen.frame.maxX - width,
            y: screen.visibleFrame.minY,
            width: width,
            height: screen.visibleFrame.height
        )
        panel.setFrame(frame, display: true)
        panel.contentView?.frame = NSRect(origin: .zero, size: frame.size)
    }
}

// MARK: - SwiftUI View

private struct SuggestionsDrawerView: View {
    @ObservedObject var viewModel: SuggestionsDrawerViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            Divider()
                .background(DS.Colors.borderSubtle)

            if viewModel.listings.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.listings) { listing in
                            SuggestionListingCard(listing: listing)
                        }
                    }
                    .padding(10)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(DS.Colors.background)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Suggestions")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DS.Colors.textPrimary)
                Spacer()
                Button(action: {
                    NotificationCenter.default.post(name: .flickyDismissSuggestionsDrawer, object: nil)
                }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(DS.Colors.textTertiary)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(Color.white.opacity(0.08)))
                }
                .buttonStyle(.plain)
                .pointerCursor()
            }
            if !viewModel.query.isEmpty {
                Text("\"\(viewModel.query)\"")
                    .font(.system(size: 10))
                    .foregroundColor(DS.Colors.textTertiary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Spacer()
            Image(systemName: "bag")
                .font(.system(size: 20))
                .foregroundColor(DS.Colors.textTertiary)
            Text("No matches returned")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(DS.Colors.textPrimary)
            Text("Try a more specific product name, or continue with a web search.")
                .font(.system(size: 12))
                .foregroundColor(DS.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
            Button("Search the web") {
                var components = URLComponents(string: "https://www.google.com/search")!
                components.queryItems = [URLQueryItem(name: "q", value: viewModel.query)]
                if let url = components.url { NSWorkspace.shared.open(url) }
            }
            .buttonStyle(.bordered)
            .pointerCursor()
            .padding(.top, 10)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A minimal card for one suggested listing: photo, price, delivery estimate,
/// source, and a link that opens the original listing URL.
private struct SuggestionListingCard: View {
    let listing: ProductSearchResult

    var body: some View {
        Button(action: {
            guard let url = URL(string: listing.url) else { return }
            NSWorkspace.shared.open(url)
        }) {
            VStack(alignment: .leading, spacing: 6) {
                listingImage

                Text(listing.title)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(DS.Colors.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack {
                    Text(listing.price)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(DS.Colors.textPrimary)
                    Spacer()
                    if listing.isUsed {
                        Text("USED")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundColor(DS.Colors.blue400)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(DS.Colors.blue400.opacity(0.15)))
                    }
                }

                Text(listing.source)
                    .font(.system(size: 9))
                    .foregroundColor(DS.Colors.textTertiary)
                    .lineLimit(1)

                if let deliveryInfo = listing.deliveryInfo, !deliveryInfo.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "shippingbox")
                            .font(.system(size: 8))
                        Text(deliveryInfo)
                            .font(.system(size: 9))
                            .lineLimit(1)
                    }
                    .foregroundColor(DS.Colors.textTertiary)
                }

                HStack(spacing: 4) {
                    Text("View listing")
                        .font(.system(size: 9, weight: .semibold))
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 8))
                }
                .foregroundColor(DS.Colors.blue400)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(listing.isUsed ? DS.Colors.blue400.opacity(0.05) : Color.white.opacity(0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(listing.isUsed ? DS.Colors.blue400.opacity(0.2) : DS.Colors.borderSubtle, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .pointerCursor()
    }

    @ViewBuilder
    private var listingImage: some View {
        // The photo is pulled directly from the original listing's own image
        // URL — there is no server-side caching or proxying, just a straight
        // AsyncImage load — so it always matches what the user would see if
        // they clicked through themselves.
        if let imageURLString = listing.imageURL, let imageURL = URL(string: imageURLString) {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    listingImagePlaceholder
                case .empty:
                    listingImagePlaceholder
                        .overlay(ProgressView().scaleEffect(0.6))
                @unknown default:
                    listingImagePlaceholder
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 90)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        } else {
            listingImagePlaceholder
                .frame(height: 90)
        }
    }

    private var listingImagePlaceholder: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color.white.opacity(0.06))
            .overlay(
                Image(systemName: "photo")
                    .font(.system(size: 16))
                    .foregroundColor(DS.Colors.textTertiary)
            )
    }
}
