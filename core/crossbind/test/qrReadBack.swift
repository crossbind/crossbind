// Reads QR matrices ("# <label>" then lines of 0 and 1) from a file, draws each at 8 px a module with a quiet zone of 4
// modules, and prints what CoreImage's QR detector reads in it: "<label>\t<text>". macOS alone (qrReadBack.mjs).
import CoreGraphics
import CoreImage
import Foundation

let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!

func read(_ label: String, _ rows: [String]) {
    let scale = 8, quiet = 4
    let side = (rows.count + quiet * 2) * scale
    let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side,
                            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    context.setFillColor(gray: 1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: side, height: side))
    context.setFillColor(gray: 0, alpha: 1)
    for (y, row) in rows.enumerated() {
        for (x, module) in row.enumerated() where module == "1" {
            // CoreGraphics counts from the bottom; row 0 is the top.
            context.fill(CGRect(x: (x + quiet) * scale, y: side - (y + quiet + 1) * scale, width: scale, height: scale))
        }
    }
    let found = detector.features(in: CIImage(cgImage: context.makeImage()!)).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
    print("\(label)\t\(found.first ?? "<nothing read>")")
}

var label = ""
var rows: [String] = []
for line in try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8).split(separator: "\n") {
    if line.hasPrefix("# ") {
        if !rows.isEmpty { read(label, rows) }
        label = String(line.dropFirst(2))
        rows = []
    } else {
        rows.append(String(line))
    }
}
if !rows.isEmpty { read(label, rows) }
