import Foundation

final class TimerManager {
    private var timer: Timer?

    func start(every interval: TimeInterval, fireImmediately: Bool = false, action: @escaping () -> Void) {
        stop()

        if fireImmediately {
            action()
        }

        let timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            action()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    deinit {
        stop()
    }
}
