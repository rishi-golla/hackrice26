// Run without rebuilding or re-signing the app:
// swiftc -swift-version 5 leanring-buddy/ElevenLabsTTSClient.swift scripts/test-voice-playback.swift -o /tmp/flicky-voice-tests && /tmp/flicky-voice-tests
import AVFoundation
import Foundation

private final class VoiceResponseStub: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        if request.url!.path == "/unavailable" {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let statusCode = request.url!.path == "/invalid-audio" ? 200 : 402
        let response = HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("provider unavailable".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@main
struct VoicePlaybackRegressionTests {
    @MainActor
    static func main() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VoiceResponseStub.self]
        let session = URLSession(configuration: configuration)

        let selectedVoice = ElevenLabsTTSClient.preferredSystemVoice()
        let bestInstalledQuality = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language == "en-US" }.map { $0.quality.rawValue }.max()
        precondition(selectedVoice?.quality.rawValue == bestInstalledQuality,
                     "Fallback must select the highest installed voice quality")
        print("Selected voice: \(selectedVoice?.name ?? "unavailable")")

        for path in ["payment-required", "unavailable", "invalid-audio"] {
            let client = ElevenLabsTTSClient(proxyURL: "https://voice.test/\(path)", session: session)
            var completionCount = 0
            try await client.speakText("Voice fallback test.") { completionCount += 1 }
            precondition(client.isPlaying, "\(path) must start system speech")
            client.stopPlayback()
            precondition(!client.isPlaying, "Stop must clear fallback playback")
            precondition(completionCount == 0, "Stopping must not finish an old response")
        }

        let client = ElevenLabsTTSClient(proxyURL: "https://voice.test/payment-required", session: session)
        let cancelledRequest = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            try await client.speakText("Cancelled speech must not play.")
        }
        do {
            try await cancelledRequest.value
            preconditionFailure("Cancelled speech should throw")
        } catch is CancellationError {}
        precondition(!client.isPlaying, "Cancellation must not trigger fallback")

        var emptyTextFinished = false
        try await client.speakText("  ") { emptyTextFinished = true }
        precondition(emptyTextFinished && !client.isPlaying)
        print("PASS: billing, network, invalid audio, stop, cancellation, and empty text")
    }
}
