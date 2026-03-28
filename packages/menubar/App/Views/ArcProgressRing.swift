import SwiftUI

struct ArcProgressRing: View {
    let progress: Double
    let gradient: [Color]
    let critical: Bool

    @State private var animatedProgress: Double = 0
    @State private var glow = false

    var body: some View {
        ZStack {
            ArcTrackShape(progress: 1)
                .stroke(
                    Color.white.opacity(0.08),
                    style: StrokeStyle(lineWidth: 7, lineCap: .round)
                )

            ArcTrackShape(progress: animatedProgress)
                .stroke(
                    AngularGradient(
                        colors: gradient,
                        center: .center,
                        startAngle: .degrees(150),
                        endAngle: .degrees(390)
                    ),
                    style: StrokeStyle(lineWidth: 7, lineCap: .round)
                )
                .shadow(
                    color: critical
                        ? Color.red.opacity(glow ? 0.35 : 0.14)
                        : (gradient.last ?? .white).opacity(0.34),
                    radius: critical ? (glow ? 12 : 6) : 8
                )
        }
        .padding(6)
        .onAppear {
            withAnimation(.easeOut(duration: 0.7)) {
                animatedProgress = progress
            }

            guard critical else {
                return
            }

            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                glow.toggle()
            }
        }
        .onChange(of: progress) { _, newValue in
            withAnimation(.easeOut(duration: 0.7)) {
                animatedProgress = newValue
            }
        }
    }
}

private struct ArcTrackShape: Shape {
    let progress: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius = min(rect.width, rect.height) / 2
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let startAngle = Angle.degrees(150)
        let endAngle = Angle.degrees(150 + (240 * max(0, min(1, progress))))

        path.addArc(
            center: center,
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )
        return path
    }
}
