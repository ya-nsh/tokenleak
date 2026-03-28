import SwiftUI

struct UsageCard: View {
    let card: UsageCardState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerRow

            ForEach(card.windows) { window in
                WindowRow(window: window, gradient: card.kind.gradient)
            }

            Text(card.footerText)
                .font(.system(size: 10, weight: .regular, design: .monospaced))
                .foregroundStyle(AppTheme.textTertiary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(AppTheme.cardFill)
        )
    }

    private var headerRow: some View {
        HStack(alignment: .center, spacing: 8) {
            ServiceGlyph(kind: card.kind)
                .frame(width: 22, height: 22)

            Text(card.serviceName)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .lineLimit(1)

            Spacer()

            Text(card.headerDetail)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AppTheme.textTertiary)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.06))
                )
        }
    }
}

private struct WindowRow: View {
    let window: UsageWindowState
    let gradient: [Color]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(window.label)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.textTertiary)

                Spacer()

                if let pct = window.remainingPercent {
                    Text("\(Int(pct.rounded()))%")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(AppTheme.textPrimary)
                } else {
                    Text("--%")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(AppTheme.textTertiary)
                }
            }

            UsageProgressBar(progress: window.progress, gradient: gradient)
                .frame(height: 5)
        }
    }
}

private struct UsageProgressBar: View {
    let progress: Double
    let gradient: [Color]

    @State private var animatedProgress: Double = 0

    var body: some View {
        GeometryReader { geometry in
            let fillWidth = geometry.size.width * CGFloat(max(0, min(1, animatedProgress)))

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.06))

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: gradient,
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(fillWidth, fillWidth > 0 ? 4 : 0))
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) {
                animatedProgress = progress
            }
        }
        .onChange(of: progress) { _, newValue in
            withAnimation(.easeOut(duration: 0.5)) {
                animatedProgress = newValue
            }
        }
    }
}

private struct ServiceGlyph: View {
    let kind: UsageProviderKind

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: kind.gradient.map { $0.opacity(0.25) },
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if kind == .claude {
                ZStack {
                    Circle()
                        .stroke(kind.markColor, lineWidth: 1.4)
                    Circle()
                        .trim(from: 0.05, to: 0.68)
                        .stroke(kind.markColor.opacity(0.45), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
                        .rotationEffect(.degrees(-40))
                }
                .padding(4)
            } else {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .stroke(kind.markColor, lineWidth: 1.4)
                    .overlay {
                        VStack(spacing: 2) {
                            Capsule().fill(kind.markColor).frame(width: 6, height: 1.5)
                            Capsule().fill(kind.markColor).frame(width: 6, height: 1.5)
                        }
                    }
                    .padding(4)
            }
        }
    }
}
