import AppKit
import Foundation
import SwiftUI

enum UsageProviderKind: String {
    case claude
    case codex

    var title: String {
        switch self {
        case .claude:
            return "Claude Code"
        case .codex:
            return "Codex"
        }
    }

    var fallbackDescriptor: String {
        "Active quota"
    }
}

enum UsageProviderState: String, Decodable {
    case ready
    case setupRequired = "setup_required"
    case waitingForFirstSnapshot = "waiting_for_first_snapshot"
    case stale
    case error

    var displayLabel: String {
        switch self {
        case .ready:
            return "Ready"
        case .setupRequired:
            return "Setup required"
        case .waitingForFirstSnapshot:
            return "Waiting for first snapshot"
        case .stale:
            return "Snapshot stale"
        case .error:
            return "Unavailable"
        }
    }
}

struct SnapshotWindow: Decodable {
    let label: String
    let usedPercent: Double?
    let resetAt: String?
    let windowMinutes: Int
    let isStale: Bool
}

struct SnapshotWindowGroup: Decodable {
    let fiveHour: SnapshotWindow
    let sevenDay: SnapshotWindow
}

struct SnapshotProvider: Decodable {
    let label: String
    let shortLabel: String
    let source: String
    let state: UsageProviderState
    let planType: String?
    let lastUpdatedAt: String?
    let message: String?
    let windows: SnapshotWindowGroup
}

struct SnapshotProviders: Decodable {
    let codex: SnapshotProvider
    let claudeCode: SnapshotProvider
}

struct MenuBarSnapshot: Decodable {
    let schemaVersion: Int
    let generatedAt: String
    let title: String
    let providers: SnapshotProviders
}

struct UsageWindowState: Identifiable {
    let id: String
    let label: String
    let usedPercent: Double?
    let remainingPercent: Double?
    let resetAt: Date?
    let isStale: Bool
    let windowMinutes: Int

    var progress: Double {
        guard let remainingPercent else {
            return 0
        }
        return max(0, min(1, remainingPercent / 100))
    }

    var compactLabel: String {
        guard let remainingPercent else {
            return "\(label) --"
        }
        return "\(label) \(Int(remainingPercent.rounded()))%"
    }

    var remainingText: String {
        guard let remainingPercent else {
            return "--%"
        }
        return "\(Int(remainingPercent.rounded()))%"
    }

    var resetText: String {
        guard let resetAt else {
            return "Reset time unavailable"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        let relative = formatter.localizedString(for: resetAt, relativeTo: Date())
        if resetAt < Date() {
            return "Reset imminent"
        }
        return "Resets \(relative)"
    }
}

struct UsageCardState {
    let kind: UsageProviderKind
    let serviceName: String
    let modelLabel: String
    let state: UsageProviderState
    let message: String?
    let windows: [UsageWindowState]
    let primaryWindow: UsageWindowState
    let lastUpdatedAt: Date?

    var displayPercent: Double? {
        guard state == .ready else {
            return nil
        }
        return primaryWindow.remainingPercent
    }

    var headerDetail: String {
        if state == .ready {
            return modelLabel
        }
        return state.displayLabel
    }

    var footerText: String {
        if state == .ready {
            return primaryWindow.resetText
        }
        return message ?? state.displayLabel
    }

    var primaryProgress: Double {
        primaryWindow.progress
    }

    var usedPercent: Double {
        guard let usedPercent = primaryWindow.usedPercent else {
            return 0
        }
        return max(0, min(100, usedPercent))
    }
}

protocol UsageService {
    var kind: UsageProviderKind { get }
    func resolveUsage(from snapshot: MenuBarSnapshot?) -> UsageCardState
}

func parseSnapshotDate(_ value: String?) -> Date? {
    guard let value else {
        return nil
    }

    return UsageFormatters.iso8601.date(from: value)
}

func remainingPercent(from usedPercent: Double?) -> Double? {
    guard let usedPercent else {
        return nil
    }
    return max(0, min(100, 100 - usedPercent))
}

func makeUsageWindows(from provider: SnapshotProvider?) -> [UsageWindowState] {
    let windows = [
        provider?.windows.fiveHour,
        provider?.windows.sevenDay,
    ]

    return windows.compactMap { snapshotWindow in
        guard let snapshotWindow else {
            return nil
        }

        return UsageWindowState(
            id: snapshotWindow.label,
            label: snapshotWindow.label.uppercased(),
            usedPercent: snapshotWindow.usedPercent,
            remainingPercent: snapshotWindow.isStale ? nil : remainingPercent(from: snapshotWindow.usedPercent),
            resetAt: parseSnapshotDate(snapshotWindow.resetAt),
            isStale: snapshotWindow.isStale,
            windowMinutes: snapshotWindow.windowMinutes
        )
    }
}

func placeholderWindow(label: String) -> UsageWindowState {
    UsageWindowState(
        id: label,
        label: label,
        usedPercent: nil,
        remainingPercent: nil,
        resetAt: nil,
        isStale: false,
        windowMinutes: 0
    )
}

func pickPrimaryWindow(from windows: [UsageWindowState]) -> UsageWindowState {
    let valid = windows.filter { !$0.isStale && $0.remainingPercent != nil }
    if let mostConstrained = valid.min(by: { ($0.remainingPercent ?? 101) < ($1.remainingPercent ?? 101) }) {
        return mostConstrained
    }
    return windows.first ?? placeholderWindow(label: "5H")
}

func descriptorText(planType: String?, fallback: String) -> String {
    guard let planType, !planType.isEmpty else {
        return fallback
    }

    let pieces = planType
        .replacingOccurrences(of: "_", with: " ")
        .split(separator: " ")
        .map { $0.capitalized }
    return pieces.joined(separator: " ")
}

enum UsageFormatters {
    static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
