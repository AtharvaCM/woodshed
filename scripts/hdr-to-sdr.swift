// Cut a stretch out of a phone video and convert it from HDR (HDR10 / HLG) to SDR BT.709 with
// Apple's own tone mapping, re-encoded as H.264 so the cut is frame-exact.
// (Homebrew's ffmpeg has no zscale/libplacebo, and without tone mapping HDR footage comes out grey.)
//
//   swift scripts/hdr-to-sdr.swift --in phone.mp4 --out clip.mp4 --start 1116.9 --duration 82

import AVFoundation
import Foundation

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: "--\(name)"), i + 1 < a.count else { return nil }
    return a[i + 1]
}
guard let input = arg("in"), let output = arg("out"), let start = Double(arg("start") ?? ""), let duration = Double(arg("duration") ?? "") else {
    FileHandle.standardError.write("usage: hdr-to-sdr.swift --in in.mp4 --out out.mp4 --start SECONDS --duration SECONDS\n".data(using: .utf8)!)
    exit(1)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: input))
let sem = DispatchSemaphore(value: 0)
Task {
    do {
        let composition = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset)
        composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1920x1080) else { throw NSError(domain: "export", code: 1) }
        export.videoComposition = composition
        export.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: duration, preferredTimescale: 600))
        try? FileManager.default.removeItem(atPath: output)
        try await export.export(to: URL(fileURLWithPath: output), as: .mp4)
        print("wrote \(output): \(start)s + \(duration)s, SDR BT.709")
    } catch {
        FileHandle.standardError.write("export failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    sem.signal()
}
sem.wait()
