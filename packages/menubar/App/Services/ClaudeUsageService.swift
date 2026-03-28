import Foundation

final class ClaudeUsageService: UsageService {
    let kind: UsageProviderKind = .claude

    func resolveUsage(from snapshot: MenuBarSnapshot?) -> UsageCardState {
        let provider = snapshot?.providers.claudeCode
        let windows = makeUsageWindows(from: provider)

        return UsageCardState(
            kind: kind,
            serviceName: kind.title,
            modelLabel: descriptorText(planType: provider?.planType, fallback: kind.fallbackDescriptor),
            state: provider?.state ?? .setupRequired,
            message: provider?.message,
            windows: windows.isEmpty ? [placeholderWindow(label: "5H"), placeholderWindow(label: "7D")] : windows,
            primaryWindow: pickPrimaryWindow(from: windows),
            lastUpdatedAt: parseSnapshotDate(provider?.lastUpdatedAt)
        )
    }
}
