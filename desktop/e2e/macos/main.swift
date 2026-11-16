// Fake "real browser" for the macOS end-to-end test: receives URLs as Apple Events (like a
// real browser opened with `open -b`) and appends them to received.log next to the bundle.
import Cocoa

final class Delegate: NSObject, NSApplicationDelegate {
    let log = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("received.log")

    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { append(u.absoluteString) }
    }

    func append(_ s: String) {
        guard let line = (s + "\n").data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: log) {
            h.seekToEndOfFile()
            h.write(line)
            try? h.close()
        } else {
            try? line.write(to: log)
        }
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
