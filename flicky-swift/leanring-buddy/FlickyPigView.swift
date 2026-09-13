import AppKit
import ImageIO
import SwiftUI

/// The supplied wing-flap animation, decoded once and shared across displays.
/// Only background pixels connected to the edge are made transparent, preserving
/// the pale blue highlights inside the pig. The original GIF remains untouched.
private struct PigAnimation {
    let frames: [CGImage]
    let durations: [Double]
    var duration: Double { durations.reduce(0, +) }

    static let shared: PigAnimation = {
        guard let url = Bundle.main.url(forResource: "FlickyPig", withExtension: "gif"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
            return PigAnimation(frames: [], durations: [])
        }
        var images: [CGImage] = []
        var durations: [Double] = []
        var bounds = CGRect.null
        let side = 192
        for index in 0..<CGImageSourceGetCount(source) {
            guard let image = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
            var pixels = [UInt8](repeating: 0, count: side * side * 4)
            let result: CGImage? = pixels.withUnsafeMutableBytes { bytes in
                guard let context = CGContext(data: bytes.baseAddress, width: side, height: side,
                    bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
                context.interpolationQuality = .none
                context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
                let data = bytes.bindMemory(to: UInt8.self)
                let background = (Int(data[0]), Int(data[1]), Int(data[2]))
                var visited = [Bool](repeating: false, count: side * side)
                var queue = Array(0..<side) + Array((side * (side - 1))..<(side * side))
                for y in 1..<(side - 1) { queue.append(y * side); queue.append(y * side + side - 1) }
                var head = 0
                while head < queue.count {
                    let p = queue[head]; head += 1
                    guard !visited[p] else { continue }
                    visited[p] = true
                    let b = p * 4
                    guard abs(Int(data[b]) - background.0) < 24,
                          abs(Int(data[b + 1]) - background.1) < 24,
                          abs(Int(data[b + 2]) - background.2) < 24 else { continue }
                    data[b] = 0; data[b + 1] = 0; data[b + 2] = 0; data[b + 3] = 0
                    let x = p % side, y = p / side
                    if x > 0 { queue.append(p - 1) }
                    if x < side - 1 { queue.append(p + 1) }
                    if y > 0 { queue.append(p - side) }
                    if y < side - 1 { queue.append(p + side) }
                }
                for p in 0..<(side * side) where data[p * 4 + 3] > 0 {
                    bounds = bounds.union(CGRect(x: p % side, y: p / side, width: 1, height: 1))
                }
                return context.makeImage()
            }
            guard let result else { continue }
            images.append(result)
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            durations.append(max(0.04, gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double
                ?? gif?[kCGImagePropertyGIFDelayTime] as? Double ?? 0.1))
        }
        return PigAnimation(frames: images.compactMap { $0.cropping(to: bounds) }, durations: durations)
    }()

    func frame(at time: Double) -> CGImage? {
        guard !frames.isEmpty, duration > 0 else { return nil }
        var remaining = time.truncatingRemainder(dividingBy: duration)
        for (index, delay) in durations.enumerated() {
            if remaining < delay { return frames[min(index, frames.count - 1)] }
            remaining -= delay
        }
        return frames[0]
    }
}

struct FlickyPigView: View {
    let voiceState: FlickyVoiceState
    let audioPower: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15, paused: reduceMotion)) { timeline in
            let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            VStack(spacing: 3) {
                if let frame = PigAnimation.shared.frame(at: time) {
                    Image(decorative: frame, scale: 1)
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                        .frame(width: 62, height: 48)
                }
                HStack(spacing: 4) {
                    ForEach(0..<3) { index in
                        Circle()
                            .fill(Color(red: 1, green: 0.65, blue: 0.70))
                            .frame(width: 4, height: 4)
                            .scaleEffect(dotScale(index, time: time))
                    }
                }
                .frame(width: 28, height: 10)
                .background(.black.opacity(0.75), in: Capsule())
                .opacity(voiceState == .idle ? 0 : 1)
            }
        }
        .accessibilityLabel("PeppaPrice pet")
        .allowsHitTesting(false)
    }

    private func dotScale(_ index: Int, time: Double) -> CGFloat {
        guard !reduceMotion else { return 1 }
        if voiceState == .listening { return 1 + min(max(audioPower, 0), 1) * (index == 1 ? 0.9 : 0.5) }
        return 0.75 + 0.5 * CGFloat((sin(time * 5 - Double(index) * 0.9) + 1) / 2)
    }
}
