import AppKit
import Foundation

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
    let state: String
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

final class ProviderCardView: NSView {
    init(provider: SnapshotProvider, accentColor: NSColor) {
        super.init(frame: NSRect(x: 0, y: 0, width: 360, height: 150))
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.92).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = accentColor.withAlphaComponent(0.22).cgColor

        let container = NSStackView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.orientation = .vertical
        container.spacing = 10
        addSubview(container)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            container.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            container.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            container.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14),
            widthAnchor.constraint(equalToConstant: 360),
        ])

        let header = NSStackView()
        header.orientation = .horizontal
        header.spacing = 8
        header.alignment = .centerY

        let title = ProviderCardView.makeLabel(provider.label, font: .boldSystemFont(ofSize: 14), color: .labelColor)
        header.addArrangedSubview(title)
        header.addArrangedSubview(NSView())

        if let plan = provider.planType, !plan.isEmpty {
            let badge = ProviderCardView.makeBadge(plan.uppercased(), color: accentColor)
            header.addArrangedSubview(badge)
        }

        container.addArrangedSubview(header)
        container.addArrangedSubview(makeWindowRow(provider.windows.fiveHour, accentColor: accentColor))
        container.addArrangedSubview(makeWindowRow(provider.windows.sevenDay, accentColor: accentColor))

        let footerText: String
        if let message = provider.message, !message.isEmpty {
            footerText = message
        } else if let lastUpdatedAt = provider.lastUpdatedAt {
            footerText = "Updated \(ProviderCardView.relativeDate(lastUpdatedAt))"
        } else {
            footerText = ProviderCardView.stateLabel(provider.state)
        }

        let footer = ProviderCardView.makeLabel(footerText, font: .systemFont(ofSize: 11), color: .secondaryLabelColor)
        footer.maximumNumberOfLines = 2
        container.addArrangedSubview(footer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func makeWindowRow(_ window: SnapshotWindow, accentColor: NSColor) -> NSView {
        let wrapper = NSStackView()
        wrapper.orientation = .vertical
        wrapper.spacing = 4

        let topRow = NSStackView()
        topRow.orientation = .horizontal
        topRow.alignment = .centerY

        let label = ProviderCardView.makeLabel(window.label, font: .monospacedDigitSystemFont(ofSize: 12, weight: .semibold), color: .secondaryLabelColor)
        let value = ProviderCardView.makeLabel(
            ProviderCardView.percentLabel(window),
            font: .monospacedDigitSystemFont(ofSize: 12, weight: .bold),
            color: .labelColor
        )

        topRow.addArrangedSubview(label)
        topRow.addArrangedSubview(NSView())
        topRow.addArrangedSubview(value)

        let progress = NSProgressIndicator()
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 100
        progress.doubleValue = ProviderCardView.remainingPercent(window) ?? 0
        progress.style = .bar

        let reset = ProviderCardView.makeLabel(
            ProviderCardView.resetLabel(window),
            font: .systemFont(ofSize: 11),
            color: .secondaryLabelColor
        )

        wrapper.addArrangedSubview(topRow)
        wrapper.addArrangedSubview(progress)
        wrapper.addArrangedSubview(reset)
        return wrapper
    }

    private static func makeLabel(_ text: String, font: NSFont, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = font
        label.textColor = color
        label.lineBreakMode = .byTruncatingTail
        return label
    }

    private static func makeBadge(_ text: String, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: " \(text) ")
        label.font = .systemFont(ofSize: 10, weight: .semibold)
        label.textColor = color
        label.alignment = .center
        label.wantsLayer = true
        label.layer?.cornerRadius = 8
        label.layer?.backgroundColor = color.withAlphaComponent(0.14).cgColor
        return label
    }

    private static func percentLabel(_ window: SnapshotWindow) -> String {
        guard let remainingPercent = remainingPercent(window) else {
            return "--"
        }
        return "\(Int(remainingPercent.rounded()))% left"
    }

    private static func remainingPercent(_ window: SnapshotWindow) -> Double? {
        guard let usedPercent = window.usedPercent, !window.isStale else {
            return nil
        }

        return max(0, min(100, 100 - usedPercent))
    }

    private static func resetLabel(_ window: SnapshotWindow) -> String {
        if window.isStale {
            return "Waiting for a fresh post-reset sample"
        }

        guard let resetAt = window.resetAt else {
            return "Reset time unavailable"
        }

        return "Resets \(relativeDate(resetAt))"
    }

    private static func relativeDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else {
            return iso
        }

        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        return relative.localizedString(for: date, relativeTo: Date())
    }

    private static func stateLabel(_ state: String) -> String {
        switch state {
        case "setup_required":
            return "Needs setup"
        case "waiting_for_first_snapshot":
            return "Waiting for first snapshot"
        case "stale":
            return "Snapshot is stale"
        case "error":
            return "Snapshot error"
        default:
            return "Ready"
        }
    }
}

final class TokenleakUsageController: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let decoder = JSONDecoder()
    private let homeDir: String
    private let supportDir: String
    private let snapshotPath: String
    private let cliWrapperPath: String
    private let dashboardWrapperPath: String
    private let daemonLogPath: String
    private var snapshot: MenuBarSnapshot?
    private var timer: Timer?
    private var daemonProcess: Process?

    init(homeDir: String) {
        self.homeDir = homeDir
        self.supportDir = "\(homeDir)/Library/Application Support/tokenleak/menubar"
        self.snapshotPath = "\(supportDir)/snapshot.json"
        self.cliWrapperPath = "\(supportDir)/tokenleak-menubar-cli"
        self.dashboardWrapperPath = "\(supportDir)/tokenleak-menubar-dashboard"
        self.daemonLogPath = "\(supportDir)/logs/daemon.log"
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "Cdx -- | Cld --"
        startDaemonIfNeeded()
        reloadSnapshot()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.startDaemonIfNeeded()
            self?.reloadSnapshot()
        }
        if let timer = timer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        daemonProcess?.terminate()
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
        process.arguments = ["menubar", "daemon", "--home", homeDir]

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

    private func reloadSnapshot() {
        let url = URL(fileURLWithPath: snapshotPath)
        guard let data = try? Data(contentsOf: url) else {
            snapshot = nil
            renderTitle()
            renderMenu()
            return
        }

        snapshot = try? decoder.decode(MenuBarSnapshot.self, from: data)
        renderTitle()
        renderMenu()
    }

    private func renderTitle() {
        let title = snapshot?.title ?? "Cdx -- | Cld --"
        let attributed = NSAttributedString(
            string: title,
            attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)]
        )
        statusItem.button?.attributedTitle = attributed
    }

    private func renderMenu() {
        let menu = NSMenu()

        if let snapshot = snapshot {
            addHeader(title: snapshot.title, subtitle: "Live quota windows", to: menu)
            menu.addItem(.separator())
            addProviderCard(snapshot.providers.codex, accentColor: .systemGreen, to: menu)
            addProviderCard(snapshot.providers.claudeCode, accentColor: .systemOrange, to: menu)
        } else {
            let item = NSMenuItem(title: "Waiting for quota snapshot", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        menu.addItem(.separator())
        menu.addItem(makeActionItem(title: "Refresh", action: #selector(refreshNow)))
        menu.addItem(makeActionItem(title: "Open tokenleak dashboard", action: #selector(openDashboard)))
        menu.addItem(makeActionItem(title: "Open menubar folder", action: #selector(openMenubarFolder)))
        menu.addItem(.separator())
        menu.addItem(makeActionItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    private func addHeader(title: String, subtitle: String, to menu: NSMenu) {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 2
        stack.edgeInsets = NSEdgeInsets(top: 6, left: 14, bottom: 6, right: 14)

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = .monospacedDigitSystemFont(ofSize: 14, weight: .bold)
        titleLabel.textColor = .labelColor

        let subtitleLabel = NSTextField(labelWithString: subtitle)
        subtitleLabel.font = .systemFont(ofSize: 11)
        subtitleLabel.textColor = .secondaryLabelColor

        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(subtitleLabel)

        let view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 46))
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: view.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            view.widthAnchor.constraint(equalToConstant: 360),
        ])

        let item = NSMenuItem()
        item.view = view
        menu.addItem(item)
    }

    private func addProviderCard(_ provider: SnapshotProvider, accentColor: NSColor, to menu: NSMenu) {
        let card = ProviderCardView(provider: provider, accentColor: accentColor)
        let wrapper = NSView(frame: NSRect(x: 0, y: 0, width: 376, height: 164))
        card.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(card)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: 8),
            card.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -8),
            card.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 6),
            card.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -6),
            wrapper.widthAnchor.constraint(equalToConstant: 376),
        ])

        let item = NSMenuItem()
        item.view = wrapper
        menu.addItem(item)
    }

    private func makeActionItem(title: String, action: Selector, keyEquivalent: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.target = self
        return item
    }

    @objc private func refreshNow() {
        runCliCommand(["menubar", "refresh", "--home", homeDir])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.reloadSnapshot()
        }
    }

    @objc private func openDashboard() {
        guard FileManager.default.isExecutableFile(atPath: dashboardWrapperPath) else {
            NSSound.beep()
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-a", "Terminal", dashboardWrapperPath]
        try? process.run()
    }

    @objc private func openMenubarFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: supportDir)])
    }

    @objc private func quitApp() {
        NSApplication.shared.terminate(nil)
    }

    private func runCliCommand(_ arguments: [String]) {
        guard FileManager.default.isExecutableFile(atPath: cliWrapperPath) else {
            NSSound.beep()
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: cliWrapperPath)
        process.arguments = arguments
        do {
            try process.run()
        } catch {
            NSSound.beep()
        }
    }
}

let home = ProcessInfo.processInfo.environment["TOKENLEAK_MENUBAR_HOME"] ?? NSHomeDirectory()
let app = NSApplication.shared
let delegate = TokenleakUsageController(homeDir: home)
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
