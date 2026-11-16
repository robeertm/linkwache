// "Linkwache for Safari": the container app that carries the Safari Web Extension. It explains how to switch the
// extension on, shows whether Safari reports it as on, opens Safari's extension settings and announces newer releases
// (the free build cannot update itself). Launch arguments for screenshots: -LWLanguage de, -LWAppearance dark|light,
// -LWSnapshot /path/file.png (renders the window to a PNG and quits).
import AppKit
import SafariServices
import SwiftUI

@main
struct LinkwacheApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            ContentView(model: delegate.model)
                .frame(width: 560)
                .fixedSize(horizontal: true, vertical: true)
        }
        .windowStyle(.hiddenTitleBar)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = Model()

    func applicationDidFinishLaunching(_ notification: Notification) {
        switch UserDefaults.standard.string(forKey: "LWAppearance") {
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        default: break
        }
        model.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { Self.fitWindow() }
        if let path = UserDefaults.standard.string(forKey: "LWSnapshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { Snapshot.window(to: path) }
        }
    }

    /// The window takes exactly the size of its content and is not resizable (works on macOS 12 too).
    static func fitWindow() {
        guard let win = NSApp.windows.first(where: { $0.isVisible }), let view = win.contentView else { return }
        win.styleMask.remove(.resizable)
        win.setContentSize(view.fittingSize)
        win.center()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

enum ExtensionState { case unknown, on, off }
enum UpdateState: Equatable { case idle, current(String), available(String), failed }

final class Model: ObservableObject {
    let strings = Strings()
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    let extensionID = Bundle.main.object(forInfoDictionaryKey: "LWExtensionBundleIdentifier") as? String ?? ""
    let guideURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "LWGuideURL") as? String ?? "")
    private let releasesAPI = URL(string: Bundle.main.object(forInfoDictionaryKey: "LWReleasesAPI") as? String ?? "")
    private let releasesPage = URL(string: Bundle.main.object(forInfoDictionaryKey: "LWReleasesPage") as? String ?? "")
    private var timer: Timer?

    @Published var state: ExtensionState = .unknown
    @Published var update: UpdateState = .idle
    @Published var autoCheck: Bool = UserDefaults.standard.object(forKey: "LWAutoCheck") == nil ? true : UserDefaults.standard.bool(forKey: "LWAutoCheck") {
        didSet {
            UserDefaults.standard.set(autoCheck, forKey: "LWAutoCheck")
            if autoCheck { checkForUpdate(force: true) } else { update = .idle }
        }
    }

    func start() {
        refreshState()
        checkForUpdate(force: false)
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshState()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in self?.checkForUpdate(force: false) }
    }

    func refreshState() {
        guard !extensionID.isEmpty else { return }
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { st, error in
            DispatchQueue.main.async {
                if let st = st, error == nil { self.state = st.isEnabled ? .on : .off } else { self.state = .unknown }
            }
        }
    }

    func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) { _ in
            DispatchQueue.main.async { self.refreshState() }
        }
    }

    func openGuide() { if let u = guideURL { NSWorkspace.shared.open(u) } }

    /// Asks the public release list at most once a day (or right away when switched on); switchable off.
    func checkForUpdate(force: Bool) {
        guard autoCheck, let api = releasesAPI else { return }
        let last = UserDefaults.standard.object(forKey: "LWLastCheck") as? Date
        if !force, !VersionCheck.isDue(lastCheck: last, now: Date()) {
            if let cached = UserDefaults.standard.string(forKey: "LWLatest") { show(latest: cached) }
            return
        }
        fetchLatest(api: api) { latest in
            DispatchQueue.main.async {
                guard let latest = latest else { self.update = .failed; return }
                UserDefaults.standard.set(Date(), forKey: "LWLastCheck")
                UserDefaults.standard.set(latest, forKey: "LWLatest")
                self.show(latest: latest)
            }
        }
    }

    /// Release API first; when it refuses (rate limit), the public release page, whose redirect names the latest tag.
    private func fetchLatest(api: URL, done: @escaping (String?) -> Void) {
        var req = URLRequest(url: api, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("linkwache-safari/\(version)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200, let v = data.flatMap(VersionCheck.latestVersion(fromReleaseJSON:)) { return done(v) }
            print("update check: release API answered \(code)")
            guard let page = self.releasesPage else { return done(nil) }
            var head = URLRequest(url: page, timeoutInterval: 15)
            head.httpMethod = "HEAD"
            head.setValue("linkwache-safari/\(self.version)", forHTTPHeaderField: "User-Agent")
            URLSession.shared.dataTask(with: head) { _, resp2, _ in
                let v = resp2?.url.flatMap(VersionCheck.version(fromReleaseURL:))
                if v == nil { print("update check: release page gave no version") }
                done(v)
            }.resume()
        }.resume()
    }

    private func show(latest: String) {
        update = VersionCheck.isNewer(latest, than: version) ? .available(latest) : .current(version)
    }
}

struct ContentView: View {
    @ObservedObject var model: Model
    private var s: Strings { model.strings }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.t("title")).font(.system(size: 22, weight: .bold))
                    Text(s.t("version", ["v": model.version])).font(.callout).foregroundColor(.secondary)
                }
            }
            Text(s.t("lead")).fixedSize(horizontal: false, vertical: true)

            stateRow

            VStack(alignment: .leading, spacing: 8) {
                Text(s.t("steps.h")).font(.headline)
                step(1, s.t("step1"))
                step(2, s.t("step2"))
                step(3, s.t("step3"))
            }

            Button(action: model.openSafariSettings) { Text(s.t("open")).frame(minWidth: 200) }
                .keyboardShortcut(.defaultAction)
                .controlSize(.large)

            VStack(alignment: .leading, spacing: 4) {
                Text(s.t("unsigned.h")).font(.subheadline.weight(.semibold))
                Text(s.t("unsigned")).font(.callout).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
            }

            Divider()
            updateRow
            Toggle(s.t("autocheck"), isOn: $model.autoCheck).font(.callout)
        }
        .padding(28)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var stateRow: some View {
        let (icon, color, text): (String, Color, String) = {
            switch model.state {
            case .on: return ("checkmark.circle.fill", .green, s.t("state.on"))
            case .off: return ("exclamationmark.circle.fill", .orange, s.t("state.off"))
            case .unknown: return ("questionmark.circle.fill", .secondary, s.t("state.unknown"))
            }
        }()
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundColor(color).font(.title3)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(color.opacity(0.12)))
    }

    @ViewBuilder private var updateRow: some View {
        switch model.update {
        case .available(let v):
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "arrow.down.circle.fill").foregroundColor(.accentColor).font(.title3)
                VStack(alignment: .leading, spacing: 6) {
                    Text(s.t("update", ["v": v, "cur": model.version])).fixedSize(horizontal: false, vertical: true)
                    Button(s.t("update.link"), action: model.openGuide)
                }
            }
        case .current(let v):
            Text(s.t("uptodate", ["v": v])).font(.callout).foregroundColor(.secondary)
        case .failed:
            Text(s.t("update.fail")).font(.callout).foregroundColor(.secondary)
        case .idle:
            EmptyView()
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.callout.weight(.bold)).foregroundColor(.white)
                .frame(width: 22, height: 22).background(Circle().fill(Color.accentColor))
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum Snapshot {
    /// Renders the app window (content incl. title bar area) to a PNG at the screen's scale, then quits.
    static func window(to path: String) {
        AppDelegate.fitWindow()
        NSApp.windows.first(where: { $0.isVisible })?.contentView?.layoutSubtreeIfNeeded()
        guard let win = NSApp.windows.first(where: { $0.isVisible }), let view = win.contentView else {
            FileHandle.standardError.write("snapshot: no window\n".data(using: .utf8)!); exit(3)
        }
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(3) }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { exit(3) }
        // The app is sandboxed: when the path is outside its container, write into its own temporary folder instead.
        let wanted = URL(fileURLWithPath: path)
        let fallback = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(wanted.lastPathComponent)
        for url in [wanted, fallback] {
            if (try? png.write(to: url)) != nil { print("snapshot: \(url.path)"); fflush(stdout); exit(0) }
        }
        exit(4)
    }
}
