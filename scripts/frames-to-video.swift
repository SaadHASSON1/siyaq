// Turns timed JPEG frames into an MP4 (H.264, 30 fps) and a smaller looping GIF, with Apple's own frameworks.
// Usage: swift scripts/frames-to-video.swift frames.txt out.mp4 out.gif
// frames.txt lines: "<seconds> <path>", in order.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 4 else { print("usage: frames-to-video frames.txt out.mp4 out.gif"); exit(1) }
let lines = try! String(contentsOfFile: args[1], encoding: .utf8).split(separator: "\n")
let frames: [(Double, String)] = lines.compactMap { line in
    let parts = line.split(separator: " ", maxSplits: 1)
    guard parts.count == 2, let t = Double(parts[0]) else { return nil }
    return (t, String(parts[1]))
}
func image(_ path: String) -> CGImage {
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil)!
    return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}
// The frame on screen at time t: the last one captured at or before it.
func frame(at t: Double) -> String {
    var chosen = frames[0].1
    for (ft, path) in frames where ft <= t { chosen = path }
    return chosen
}
let duration = frames.last!.0 + 0.5
let first = image(frames[0].1)
let width = first.width, height = first.height

// ---- MP4 ----
let mp4 = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: mp4)
let writer = try! AVAssetWriter(outputURL: mp4, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_500_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
let fps = 30
var lastPath = "", lastBuffer: CVPixelBuffer?
for i in 0..<Int(duration * Double(fps)) {
    let path = frame(at: Double(i) / Double(fps))
    if path != lastPath {
        var buffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
        CVPixelBufferLockBaseAddress(buffer!, [])
        let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer!), width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer!), space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
        ctx.draw(image(path), in: CGRect(x: 0, y: 0, width: width, height: height))
        CVPixelBufferUnlockBaseAddress(buffer!, [])
        lastBuffer = buffer
        lastPath = path
    }
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
    adaptor.append(lastBuffer!, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: CMTimeScale(fps)))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print("wrote \(args[2])")

// ---- GIF: smaller and slower, since GitHub READMEs show GIFs but not videos ----
let gifFps = 10.0, gifWidth = 760
let gifHeight = Int(Double(height) * Double(gifWidth) / Double(width))
let gifURL = URL(fileURLWithPath: args[3])
let count = Int(duration * gifFps)
let dest = CGImageDestinationCreateWithURL(gifURL as CFURL, UTType.gif.identifier as CFString, count, nil)!
CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
for i in 0..<count {
    let src = image(frame(at: Double(i) / gifFps))
    let ctx = CGContext(data: nil, width: gifWidth, height: gifHeight, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(src, in: CGRect(x: 0, y: 0, width: gifWidth, height: gifHeight))
    CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1.0 / gifFps]] as CFDictionary)
}
CGImageDestinationFinalize(dest)
print("wrote \(args[3])")
