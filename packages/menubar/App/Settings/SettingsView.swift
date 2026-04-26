import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: UsageViewModel
    let onOpenSupportFolder: () -> Void
    let onOpenDashboard: () -> Void

    var body: some View {
        ZStack {
            VisualEffectBlur(material: .hudWindow, blendingMode: .behindWindow)
                .overlay(AppTheme.backgroundTint)
                .overlay(AppTheme.backgroundOverlay)

            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Preferences")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text("Tokenleak Usage reads local menubar snapshots and opens the dashboard on demand.")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(2)
                }

                SettingsRow(title: "Home", value: viewModel.homeDirectory)
                SettingsRow(title: "Support", value: viewModel.supportDirectory)
                SettingsRow(title: "Snapshot", value: viewModel.snapshotPath)
                SettingsRow(title: "Updated", value: viewModel.lastUpdatedText)

                HStack(spacing: 10) {
                    actionButton("Open Support Folder", action: onOpenSupportFolder)
                    actionButton("Open Dashboard", action: onOpenDashboard)
                }

                Spacer(minLength: 0)
            }
            .padding(22)
        }
        .frame(width: 460, height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(AppTheme.panelEdge, lineWidth: 0.6)
        )
    }

    private func actionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.06))
                )
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.10), lineWidth: 0.6)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsRow: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(AppTheme.textTertiary)
            Text(value)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
    }
}

final class SettingsWindowController: NSWindowController {
    init(viewModel: UsageViewModel) {
        let rootView = SettingsView(
            viewModel: viewModel,
            onOpenSupportFolder: { viewModel.openSupportFolder() },
            onOpenDashboard: { viewModel.openDashboard() }
        )
        let hostingController = NSHostingController(rootView: rootView)

        let window = NSWindow(contentViewController: hostingController)
        window.title = "Tokenleak Usage Preferences"
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.center()

        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }
}
