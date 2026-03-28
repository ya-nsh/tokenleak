import AppKit
import SwiftUI

struct PopoverContentView: View {
    @ObservedObject var viewModel: UsageViewModel
    let onOpenSettings: () -> Void

    @State private var didAppear = false

    var body: some View {
        ZStack {
            VisualEffectBlur(material: .hudWindow, blendingMode: .behindWindow)
                .overlay(AppTheme.backgroundTint)
                .overlay(AppTheme.backgroundOverlay)

            VStack(alignment: .leading, spacing: 14) {
                header

                Rectangle()
                    .fill(AppTheme.separatorGradient)
                    .frame(height: 0.5)

                VStack(spacing: 10) {
                    UsageCard(card: viewModel.claudeUsage)
                    UsageCard(card: viewModel.codexUsage)
                }

                Text(viewModel.lastUpdatedText)
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(AppTheme.textSecondary)
                    .padding(.horizontal, 2)
            }
            .padding(16)
        }
        .frame(width: 360)
        .opacity(didAppear ? 1 : 0)
        .scaleEffect(didAppear ? 1 : 0.92, anchor: .topTrailing)
        .onAppear {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                didAppear = true
            }
        }
        .onDisappear {
            didAppear = false
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            MenuBarGlyph(color: Color(nsColor: viewModel.statusTint))
                .frame(width: 16, height: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text("LLM Usage")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text("Codex and Claude Code quotas")
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Spacer()

            Button {
                viewModel.refresh()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.textTertiary)
                    .frame(width: 26, height: 26)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)

            Button {
                onOpenSettings()
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.textTertiary)
                    .frame(width: 26, height: 26)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }
}

struct VisualEffectBlur: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blendingMode: NSVisualEffectView.BlendingMode

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

struct MenuBarGlyph: View {
    let color: Color

    var body: some View {
        Image(systemName: "gauge.with.dots.needle.33percent")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(color)
    }
}
