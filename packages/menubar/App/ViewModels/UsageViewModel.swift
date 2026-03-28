import AppKit
import Foundation
import SwiftUI

@MainActor
final class UsageViewModel: ObservableObject {
    @Published private(set) var claudeUsage: UsageCardState
    @Published private(set) var codexUsage: UsageCardState
    @Published private(set) var lastUpdatedText: String
    @Published private(set) var lastUpdatedAt: Date?
    @Published private(set) var isRefreshing: Bool

    let homeDirectory: String
    let supportDirectory: String
    let snapshotPath: String
    let cliWrapperPath: String
    let dashboardWrapperPath: String

    private let services: [UsageService]
    private let decoder = JSONDecoder()

    init(
        homeDirectory: String,
        supportDirectory: String,
        snapshotPath: String,
        cliWrapperPath: String,
        dashboardWrapperPath: String,
        services: [UsageService] = [ClaudeUsageService(), CodexUsageService()]
    ) {
        self.homeDirectory = homeDirectory
        self.supportDirectory = supportDirectory
        self.snapshotPath = snapshotPath
        self.cliWrapperPath = cliWrapperPath
        self.dashboardWrapperPath = dashboardWrapperPath
        self.services = services

        self.claudeUsage = ClaudeUsageService().resolveUsage(from: nil)
        self.codexUsage = CodexUsageService().resolveUsage(from: nil)
        self.lastUpdatedText = "Waiting for first refresh"
        self.isRefreshing = false
    }

    var cards: [UsageCardState] {
        [claudeUsage, codexUsage]
    }

    var statusTint: NSColor {
        guard let value = lowestRemainingPercent else {
            return AppTheme.statusNeutral
        }
        if value < 20 {
            return AppTheme.statusCritical
        }
        if value < 50 {
            return AppTheme.statusWarning
        }
        return AppTheme.statusHealthy
    }

    var statusLabel: String? {
        guard let value = lowestRemainingPercent else {
            return nil
        }
        return "\(Int(value.rounded()))%"
    }

    private var lowestRemainingPercent: Double? {
        cards.compactMap(\.displayPercent).min()
    }

    func reloadSnapshot(animated: Bool = true) {
        let snapshot = loadSnapshot()
        let updatedClaude = services.first(where: { $0.kind == .claude })?.resolveUsage(from: snapshot) ?? ClaudeUsageService().resolveUsage(from: snapshot)
        let updatedCodex = services.first(where: { $0.kind == .codex })?.resolveUsage(from: snapshot) ?? CodexUsageService().resolveUsage(from: snapshot)
        let generatedAt = parseSnapshotDate(snapshot?.generatedAt)

        let updateState = {
            self.claudeUsage = updatedClaude
            self.codexUsage = updatedCodex
            self.lastUpdatedAt = generatedAt
            self.lastUpdatedText = self.makeLastUpdatedText(from: generatedAt)
        }

        if animated {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                updateState()
            }
        } else {
            updateState()
        }
    }

    func refresh() {
        guard !isRefreshing else {
            return
        }

        isRefreshing = true
        let cliWrapperPath = self.cliWrapperPath
        let homeDirectory = self.homeDirectory

        Task.detached(priority: .userInitiated) {
            guard FileManager.default.isExecutableFile(atPath: cliWrapperPath) else {
                return
            }

            let process = Process()
            process.executableURL = URL(fileURLWithPath: cliWrapperPath)
            process.arguments = ["menubar", "refresh", "--home", homeDirectory]
            try? process.run()
            process.waitUntilExit()
        }

        Task {
            try? await Task.sleep(for: .milliseconds(500))
            self.reloadSnapshot()
            self.isRefreshing = false
        }
    }

    func openSupportFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: supportDirectory)])
    }

    func openDashboard() {
        guard FileManager.default.isExecutableFile(atPath: dashboardWrapperPath) else {
            NSSound.beep()
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-a", "Terminal", dashboardWrapperPath]
        try? process.run()
    }

    private func loadSnapshot() -> MenuBarSnapshot? {
        let url = URL(fileURLWithPath: snapshotPath)
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }

        return try? decoder.decode(MenuBarSnapshot.self, from: data)
    }

    private func makeLastUpdatedText(from date: Date?) -> String {
        guard let date else {
            return "Waiting for first refresh"
        }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Last updated: \(formatter.localizedString(for: date, relativeTo: Date()))"
    }
}
