// Record a drum take from a USB-MIDI kit while a reference track plays, then (optionally) render
// it to audio with macOS's built-in General MIDI drums. No driver, no DAW.
//
//   swift scripts/drum-take.swift record --reference ref.wav --out take.mid [--source TD-07] [--pre 8]
//   swift scripts/drum-take.swift render --midi take.mid --out take.wav
//
// record: plays --reference on the default output, scheduled on the host clock, and stamps every
//   note-on with the kit's CoreMIDI timestamp relative to the moment the reference is *heard*
//   (scheduled start + the output's presentation latency). Time 0 of take.mid = time 0 of the
//   reference, so the take lines up with anything else recorded against the same reference.
//   Roland edge zones are folded onto General MIDI notes GarageBand and the GM bank play
//   (hi-hat edge 22/26 → 42/46, crash edges 55/52 → 49/57, ride edge 59 → 51); the untouched
//   hits go to take.raw.json. Stops at the end of the reference (+2 s) or on Ctrl-C.
// render: plays take.mid through AVAudioUnitSampler loaded with the GM percussion bank from
//   gs_instruments.dls in offline mode and writes a 44.1 kHz / 24-bit WAV of the same length.
//   For nicer drums, drag take.mid onto a Drum Kit track in GarageBand at 108 BPM instead.

import AVFoundation
import CoreMIDI
import Foundation

let BPM = 108.0
let PPQ = 480
let REMAP: [UInt8: UInt8] = [22: 42, 26: 46, 55: 49, 52: 57, 59: 51]

func arg(_ name: String, _ def: String? = nil) -> String? {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--\(name)"), i + 1 < a.count { return a[i + 1] }
    return def
}
func die(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func hostToSeconds(_ t: UInt64) -> Double { Double(t) * Double(timebase.numer) / Double(timebase.denom) / 1e9 }
func secondsToHost(_ s: Double) -> UInt64 { UInt64(s * 1e9 * Double(timebase.denom) / Double(timebase.numer)) }

// ─────────────── Standard MIDI file (format 0, one drum track on channel 10) ───────────────
struct Hit: Codable { let time: Double; let note: UInt8; let velocity: UInt8; let played: UInt8 }

func varLen(_ v: Int) -> [UInt8] {
    var v = v, out: [UInt8] = [UInt8(v & 0x7F)]
    v >>= 7
    while v > 0 { out.insert(UInt8((v & 0x7F) | 0x80), at: 0); v >>= 7 }
    return out
}

func writeMidi(_ hits: [Hit], to path: String) throws {
    let ticksPerSecond = Double(PPQ) * BPM / 60
    var events: [(tick: Int, bytes: [UInt8])] = []
    for h in hits where h.time >= 0 {
        let t = Int((h.time * ticksPerSecond).rounded())
        events.append((t, [0x99, h.note, h.velocity]))
        events.append((t + PPQ / 8, [0x89, h.note, 0]))
    }
    events.sort { $0.tick < $1.tick }
    let usPerBeat = Int(60_000_000 / BPM)
    var track: [UInt8] = [0x00, 0xFF, 0x51, 0x03, UInt8(usPerBeat >> 16 & 0xFF), UInt8(usPerBeat >> 8 & 0xFF), UInt8(usPerBeat & 0xFF)]
    track += [0x00, 0xFF, 0x58, 0x04, 4, 2, 24, 8]
    let name = Array("Drums".utf8)
    track += [0x00, 0xFF, 0x03, UInt8(name.count)] + name
    var last = 0
    for e in events { track += varLen(e.tick - last) + e.bytes; last = e.tick }
    track += [0x00, 0xFF, 0x2F, 0x00]
    var file: [UInt8] = Array("MThd".utf8) + [0, 0, 0, 6, 0, 0, 0, 1, UInt8(PPQ >> 8), UInt8(PPQ & 0xFF)]
    let n = track.count
    file += Array("MTrk".utf8) + [UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF)] + track
    try Data(file).write(to: URL(fileURLWithPath: path))
}

// ─────────────── record ───────────────
func record() {
    guard let refPath = arg("reference"), let outPath = arg("out") else { die("record needs --reference and --out") }
    let sourceMatch = arg("source", "TD-07")!.lowercased()
    let pre = Double(arg("pre", "8")!) ?? 8

    let file: AVAudioFile
    do { file = try AVAudioFile(forReading: URL(fileURLWithPath: refPath)) } catch { die("cannot open reference: \(error)") }
    let refLength = Double(file.length) / file.processingFormat.sampleRate

    // MIDI in
    var client = MIDIClientRef()
    MIDIClientCreateWithBlock("drum-take" as CFString, &client, nil)
    let lock = NSLock()
    var stamps: [(host: UInt64, note: UInt8, velocity: UInt8)] = []
    var port = MIDIPortRef()
    let status = MIDIInputPortCreateWithProtocol(client, "in" as CFString, ._1_0, &port) { list, _ in
        let now = mach_absolute_time()
        var packet = list.pointee.packet
        for _ in 0..<list.pointee.numPackets {
            let ts = packet.timeStamp == 0 ? now : packet.timeStamp
            let words = withUnsafeBytes(of: packet.words) { Array($0.bindMemory(to: UInt32.self).prefix(Int(packet.wordCount))) }
            for w in words where w >> 28 == 0x2 {           // MIDI 1.0 channel voice message
                let status = UInt8((w >> 16) & 0xF0), note = UInt8((w >> 8) & 0x7F), vel = UInt8(w & 0x7F)
                if status == 0x90 && vel > 0 { lock.lock(); stamps.append((ts, note, vel)); lock.unlock() }
            }
            packet = MIDIEventPacketNext(&packet).pointee
        }
    }
    if status != noErr { die("MIDI input port failed (\(status))") }
    var names: [String] = []
    for i in 0..<MIDIGetNumberOfSources() {
        let src = MIDIGetSource(i)
        var name: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(src, kMIDIPropertyDisplayName, &name)
        let n = (name?.takeRetainedValue() as String?) ?? "?"
        if n.lowercased().contains(sourceMatch) { MIDIPortConnectSource(port, src, nil); names.append(n) }
    }
    if names.isEmpty { die("no MIDI source matching \"\(sourceMatch)\" — is the kit on and plugged in?") }

    // Audio out, scheduled on the host clock
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: file.processingFormat)
    do { try engine.start() } catch { die("audio engine failed: \(error)") }
    player.scheduleFile(file, at: nil)
    let latency = engine.outputNode.presentationLatency
    let startHost = mach_absolute_time() + secondsToHost(pre)
    let heardHost = startHost + secondsToHost(latency)
    player.play(at: AVAudioTime(hostTime: startHost))

    print("MIDI: \(names.joined(separator: ", "))  ·  output latency \(Int(latency * 1000)) ms")
    print("Reference starts in \(Int(pre)) s — get to the kit. Slate: one loud rimshot in the count-in. Ctrl-C to stop early.")

    var stop = false
    signal(SIGINT, SIG_IGN)
    let sig = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    sig.setEventHandler { stop = true }
    sig.resume()

    var lastShown = -1
    let endHost = heardHost + secondsToHost(refLength + 2)
    while !stop && mach_absolute_time() < endHost {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
        let now = mach_absolute_time()
        let secs = now >= heardHost ? hostToSeconds(now - heardHost) : -hostToSeconds(heardHost - now)
        let shown = Int(secs.rounded(.down))
        if shown != lastShown {
            lastShown = shown
            lock.lock(); let n = stamps.count; lock.unlock()
            let label = secs < 0 ? "starting in \(-shown)" : String(format: "%d:%02d / %d:%02d", shown / 60, shown % 60, Int(refLength) / 60, Int(refLength) % 60)
            print("\r\(label)  ·  \(n) hits      ", terminator: "")
            fflush(stdout)
        }
    }
    player.stop(); engine.stop()
    MIDIPortDispose(port); MIDIClientDispose(client)

    lock.lock(); let taken = stamps; lock.unlock()
    let hits = taken.map { s -> Hit in
        let t = s.host >= heardHost ? hostToSeconds(s.host - heardHost) : -hostToSeconds(heardHost - s.host)
        return Hit(time: t, note: REMAP[s.note] ?? s.note, velocity: s.velocity, played: s.note)
    }
    do {
        try writeMidi(hits, to: outPath)
        let rawPath = (outPath as NSString).deletingPathExtension + ".raw.json"
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted]
        try enc.encode(hits).write(to: URL(fileURLWithPath: rawPath))
        let remapped = hits.filter { $0.note != $0.played }.count
        print("\n\(hits.count) hits (\(remapped) edge hits folded to GM) → \(outPath)")
    } catch { die("write failed: \(error)") }
}

// ─────────────── render ───────────────
func readMidiHits(_ path: String) -> (hits: [(Double, UInt8, UInt8)], length: Double) {
    // Note-ons from every track of a constant-tempo SMF (format 0 or 1).
    guard let d = FileManager.default.contents(atPath: path) else { die("cannot read \(path)") }
    let b = [UInt8](d)
    let ppq = Int(b[12]) << 8 | Int(b[13])
    var usPerBeat = 60_000_000 / BPM
    var ticks: [(Int, UInt8, UInt8)] = []
    var i = 14
    while i + 8 <= b.count {
        let len = Int(b[i + 4]) << 24 | Int(b[i + 5]) << 16 | Int(b[i + 6]) << 8 | Int(b[i + 7])
        let isTrack = b[i] == 0x4D && b[i + 1] == 0x54 && b[i + 2] == 0x72 && b[i + 3] == 0x6B
        var j = i + 8
        let end = min(b.count, j + len)
        i = end
        if !isTrack { continue }
        var tick = 0
        var running: UInt8 = 0
        func readVar() -> Int { var v = 0; while j < end { let c = b[j]; j += 1; v = v << 7 | Int(c & 0x7F); if c & 0x80 == 0 { break } }; return v }
        while j < end {
            tick += readVar()
            var st = b[j]
            if st == 0xFF {
                let type = b[j + 1]; j += 2
                let l = readVar()
                if type == 0x51 { usPerBeat = Double(Int(b[j]) << 16 | Int(b[j + 1]) << 8 | Int(b[j + 2])) }
                j += l
                continue
            }
            if st == 0xF0 || st == 0xF7 { j += 1; j += readVar(); continue }
            if st & 0x80 != 0 { running = st; j += 1 } else { st = running }
            let twoBytes = (st & 0xE0) != 0xC0
            let d1 = b[j], d2 = twoBytes ? b[j + 1] : 0
            j += twoBytes ? 2 : 1
            if st & 0xF0 == 0x90 && d2 > 0 { ticks.append((tick, d1, d2)) }
        }
    }
    let out = ticks.sorted { $0.0 < $1.0 }.map { (Double($0.0) / Double(ppq) * usPerBeat / 1e6, $0.1, $0.2) }
    return (out, (out.last?.0 ?? 0) + 2)
}

func render() {
    guard let midiPath = arg("midi"), let outPath = arg("out") else { die("render needs --midi and --out") }
    let (hits, length) = readMidiHits(midiPath)
    let sr = 44100.0
    let engine = AVAudioEngine()
    let sampler = AVAudioUnitSampler()
    engine.attach(sampler)
    engine.connect(sampler, to: engine.mainMixerNode, format: nil)
    let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!
    do {
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 512)
        try engine.start()
        let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
        try sampler.loadSoundBankInstrument(at: bank, program: 0, bankMSB: UInt8(kAUSampler_DefaultPercussionBankMSB), bankLSB: 0)
    } catch { die("render setup failed: \(error)") }

    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sr, AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 24, AVLinearPCMIsFloatKey: false]
    let outFile: AVAudioFile
    do { outFile = try AVAudioFile(forWriting: URL(fileURLWithPath: outPath), settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false) } catch { die("cannot write \(outPath): \(error)") }
    let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 512)!
    // Notes before 0 (count-in slate hits in a take that started early) are dropped; the reference defines 0.
    var pending = hits.filter { $0.0 >= 0 }.sorted { $0.0 < $1.0 }[...]
    let total = AVAudioFramePosition(length * sr)
    var pos: AVAudioFramePosition = 0
    while pos < total {
        let frames = AVAudioFrameCount(min(512, total - pos))
        let blockEnd = Double(pos + AVAudioFramePosition(frames)) / sr
        // Triggering at block starts quantises to 512 frames (11.6 ms); fine for a rough preview
        // but not for the video, so split the block at every note instead.
        var cursor = pos
        while let h = pending.first, h.0 < blockEnd {
            let at = AVAudioFramePosition(h.0 * sr)
            if at > cursor {
                let n = AVAudioFrameCount(at - cursor)
                if (try? engine.renderOffline(n, to: buffer)) == .success { try? outFile.write(from: buffer) }
                cursor = at
            }
            sampler.startNote(h.1, withVelocity: h.2, onChannel: 9)
            pending.removeFirst()
        }
        let rest = AVAudioFrameCount(pos + AVAudioFramePosition(frames) - cursor)
        if rest > 0, (try? engine.renderOffline(rest, to: buffer)) == .success { try? outFile.write(from: buffer) }
        pos += AVAudioFramePosition(frames)
    }
    engine.stop()
    print("rendered \(hits.count) hits, \(String(format: "%.1f", length)) s → \(outPath)")
}

switch CommandLine.arguments.dropFirst().first {
case "record": record()
case "render": render()
default: die("usage: drum-take.swift record --reference ref.wav --out take.mid | render --midi take.mid --out take.wav")
}
