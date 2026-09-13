//
//  ElevenLabsTTSClient.swift
//  leanring-buddy
//
//  Streams text-to-speech audio from ElevenLabs and plays it back
//  through the system audio output. Uses the streaming endpoint so
//  playback begins before the full audio has been generated.
//

import AVFoundation
import Foundation

@MainActor
final class ElevenLabsTTSClient: NSObject, @preconcurrency AVAudioPlayerDelegate, @preconcurrency AVSpeechSynthesizerDelegate {
    private let proxyURL: URL
    private let session: URLSession

    /// The audio player for the current TTS playback. Kept alive so the
    /// audio finishes playing even if the caller doesn't hold a reference.
    private var audioPlayer: AVAudioPlayer?
    private var playbackFinished: (() -> Void)?
    private let speechSynthesizer = AVSpeechSynthesizer()
    private var activeUtterance: AVSpeechUtterance?
    private var playbackRequestIdentifier = UUID()

    init(proxyURL: String, session: URLSession? = nil) {
        self.proxyURL = URL(string: proxyURL)!

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = session ?? URLSession(configuration: configuration)
    }

    /// Sends `text` to ElevenLabs TTS and plays the resulting audio.
    /// Falls back to the system voice when remote synthesis fails.
    func speakText(_ text: String, onPlaybackFinished: (() -> Void)? = nil) async throws {
        stopPlayback()
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            onPlaybackFinished?()
            return
        }
        let requestIdentifier = playbackRequestIdentifier
        do {
            try await playRemoteSpeech(text, requestIdentifier: requestIdentifier, onPlaybackFinished: onPlaybackFinished)
        } catch {
            try Task.checkCancellation()
            guard requestIdentifier == playbackRequestIdentifier else { throw CancellationError() }
            print("⚠️ ElevenLabs TTS unavailable; using system voice: \(error.localizedDescription)")
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = Self.preferredSystemVoice()
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.88
            speechSynthesizer.delegate = self
            activeUtterance = utterance
            playbackFinished = onPlaybackFinished
            speechSynthesizer.speak(utterance)
        }
    }

    private func playRemoteSpeech(_ text: String, requestIdentifier: UUID, onPlaybackFinished: (() -> Void)?) async throws {
        try Task.checkCancellation()
        var request = URLRequest(url: proxyURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("audio/mpeg", forHTTPHeaderField: "Accept")

        let body: [String: Any] = [
            "text": text,
            "model_id": "eleven_flash_v2_5",
            "voice_settings": [
                "stability": 0.5,
                "similarity_boost": 0.75,
                "speed": 0.88
            ]
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "ElevenLabsTTS", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "ElevenLabsTTS", code: httpResponse.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "TTS API error (\(httpResponse.statusCode)): \(errorBody)"])
        }

        try Task.checkCancellation()
        guard requestIdentifier == playbackRequestIdentifier else { throw CancellationError() }

        let player = try AVAudioPlayer(data: data)
        player.delegate = self
        self.audioPlayer = player
        self.playbackFinished = onPlaybackFinished
        guard player.play() else {
            self.audioPlayer = nil
            self.playbackFinished = nil
            throw NSError(domain: "ElevenLabsTTS", code: -2,
                          userInfo: [NSLocalizedDescriptionKey: "Could not start audio playback"])
        }
        print("🔊 ElevenLabs TTS: playing \(data.count / 1024)KB audio")
    }

    static func preferredSystemVoice() -> AVSpeechSynthesisVoice? {
        let voices = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.language == "en-US" && $0.quality.rawValue > AVSpeechSynthesisVoiceQuality.default.rawValue
        }
        // Explicit selection avoids macOS silently using its compact default voice.
        return voices.sorted {
            if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
            let firstIsAva = $0.name.hasPrefix("Ava")
            let secondIsAva = $1.name.hasPrefix("Ava")
            if firstIsAva != secondIsAva { return firstIsAva }
            return $0.identifier < $1.identifier
        }.first ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    /// Whether remote or system speech is currently playing back.
    var isPlaying: Bool {
        (audioPlayer?.isPlaying ?? false) || activeUtterance != nil
    }

    /// Stops any in-progress playback immediately.
    func stopPlayback() {
        playbackRequestIdentifier = UUID()
        activeUtterance = nil
        speechSynthesizer.stopSpeaking(at: .immediate)
        audioPlayer?.stop()
        audioPlayer = nil
        playbackFinished = nil
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === audioPlayer else { return }
        audioPlayer = nil
        let callback = playbackFinished
        playbackFinished = nil
        callback?()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard utterance === activeUtterance else { return }
        activeUtterance = nil
        let callback = playbackFinished
        playbackFinished = nil
        callback?()
    }
}
