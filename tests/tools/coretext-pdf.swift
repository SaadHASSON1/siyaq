// Writes Arabic text to a PDF with Core Text, the way Pages and TextEdit do, so its text (diacritics included)
// is in the file as written. Used by tests/arabic.test.mjs on Macs.
// Usage: swift coretext-pdf.swift out.pdf "Font Name" "paragraph" ["paragraph" ...]
import AppKit
import CoreText

let args = CommandLine.arguments
var box = CGRect(x: 0, y: 0, width: 595, height: 842)
let ctx = CGContext(URL(fileURLWithPath: args[1]) as CFURL, mediaBox: &box, nil)!
let para = NSMutableParagraphStyle()
para.alignment = .right
para.baseWritingDirection = .rightToLeft
para.paragraphSpacing = 12
let font = NSFont(name: args[2], size: 15) ?? NSFont.systemFont(ofSize: 15)
let text = NSAttributedString(string: args[3...].joined(separator: "\n"), attributes: [.font: font, .paragraphStyle: para])
let setter = CTFramesetterCreateWithAttributedString(text)
var start = 0
while start < text.length {
    ctx.beginPDFPage(nil)
    let frame = CTFramesetterCreateFrame(setter, CFRange(location: start, length: 0), CGPath(rect: box.insetBy(dx: 50, dy: 50), transform: nil), nil)
    CTFrameDraw(frame, ctx)
    ctx.endPDFPage()
    start += CTFrameGetVisibleStringRange(frame).length
}
ctx.closePDF()
