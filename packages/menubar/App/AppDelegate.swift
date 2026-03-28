import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private let refreshTimer = TimerManager()
    private var settingsWindowController: SettingsWindowController?
    private var statusHostingView: NSHostingView<MenuBarStatusItemView>?
    private var subscriptions = Set<AnyCancellable>()
    private var daemonProcess: Process?

    private lazy var viewModel: UsageViewModel = {
        UsageViewModel(
            homeDirectory: homeDirectory,
            supportDirectory: supportDirectory,
            snapshotPath: snapshotPath,
            cliWrapperPath: cliWrapperPath,
            dashboardWrapperPath: dashboardWrapperPath
        )
    }()

    private let homeDirectory: String
    private let supportDirectory: String
    private let snapshotPath: String
    private let cliWrapperPath: String
    private let dashboardWrapperPath: String
    private let daemonLogPath: String

    override init() {
        let homeDirectory = ProcessInfo.processInfo.environment["TOKENLEAK_MENUBAR_HOME"] ?? NSHomeDirectory()
        self.homeDirectory = homeDirectory
        self.supportDirectory = "\(homeDirectory)/Library/Application Support/tokenleak/menubar"
        self.snapshotPath = "\(supportDirectory)/snapshot.json"
        self.cliWrapperPath = "\(supportDirectory)/tokenleak-menubar-cli"
        self.dashboardWrapperPath = "\(supportDirectory)/tokenleak-menubar-dashboard"
        self.daemonLogPath = "\(supportDirectory)/logs/daemon.log"
        super.init()
    }

    private var daemonCheckCounter = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        configurePopover()
        bindViewModel()

        startDaemonIfNeeded()
        viewModel.reloadSnapshot(animated: false)

        refreshTimer.start(every: 5, fireImmediately: false) { [weak self] in
            guard let self else { return }
            // Only check daemon every 6th tick (30s) instead of every 5s
            self.daemonCheckCounter += 1
            if self.daemonCheckCounter % 6 == 0 {
                self.startDaemonIfNeeded()
            }
            self.viewModel.reloadSnapshot(animated: false)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshTimer.stop()
        daemonProcess?.terminate()
    }

    @objc func togglePopover(_ sender: Any?) {
        guard let button = statusItem.button else {
            return
        }

        if popover.isShown {
            popover.performClose(sender)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    @objc func openSettingsWindow(_ sender: Any?) {
        popover.performClose(sender)

        if settingsWindowController == nil {
            settingsWindowController = SettingsWindowController(viewModel: viewModel)
        }
        settingsWindowController?.present()
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else {
            return
        }

        button.target = self
        button.action = #selector(togglePopover(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.image = nil
        button.title = ""

        let hostingView = NSHostingView(rootView: MenuBarStatusItemView(label: viewModel.statusLabel, tintColor: Color(nsColor: viewModel.statusTint)))
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(hostingView)

        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 4),
            hostingView.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -4),
            hostingView.topAnchor.constraint(equalTo: button.topAnchor, constant: 1),
            hostingView.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -1),
        ])

        self.statusHostingView = hostingView
    }

    private func configurePopover() {
        popover.behavior = .transient
        popover.animates = false
        popover.contentSize = NSSize(width: 360, height: 400)
        popover.contentViewController = NSHostingController(
            rootView: PopoverContentView(viewModel: viewModel, onOpenSettings: { [weak self] in
                self?.openSettingsWindow(nil)
            })
        )
    }

    private func bindViewModel() {
        Publishers.CombineLatest3(viewModel.$claudeUsage, viewModel.$codexUsage, viewModel.$lastUpdatedText)
            .receive(on: RunLoop.main)
            .sink { [weak self] _, _, _ in
                self?.updateStatusItem()
            }
            .store(in: &subscriptions)
    }

    private func updateStatusItem() {
        statusHostingView?.rootView = MenuBarStatusItemView(
            label: viewModel.statusLabel,
            tintColor: Color(nsColor: viewModel.statusTint)
        )
    }

    private func startDaemonIfNeeded() {
        guard daemonProcess?.isRunning != true else {
            return
        }

        guard FileManager.default.isExecutableFile(atPath: cliWrapperPath) else {
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: cliWrapperPath)
        process.arguments = ["menubar", "daemon", "--home", homeDirectory]

        FileManager.default.createFile(atPath: daemonLogPath, contents: nil)
        if let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: daemonLogPath)) {
            _ = try? handle.seekToEnd()
            process.standardOutput = handle
            process.standardError = handle
        }

        do {
            try process.run()
            daemonProcess = process
        } catch {
            NSSound.beep()
        }
    }
}

private struct MenuBarStatusItemView: View {
    let label: String?
    let tintColor: Color

    var body: some View {
        HStack(spacing: 5) {
            MenuBarGlyph(color: tintColor)
                .frame(width: 14, height: 14)

            if let label {
                Text(label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(tintColor)
            }
        }
        .padding(.horizontal, 4)
        .frame(height: 20)
        .allowsHitTesting(false)
    }
}
