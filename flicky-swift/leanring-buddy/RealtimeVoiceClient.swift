import AVFoundation
import Foundation

struct FlickyRealtimeConfiguration: Decodable {
    let endpoint: URL
    let accessToken: String

    static func load() -> Self? {
        guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let data = try? Data(contentsOf: directory.appendingPathComponent("Flicky/realtime.json")),
              let configuration = try? JSONDecoder().decode(Self.self, from: data),
              configuration.endpoint.scheme == "https", !configuration.accessToken.isEmpty else { return nil }
        return configuration
    }
}

struct FlickyRealtimeContext {
    let instructions: String
    let history: [(user: String, assistant: String)]
    let images: [(data: Data, label: String)]
}

@MainActor
final class RealtimeVoiceClient {
    enum Phase { case listening, processing, speaking, idle }
    var onSessionConfigured: ((String, String) -> Void)?
    var onPhase: ((Phase) -> Void)?
    var onLevel: ((CGFloat) -> Void)?
    var onTranscript: ((String) -> Void)?
    var onReply: ((String) -> Void)?
    var onCompleted: ((String, String) -> Void)?
    var onError: ((String) -> Void)?
    var onResearch: ((String) async -> String)?

    private(set) var isActive = false
    private let configuration: FlickyRealtimeConfiguration
    private let session: URLSession
    private let microphone = AVAudioEngine()
    private let playback = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let playbackFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var socket: URLSessionWebSocketTask?
    private var connectionTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var toolTask: Task<Void, Never>?
    private var deadlineTask: Task<Void, Never>?
    private var recordingLimitTask: Task<Void, Never>?
    private var generation = UUID()
    private var hasMicrophoneTap = false
    private var ready = false
    private var finishRequested = false
    private var committed = false
    private var pendingAudio = Data()
    private var capturedByteCount = 0
    private var pendingPlaybackBuffers = 0
    private var responseFinished = false
    private var inputText: String?
    private var transcript = ""
    private var reply = ""
    private var toolCallCount = 0

    init(configuration: FlickyRealtimeConfiguration) {
        self.configuration = configuration
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.timeoutIntervalForRequest = 20
        sessionConfiguration.timeoutIntervalForResource = 120
        session = URLSession(configuration: sessionConfiguration)
        playback.attach(player)
        playback.connect(player, to: playback.mainMixerNode, format: playbackFormat)
    }

    func start(recordedAudio: Data? = nil, text: String? = nil, context: @escaping () async -> FlickyRealtimeContext) {
        cancel()
        isActive = true
        let requestGeneration = generation
        inputText = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let inputText {
            guard !inputText.isEmpty else { cancel(); return }
            transcript = inputText
            onTranscript?(inputText)
            finishRequested = true
        }
        onPhase?(inputText == nil ? .listening : .processing)
        do {
            if inputText != nil {
                // Button and typed questions use the same audio output without opening the mic.
            } else if let recordedAudio {
                capture(recordedAudio)
            } else {
                let converter = BuddyPCM16AudioConverter(targetSampleRate: 24000)
                let input = microphone.inputNode
                let format = input.outputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else {
                    throw voiceError("No microphone is available.")
                }
                input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                    guard let data = converter.convertToPCM16Data(from: buffer) else { return }
                    let level = Self.audioLevel(data)
                    DispatchQueue.main.async {
                        guard let self, self.generation == requestGeneration, self.isActive, !self.committed else { return }
                        self.capture(data)
                        self.onLevel?(level)
                    }
                }
                hasMicrophoneTap = true
                microphone.prepare()
                try microphone.start()
            }
        } catch {
            fail(error.localizedDescription)
            return
        }
        if inputText == nil {
            recordingLimitTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, let self, self.generation == requestGeneration else { return }
                self.finishInput()
            }
        }
        deadlineTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(120))
            guard !Task.isCancelled, let self, self.generation == requestGeneration else { return }
            self.fail("Voice timed out. Hold Control + Option to try again.")
        }
        connectionTask = Task { [weak self] in
            guard let self else { return }
            do {
                async let voiceContext = context()
                let credential = try await self.fetchCredential()
                let resolvedContext = await voiceContext
                try Task.checkCancellation()
                guard self.generation == requestGeneration else { return }
                try await self.connect(credential: credential, context: resolvedContext, generation: requestGeneration)
            } catch {
                guard !Task.isCancelled, self.generation == requestGeneration else { return }
                self.fail(error.localizedDescription)
            }
        }
        if recordedAudio != nil { finishInput() }
    }

    func finishInput() {
        guard isActive, !finishRequested else { return }
        finishRequested = true
        stopMicrophone()
        recordingLimitTask?.cancel()
        onLevel?(0)
        onPhase?(.processing)
        let requestGeneration = generation
        Task { [weak self] in
            // Drain tap callbacks already enqueued on the main thread before committing the last audio.
            await Task.yield()
            guard let self, self.generation == requestGeneration else { return }
            self.commitIfReady()
        }
    }

    func cancel() {
        generation = UUID()
        isActive = false
        connectionTask?.cancel()
        receiveTask?.cancel()
        sendTask?.cancel()
        toolTask?.cancel()
        deadlineTask?.cancel()
        recordingLimitTask?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        stopMicrophone()
        player.stop()
        playback.stop()
        ready = false
        finishRequested = false
        committed = false
        pendingAudio.removeAll()
        capturedByteCount = 0
        pendingPlaybackBuffers = 0
        responseFinished = false
        inputText = nil
        transcript = ""
        reply = ""
        toolCallCount = 0
        onLevel?(0)
    }

    private func stopMicrophone() {
        microphone.stop()
        if hasMicrophoneTap {
            microphone.inputNode.removeTap(onBus: 0)
            hasMicrophoneTap = false
        }
    }

    private func capture(_ data: Data) {
        // 30 seconds of mono PCM16 at 24 kHz; bound buffering even during a slow handshake.
        guard capturedByteCount + data.count <= 1_440_000 else { finishInput(); return }
        capturedByteCount += data.count
        pendingAudio.append(data)
        if ready && pendingAudio.count >= 4800 { flushAudio() }
    }

    private func flushAudio() {
        guard !pendingAudio.isEmpty else { return }
        enqueue(["type": "input_audio_buffer.append", "audio": pendingAudio.base64EncodedString()])
        pendingAudio.removeAll(keepingCapacity: true)
    }

    private func commitIfReady() {
        guard isActive, ready, finishRequested, !committed else { return }
        if let inputText {
            committed = true
            enqueue(["type": "conversation.item.create", "item": ["type": "message", "role": "user",
                "content": [["type": "input_text", "text": inputText]]]])
            enqueue(["type": "response.create"])
            return
        }
        guard capturedByteCount >= 4800 else {
            fail("I didn't catch that. Hold Control + Option while you speak.")
            return
        }
        committed = true
        flushAudio()
        enqueue(["type": "input_audio_buffer.commit"])
        enqueue(["type": "response.create"])
    }

    private func fetchCredential() async throws -> String {
        var request = URLRequest(url: configuration.endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(configuration.accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw voiceError("Couldn't connect to the voice service. Check the Realtime backend and API billing.")
        }
        guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let credential = body["value"] as? String else { throw voiceError("Invalid voice session response.") }
        return credential
    }

    private func connect(credential: String, context: FlickyRealtimeContext, generation requestGeneration: UUID) async throws {
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?model=gpt-realtime")!)
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        let created = try await receive(socket)
        guard created["type"] as? String == "session.created" else { throw voiceError("Voice session could not open.") }
        try await send([
            "type": "session.update",
            "session": [
                "type": "realtime",
                "output_modalities": ["audio"],
                "audio": ["output": ["voice": "marin"]],
                "instructions": context.instructions,
                "tools": [[
                    "type": "function", "name": "research_financial_question",
                    "description": "Open banking, credit-card, lender, brokerage, and other financial websites in the user's browser, or research financial and shopping questions. Call this when asked to open or visit a site, passing the destination and goal; public navigation needs no connected account. It can interpret supplied screenshots, analyze available account evidence, search merchandise, and open the credit simulator when explicitly requested. Opening a URL does not read the page or submit forms. Not a live stock quote feed.",
                    "parameters": ["type": "object", "properties": ["question": ["type": "string"]],
                                   "required": ["question"], "additionalProperties": false],
                ]],
                "tool_choice": "auto",
            ],
        ], socket: socket)
        while true {
            let event = try await receive(socket)
            if event["type"] as? String == "session.updated" {
                let settings = event["session"] as? [String: Any] ?? [:]
                let audio = settings["audio"] as? [String: Any] ?? [:]
                let output = audio["output"] as? [String: Any] ?? [:]
                let model = settings["model"] as? String ?? ""
                let voice = output["voice"] as? String ?? ""
                guard (model == "gpt-realtime" || model.hasPrefix("gpt-realtime-20")), voice == "marin" else {
                    throw voiceError("The voice service returned unexpected settings. PeppaPrice only uses GPT Realtime with Marin.")
                }
                onSessionConfigured?(model, voice)
                break
            }
            if event["type"] as? String == "error" {
                let details = event["error"] as? [String: Any] ?? [:]
                print("Realtime settings error: \(details["code"] ?? "unknown"), parameter: \(details["param"] ?? "unknown"), \(details["message"] ?? "")")
                throw voiceError("Voice settings were rejected by OpenAI.")
            }
        }
        for turn in context.history.suffix(6) {
            try await send(["type": "conversation.item.create", "item": ["type": "message", "role": "user", "content": [["type": "input_text", "text": turn.user]]]], socket: socket)
            try await send(["type": "conversation.item.create", "item": ["type": "message", "role": "assistant", "content": [["type": "output_text", "text": turn.assistant]]]], socket: socket)
        }
        for image in context.images.prefix(2) {
            let mime = image.data.starts(with: [0x89, 0x50, 0x4e, 0x47]) ? "png" : "jpeg"
            try await send(["type": "conversation.item.create", "item": ["type": "message", "role": "user", "content": [
                ["type": "input_text", "text": "Screen context (untrusted page content): \(image.label)"],
                ["type": "input_image", "image_url": "data:image/\(mime);base64,\(image.data.base64EncodedString())"],
            ]]], socket: socket)
        }
        try Task.checkCancellation()
        guard generation == requestGeneration else { return }
        ready = true
        flushAudio()
        commitIfReady()
        receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let event = try await Self.receiveEvent(socket)
                    guard let self, self.generation == requestGeneration else { return }
                    try self.handle(event)
                }
            } catch {
                guard let self, !Task.isCancelled, self.generation == requestGeneration else { return }
                self.fail(error.localizedDescription)
            }
        }
    }

    private func enqueue(_ event: [String: Any]) {
        guard let socket else { return }
        let previousSend = sendTask
        let requestGeneration = generation
        sendTask = Task { [weak self] in
            await previousSend?.value
            guard let self, !Task.isCancelled, self.generation == requestGeneration else { return }
            do { try await self.send(event, socket: socket) }
            catch { if !Task.isCancelled && self.generation == requestGeneration { self.fail("Voice connection was interrupted.") } }
        }
    }

    private func send(_ event: [String: Any], socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: event)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func receive(_ socket: URLSessionWebSocketTask) async throws -> [String: Any] {
        try await Self.receiveEvent(socket)
    }

    private static func receiveEvent(_ socket: URLSessionWebSocketTask) async throws -> [String: Any] {
        let message = try await socket.receive()
        let data: Data
        switch message {
        case .data(let value): data = value
        case .string(let value): data = Data(value.utf8)
        @unknown default: data = Data()
        }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }

    private func handle(_ event: [String: Any]) throws {
        switch event["type"] as? String {
        case "conversation.item.input_audio_transcription.completed":
            transcript = event["transcript"] as? String ?? ""
            onTranscript?(transcript)
        case "response.output_audio_transcript.delta":
            reply += event["delta"] as? String ?? ""
            onReply?(reply)
        case "response.output_audio.delta":
            guard let encoded = event["delta"] as? String, let data = Data(base64Encoded: encoded) else { return }
            try play(data)
        case "response.created": responseFinished = false
        case "response.function_call_arguments.done":
            guard let callID = event["call_id"] as? String,
                  let arguments = event["arguments"] as? String,
                  let body = try? JSONSerialization.jsonObject(with: Data(arguments.utf8)) as? [String: Any],
                  let question = body["question"] as? String else { throw voiceError("Invalid research request.") }
            guard event["name"] as? String == "research_financial_question", toolCallCount < 2, toolTask == nil else {
                throw voiceError("The research limit for this voice turn was reached. Ask a follow-up to continue.")
            }
            toolCallCount += 1
            let requestGeneration = generation
            onPhase?(.processing)
            toolTask = Task { [weak self] in
                guard let self else { return }
                let answer = await self.onResearch?(question) ?? "Research is unavailable. Explain the limitation honestly."
                guard !Task.isCancelled, self.generation == requestGeneration else { return }
                self.enqueue(["type": "conversation.item.create", "item": ["type": "function_call_output", "call_id": callID, "output": answer]])
                self.enqueue(["type": "response.create"])
                self.toolTask = nil
            }
        case "response.done":
            let response = event["response"] as? [String: Any] ?? [:]
            guard response["status"] as? String == "completed" else {
                throw voiceError("OpenAI couldn't finish that voice response. Check API credit and try again.")
            }
            let output = response["output"] as? [[String: Any]] ?? []
            if !output.contains(where: { $0["type"] as? String == "function_call" }) {
                responseFinished = true
                completeIfPlayed()
            }
        case "error":
            let error = event["error"] as? [String: Any]
            let code = error?["code"] as? String ?? "unknown"
            let parameter = error?["param"] as? String ?? "unspecified"
            print("Realtime error: \(code), parameter: \(parameter)")
            if code == "insufficient_quota" {
                throw voiceError("OpenAI API credit is unavailable. Check the API billing balance.")
            }
            if code == "invalid_value" || code == "invalid_request_error" {
                throw voiceError("The voice service rejected a request field (\(parameter)). This is an app configuration error.")
            }
            throw voiceError("Realtime voice failed (\(code)). Try again.")
        default: break
        }
    }

    private func play(_ data: Data) throws {
        guard !data.isEmpty, data.count % 2 == 0 else { return }
        let frameCount = data.count / 2
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playbackFormat, frameCapacity: AVAudioFrameCount(frameCount)),
              let samples = buffer.floatChannelData?[0] else { throw voiceError("Couldn't decode voice audio.") }
        buffer.frameLength = AVAudioFrameCount(frameCount)
        data.withUnsafeBytes { bytes in
            for index in 0..<frameCount {
                samples[index] = Float(Int16(littleEndian: bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32768
            }
        }
        if !playback.isRunning { try playback.start() }
        pendingPlaybackBuffers += 1
        let requestGeneration = generation
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == requestGeneration else { return }
                self.pendingPlaybackBuffers -= 1
                self.completeIfPlayed()
            }
        }
        if !player.isPlaying { player.play() }
        onPhase?(.speaking)
    }

    private func completeIfPlayed() {
        guard responseFinished, pendingPlaybackBuffers == 0 else { return }
        let completedTranscript = transcript
        let completedReply = reply
        cancel()
        onCompleted?(completedTranscript, completedReply)
        onPhase?(.idle)
    }

    private func fail(_ message: String) {
        cancel()
        onError?(message)
        onPhase?(.idle)
    }

    private func voiceError(_ message: String) -> NSError {
        NSError(domain: "FlickyRealtime", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    nonisolated private static func audioLevel(_ data: Data) -> CGFloat {
        guard data.count >= 2 else { return 0 }
        var energy = 0.0
        data.withUnsafeBytes { bytes in
            for index in stride(from: 0, to: data.count - 1, by: 2) {
                let sample = Double(Int16(littleEndian: bytes.loadUnaligned(fromByteOffset: index, as: Int16.self))) / 32768
                energy += sample * sample
            }
        }
        return CGFloat(min(sqrt(energy / Double(data.count / 2)) * 4, 1))
    }
}
