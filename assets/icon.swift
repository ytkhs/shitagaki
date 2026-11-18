import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments[1]

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func rgb(_ hex: Int, _ a: CGFloat = 1) -> NSColor {
    NSColor(deviceRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

// macOS のアイコングリッド: 1024 の中に 824 の本体、角丸半径は約 185
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)

let shadow = NSShadow()
shadow.shadowColor = rgb(0x000000, 0.35)
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.shadowBlurRadius = 28
NSGraphicsContext.saveGraphicsState()
shadow.set()
rgb(0x1e1f22).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

NSGradient(starting: rgb(0x34363c), ending: rgb(0x1a1b1e))!.draw(in: shape, angle: -90)
rgb(0xffffff, 0.08).setStroke()
let rim = NSBezierPath(roundedRect: body.insetBy(dx: 3, dy: 3), xRadius: 182, yRadius: 182)
rim.lineWidth = 6
rim.stroke()

// 書きかけの文章を表す行。上から下へ
let left: CGFloat = 250
let lineHeight: CGFloat = 46
let rows: [(y: CGFloat, width: CGFloat)] = [(690, 524), (590, 460), (490, 524), (390, 250)]
for row in rows {
    let r = NSRect(x: left, y: row.y - lineHeight / 2, width: row.width, height: lineHeight)
    rgb(0xd8d8d8, 0.9).setFill()
    NSBezierPath(roundedRect: r, xRadius: lineHeight / 2, yRadius: lineHeight / 2).fill()
}

// 最後の行の末尾にカーソル
let last = rows.last!
let caret = NSRect(x: left + last.width + 26, y: last.y - 46, width: 28, height: 92)
rgb(0x7aa2f7).setFill()
NSBezierPath(roundedRect: caret, xRadius: 14, yRadius: 14).fill()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
