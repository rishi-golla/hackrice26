import AppKit
import SwiftUI

@MainActor
final class ShoppingBasketManager {
    let store = ShoppingBasketStore()
    let checkout = ShoppingCheckoutCoordinator()
    private var verificationTask: Task<Void, Never>?
    private var verificationGeneration = UUID()
    private var panel: NSPanel?

    init() { checkout.restoreLock(on: store) }

    func show() {
        guard let screen = NSScreen.main else { return }
        let size = NSSize(width: min(720, screen.visibleFrame.width - 32), height: min(690, screen.visibleFrame.height - 40))
        if panel == nil {
            let window = ShoppingBasketWindow(contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.title = "PeppaPrice shopping basket"
            window.level = .floating
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = true
            window.hidesOnDeactivate = false
            window.isMovableByWindowBackground = true
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            let hosting = NSHostingView(rootView: ShoppingBasketView(store: store, checkout: checkout,
                onVerify: { [weak self] in self?.verifyProducts(continueToCheckout: true) },
                onAddURL: { [weak self] url in self?.addProductURL(url) },
                onClose: { [weak self] in self?.hide() }))
            hosting.sizingOptions = []
            window.contentView = hosting
            panel = window
        }
        panel?.setFrame(NSRect(x: screen.visibleFrame.maxX - size.width - 20,
            y: screen.visibleFrame.midY - size.height / 2, width: size.width, height: size.height), display: true)
        panel?.makeKeyAndOrderFront(nil)
        if !store.isLocked, store.progress == nil, store.lines.contains(where: { $0.product?.readyForDemoCheckout != true }) { verifyProducts() }
    }

    func hide() { panel?.orderOut(nil) }
    func add(_ listing: ProductSearchResult) { show(); addProductURL(listing.url, merchantHint: listing.source) }

    func verifyProducts(continueToCheckout: Bool = false) {
        guard !store.isLocked else { return }
        verificationTask?.cancel()
        let generation = UUID()
        verificationGeneration = generation
        let products = store.lines.compactMap(\.product)
        verificationTask = Task { [weak self] in
            guard let self else { return }
            defer { if verificationGeneration == generation { store.progress = nil } }
            var seen = Set<String>()
            for (index, product) in products.enumerated() where seen.insert(product.url).inserted {
                guard !Task.isCancelled, verificationGeneration == generation else { return }
                store.progress = "Reading retailer product \(index + 1) of \(products.count)…"
                do {
                    let page = try await ProductPageResolver().resolve(url: product.url, merchantHint: product.source)
                    guard !Task.isCancelled, verificationGeneration == generation else { return }
                    store.applyVerifiedPage(page, replacing: product.url)
                } catch {
                    guard !Task.isCancelled, verificationGeneration == generation else { return }
                    store.recordVerificationFailure(for: product.url, reason: error.localizedDescription)
                }
            }
            if continueToCheckout, store.readyForDemoCheckout {
                store.progress = nil
                checkout.prepare(store: store)
            }
        }
    }

    func addProductURL(_ url: String, merchantHint: String? = nil) {
        guard !store.isLocked else { return }
        verificationTask?.cancel()
        let generation = UUID()
        verificationGeneration = generation
        verificationTask = Task { [weak self] in
            guard let self else { return }
            store.progress = "Reading the product’s page, photo, and price…"
            defer { if verificationGeneration == generation { store.progress = nil } }
            do {
                let page = try await ProductPageResolver().resolve(url: url, merchantHint: merchantHint)
                guard !Task.isCancelled, verificationGeneration == generation else { return }
                store.addVerifiedPage(page)
            } catch {
                guard !Task.isCancelled, verificationGeneration == generation else { return }
                store.message = error.localizedDescription
            }
        }
    }
}

private final class ShoppingBasketWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}

// Shared with checkout so both steps feel like the companion panel.
enum ShoppingPanelStyle {
    static let mint = Color(red: 0.35, green: 0.94, blue: 0.64)
    static let secondary = Color(red: 0.65, green: 0.67, blue: 0.73)

    static var background: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            LinearGradient(colors: [Color(red: 0.14, green: 0.15, blue: 0.19).opacity(0.88),
                Color(red: 0.065, green: 0.07, blue: 0.085).opacity(0.94)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    static func header(_ title: String, subtitle: String, onClose: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image("PeppaPriceLogo").resizable().interpolation(.none).scaledToFit()
                .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 9)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 21, weight: .semibold)).foregroundStyle(.white)
                Text(subtitle).font(.system(size: 12)).foregroundStyle(secondary)
            }
            Spacer(minLength: 8)
            Button(action: onClose) { Image(systemName: "xmark").frame(width: 32, height: 32) }
                .buttonStyle(ShoppingQuietButtonStyle()).pointerCursor().accessibilityLabel("Close " + title).help("Close (Escape)")
        }.padding(24)
    }
}

struct ShoppingQuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        ShoppingQuietButtonBody(configuration: configuration, isEnabled: isEnabled)
    }
    private struct ShoppingQuietButtonBody: View {
        let configuration: Configuration
        let isEnabled: Bool
        @State private var hovered = false
        var body: some View {
            configuration.label
                .foregroundStyle(Color.white.opacity(isEnabled ? 0.85 : 0.35))
                .background(.white.opacity(configuration.isPressed ? 0.12 : (hovered && isEnabled ? 0.08 : 0.035)), in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(.white.opacity(hovered && isEnabled ? 0.18 : 0.08)))
                .onHover { hovered = $0 }
        }
    }
}

struct ShoppingPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        ShoppingPrimaryButtonBody(configuration: configuration, isEnabled: isEnabled)
    }
    private struct ShoppingPrimaryButtonBody: View {
        let configuration: Configuration
        let isEnabled: Bool
        @State private var hovered = false
        var body: some View {
            configuration.label.font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 46)
                .foregroundStyle(Color(red: 0.06, green: 0.1, blue: 0.08))
                .background(ShoppingPanelStyle.mint.opacity(configuration.isPressed ? 0.75 : (hovered ? 0.9 : 1)), in: RoundedRectangle(cornerRadius: 12))
                .opacity(isEnabled ? 1 : 0.4).onHover { hovered = $0 }
        }
    }
}

struct ShoppingProductImage: View {
    let url: String?
    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            if let image = phase.image { image.resizable().scaledToFit().padding(6) }
            else { Image(systemName: "bag").font(.system(size: 22, weight: .light)).foregroundStyle(ShoppingPanelStyle.secondary) }
        }.frame(width: 64, height: 72).background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
            .accessibilityHidden(true)
    }
}

struct ShoppingBasketView: View {
    @ObservedObject var store: ShoppingBasketStore
    @ObservedObject var checkout: ShoppingCheckoutCoordinator
    let onVerify: () -> Void
    let onAddURL: (String) -> Void
    let onClose: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var productURL = ""
    @State private var expandedDetails = Set<UUID>()
    private let accent = ShoppingPanelStyle.mint
    private let secondary = ShoppingPanelStyle.secondary

    var body: some View {
        Group {
            if checkout.draft != nil {
                ShoppingCheckoutView(checkout: checkout, store: store, onClose: onClose)
            } else { basketContent }
        }.onAppear { checkout.restoreLock(on: store) }
    }

    private var basketContent: some View {
        VStack(spacing: 0) {
            ShoppingPanelStyle.header("Your basket", subtitle: store.lines.isEmpty ? "PeppaPrice · Shopping made simple" : "\(store.itemCount) items · \(store.merchants.count) stores · \(store.isSaved ? "Saved" : "Not saved")", onClose: onClose)
            HStack(spacing: 10) {
                Image(systemName: "link").foregroundStyle(secondary)
                TextField("Add a product link", text: $productURL)
                    .textFieldStyle(.plain).font(.system(size: 13)).onSubmit(addURL)
                    .accessibilityLabel("Retailer product URL")
                Button(action: addURL) { Image(systemName: "plus").frame(width: 30, height: 30) }
                    .buttonStyle(ShoppingQuietButtonStyle()).pointerCursor().accessibilityLabel("Add product")
                    .disabled(productURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.progress != nil)
            }.padding(10).background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.12)))
                .padding(.horizontal, 24).padding(.bottom, 18).disabled(store.isLocked || checkout.isBusy)
            if let progress = store.progress {
                HStack(spacing: 10) { ProgressView().controlSize(.small); Text(progress); Spacer() }
                    .font(.system(size: 12)).foregroundStyle(secondary).padding(.horizontal, 24).padding(.bottom, 14)
            }
            if let message = store.message {
                HStack(alignment: .top) {
                    Text(message).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button { store.message = nil } label: { Image(systemName: "xmark").frame(width: 24, height: 24) }
                        .buttonStyle(ShoppingQuietButtonStyle()).pointerCursor().accessibilityLabel("Dismiss message")
                }.font(.system(size: 12)).foregroundStyle(.orange).padding(.horizontal, 24).padding(.bottom, 14)
            }
            if store.lines.isEmpty { emptyState } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        ForEach(store.merchants, id: \.self) { merchant in merchantSection(merchant) }
                    }.padding(.horizontal, 24).padding(.bottom, 24)
                }.frame(minHeight: 0, maxHeight: .infinity)
                summary
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white).background(ShoppingPanelStyle.background)
        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 19).strokeBorder(.white.opacity(0.18)))
        .preferredColorScheme(.dark)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: store.lines.map(\.id))
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "basket").font(.system(size: 36, weight: .light)).foregroundStyle(secondary)
            Text("What’s on your list?").font(.system(size: 21, weight: .semibold))
            Text("Ask PeppaPrice to find something, or add a product link above.")
                .font(.system(size: 13)).foregroundStyle(secondary)
            Spacer()
        }.multilineTextAlignment(.center).padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func merchantSection(_ merchant: String) -> some View {
        let lines = store.lines.filter { $0.product?.merchant == merchant }
        return VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(merchant, systemImage: "storefront").font(.system(size: 13, weight: .medium)).foregroundStyle(secondary)
                Spacer()
                Text(lines.contains { $0.subtotalCents == nil } ? "Price to confirm" : BasketProduct.money(lines.compactMap(\.subtotalCents).reduce(0, +)))
                    .font(.system(size: 12)).monospacedDigit().foregroundStyle(secondary)
            }
            ForEach(lines) { line in lineRow(line) }
        }
    }

    private func lineRow(_ line: ShoppingBasketLine) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                ShoppingProductImage(url: line.product?.imageURL)
                VStack(alignment: .leading, spacing: 8) {
                    Text(line.product?.title ?? line.query).font(.system(size: 14, weight: .medium))
                        .lineLimit(2).help(line.product?.title ?? line.query)
                    if let product = line.product {
                        HStack(spacing: 8) {
                            Text("\(product.price) each")
                            if product.verifiedPage?.availability == .outOfStock { Text("Out of stock").foregroundStyle(.orange) }
                            else if !product.readyForDemoCheckout { Text("Needs verification").foregroundStyle(.orange) }
                        }.font(.system(size: 12)).foregroundStyle(secondary)
                    } else {
                        Text(line.options.isEmpty ? "No match yet. Try another search." : "Select a match to continue.")
                            .font(.system(size: 12)).foregroundStyle(secondary)
                    }
                    HStack(spacing: 10) {
                        quantityControl(line)
                        if !line.options.isEmpty {
                            Menu(line.product == nil ? "Choose item" : "Alternatives") {
                                ForEach(line.options.filter { $0.readyForDemoCheckout }) { option in
                                    Button("\(option.price) · \(option.merchant) · \(option.title)") { store.select(option.url, for: line.id) }
                                }
                            }.menuStyle(.borderlessButton).fixedSize().font(.system(size: 12)).pointerCursor()
                        }
                        Spacer(minLength: 0)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 12) {
                    Text(line.subtotalCents.map(BasketProduct.money) ?? "—").font(.system(size: 14, weight: .semibold)).monospacedDigit()
                    Button { store.remove(line.id) } label: { Image(systemName: "xmark").font(.system(size: 10)).frame(width: 26, height: 26) }
                        .buttonStyle(ShoppingQuietButtonStyle()).pointerCursor().accessibilityLabel("Remove \(line.query)")
                }
            }
            HStack(spacing: 14) {
                if let product = line.product, let url = product.listingURL {
                    Link(destination: url) { Label("View product", systemImage: "arrow.up.right") }
                        .foregroundStyle(secondary).pointerCursor()
                } else if line.options.isEmpty {
                    Button("Search again") {
                        var components = URLComponents(string: "https://www.google.com/search")!
                        components.queryItems = [URLQueryItem(name: "q", value: line.query)]
                        if let url = components.url { NSWorkspace.shared.open(url) }
                    }.buttonStyle(.plain).foregroundStyle(accent).pointerCursor()
                }
                if line.product != nil {
                    Button {
                        if expandedDetails.contains(line.id) { expandedDetails.remove(line.id) } else { expandedDetails.insert(line.id) }
                    } label: { Label("Details", systemImage: expandedDetails.contains(line.id) ? "chevron.up" : "chevron.down") }
                        .buttonStyle(.plain).foregroundStyle(secondary).pointerCursor()
                }
                Spacer()
            }.font(.system(size: 11)).padding(.leading, 78)
            if expandedDetails.contains(line.id), let product = line.product {
                VStack(alignment: .leading, spacing: 5) {
                    Text("For \(line.query)")
                    if let page = product.verifiedPage {
                        Text("Price checked \(page.observedAt.formatted(date: .abbreviated, time: .shortened)). Confirm size, color and availability with the store.")
                        if !page.limitations.isEmpty { Text(page.limitations.joined(separator: " ")) }
                    } else { Text(store.verificationIssues[product.url] ?? "Retailer price not verified yet.") }
                    if let delivery = product.deliveryInfo { Text(delivery) }
                }.font(.system(size: 12)).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true).padding(.leading, 78)
            }
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.top, 4)
        }.disabled(store.isLocked || checkout.isBusy)
    }

    private func quantityControl(_ line: ShoppingBasketLine) -> some View {
        HStack(spacing: 0) {
            Button { store.setQuantity(line.quantity - 1, for: line.id) } label: { Image(systemName: "minus").frame(width: 26, height: 26) }
                .disabled(line.quantity <= 1).accessibilityLabel("Decrease quantity for \(line.query)")
            Text("\(line.quantity)").font(.system(size: 12, weight: .medium)).monospacedDigit().frame(minWidth: 24)
            Button { store.setQuantity(line.quantity + 1, for: line.id) } label: { Image(systemName: "plus").frame(width: 26, height: 26) }
                .disabled(line.quantity >= 99).accessibilityLabel("Increase quantity for \(line.query)")
        }.font(.system(size: 10)).buttonStyle(.plain).pointerCursor()
            .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
    }

    private var summary: some View {
        VStack(spacing: 14) {
            Rectangle().fill(.white.opacity(0.13)).frame(height: 1)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.hasIncompletePrices ? "Known subtotal" : "Item subtotal").font(.system(size: 13)).foregroundStyle(secondary)
                    Text("Shipping and tax excluded").font(.system(size: 11)).foregroundStyle(secondary)
                }
                Spacer()
                Text(BasketProduct.money(store.estimatedSubtotalCents)).font(.system(size: 28, weight: .semibold)).monospacedDigit()
            }
            Button {
                if store.readyForDemoCheckout { checkout.prepare(store: store) } else { onVerify() }
            } label: {
                HStack(spacing: 8) {
                    if checkout.isBusy { ProgressView().controlSize(.small) }
                    Text(checkout.isBusy ? "Preparing…" : "Buy it")
                    if !checkout.isBusy { Image(systemName: "arrow.right") }
                }
            }.buttonStyle(ShoppingPrimaryButtonStyle()).pointerCursor()
                .disabled(store.merchants.isEmpty || store.progress != nil || checkout.isBusy || store.isLocked)
            Text("Sandbox checkout · No real retailer orders")
                .font(.system(size: 11)).foregroundStyle(secondary)
        }.padding(.horizontal, 24).padding(.bottom, 20)
    }

    private func addURL() {
        let value = productURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        onAddURL(value)
        productURL = ""
    }
}
