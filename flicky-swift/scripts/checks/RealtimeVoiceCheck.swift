// Live integration check: uses a short synthesized input fixture, never the microphone.
// swiftc -swift-version 5 leanring-buddy/RealtimeVoiceClient.swift leanring-buddy/BuddyAudioConversionSupport.swift scripts/checks/RealtimeVoiceCheck.swift -o /tmp/flicky-realtime-check
// /tmp/flicky-realtime-check /tmp/flicky-realtime-input.aiff
import AVFoundation
import AppKit
import Foundation

@main
struct RealtimeVoiceCheck {
    @MainActor
    static func main() async throws {
        guard let configuration = FlickyRealtimeConfiguration.load() else { fatalError("Missing local Realtime configuration") }
        let textInput = CommandLine.arguments.dropFirst().first == "--text"
        var audio: Data?
        if !textInput {
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
            let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
            try file.read(into: buffer)
            audio = BuddyPCM16AudioConverter(targetSampleRate: 24000).convertToPCM16Data(from: buffer)!
        }
        let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let imageData = image.representation(using: .jpeg, properties: [:])!
        let client = RealtimeVoiceClient(configuration: configuration)
        var completion = false
        var spokenReply = ""
        var capturedTranscript = ""
        var failure: String?
        var researchCalls = 0
        var configuredVoice = ""
        client.onSessionConfigured = { model, voice in
            configuredVoice = voice
            print("SESSION: \(model), voice: \(voice)")
        }
        client.onResearch = { _ in researchCalls += 1; return "Synthetic test result: the verification code is bluebird. This is a connection test, not financial data." }
        client.onCompleted = { transcript, reply in completion = true; capturedTranscript = transcript; spokenReply = reply }
        client.onError = { failure = $0 }
        client.start(recordedAudio: audio, text: textInput ? "Analyze my spending" : nil) {
            FlickyRealtimeContext(instructions: "This is an integration test. Call research_financial_question exactly once before answering. Then say the verification code it returned, in one short sentence. Speak warmly.",
                history: [(user: "Hello, can you help me with my budget?", assistant: "Sure. What would you like to check?")],
                images: [(data: imageData, label: "Synthetic screen fixture")])
        }
        let deadline = Date().addingTimeInterval(55)
        while client.isActive && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
        client.cancel()
        if let failure { fatalError(failure) }
        precondition(configuredVoice == "marin", "Unexpected voice")
        precondition(completion, "Voice playback did not finish")
        precondition(researchCalls == 1, "Research tool was not called exactly once")
        precondition(spokenReply.lowercased().contains("bluebird"), "Tool result did not reach the spoken answer")
        precondition(!capturedTranscript.isEmpty, "Input transcript was not received")
        print("PASS: conversation history, screen image, text/audio input, research tool round trip, streamed speech playback, transcript, and completion")
        client.start(text: "Cancel this test") { FlickyRealtimeContext(instructions: "Reply briefly.", history: [], images: []) }
        client.cancel()
        try await Task.sleep(for: .milliseconds(100))
        precondition(!client.isActive, "Cancelled request stayed active")
        print("PASS: cancellation during connection")
    }
}
