import AppKit
import SwiftUI

enum AppTheme {
    static let backgroundTint = Color(hex: 0x0A0A0F, opacity: 0.78)
    static let backgroundOverlay = Color.black.opacity(0.18)
    static let panelEdge = Color.white.opacity(0.10)
    static let cardFill = Color.white.opacity(0.04)
    static let cardFillHover = Color.white.opacity(0.07)
    static let divider = Color.white.opacity(0.06)
    static let separatorGradient = LinearGradient(
        colors: [Color.white.opacity(0), Color.white.opacity(0.08), Color.white.opacity(0)],
        startPoint: .leading,
        endPoint: .trailing
    )
    static let textPrimary = Color(hex: 0xF0EEFF)
    static let textSecondary = Color(hex: 0xF0EEFF, opacity: 0.45)
    static let textTertiary = Color(hex: 0xF0EEFF, opacity: 0.28)
    static let statusHealthy = NSColor(hex: 0x5ED486)
    static let statusWarning = NSColor(hex: 0xF4B657)
    static let statusCritical = NSColor(hex: 0xFF5C74)
    static let statusNeutral = NSColor(hex: 0xB6B1CC)
}

extension UsageProviderKind {
    var gradient: [Color] {
        switch self {
        case .claude:
            return [Color(hex: 0xD97757), Color(hex: 0xE8996A)]
        case .codex:
            return [Color(hex: 0x10A37F), Color(hex: 0x6FCF97)]
        }
    }

    var markColor: Color {
        gradient.first ?? .white
    }
}

extension Color {
    init(hex: UInt64, opacity: Double = 1) {
        let red = Double((hex >> 16) & 0xFF) / 255
        let green = Double((hex >> 8) & 0xFF) / 255
        let blue = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}

extension NSColor {
    convenience init(hex: UInt64, alpha: CGFloat = 1) {
        let red = CGFloat((hex >> 16) & 0xFF) / 255
        let green = CGFloat((hex >> 8) & 0xFF) / 255
        let blue = CGFloat(hex & 0xFF) / 255
        self.init(srgbRed: red, green: green, blue: blue, alpha: alpha)
    }
}
