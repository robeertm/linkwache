// Update notice of the Safari container app (docs/DESKTOP.md "Safari", "Updater"). The free build cannot replace itself:
// a newer release is only announced; rebuilding goes through safari/scripts/build-local.sh.
// Pure parts (parsing, comparing, when to ask) are tested in safari/tests/VersionCheckTests.swift.
import Foundation

enum VersionCheck {
    /// "v0.6.0" / "0.6.0" / "0.6.0-beta" -> [0, 6, 0]; nil when there are no three numbers.
    static func parse(_ s: String) -> [Int]? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("v") || t.hasPrefix("V") { t.removeFirst() }
        let core = t.split(whereSeparator: { $0 == "-" || $0 == "+" }).first.map(String.init) ?? ""
        let parts = core.split(separator: ".").map { Int($0) }
        guard parts.count >= 3, let a = parts[0], let b = parts[1], let c = parts[2] else { return nil }
        return [a, b, c]
    }

    /// true when `latest` is a higher version than `current`; false for anything unparsable.
    static func isNewer(_ latest: String, than current: String) -> Bool {
        guard let a = parse(latest), let b = parse(current) else { return false }
        for i in 0..<3 where a[i] != b[i] { return a[i] > b[i] }
        return false
    }

    /// Version from the JSON of GitHub's "latest release" endpoint (pre-releases are never "latest").
    static func latestVersion(fromReleaseJSON data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = obj["tag_name"] as? String, parse(tag) != nil else { return nil }
        if (obj["draft"] as? Bool) == true || (obj["prerelease"] as? Bool) == true { return nil }
        return tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
    }

    /// Ask at most once a day.
    static func isDue(lastCheck: Date?, now: Date, interval: TimeInterval = 86_400) -> Bool {
        guard let last = lastCheck else { return true }
        return now.timeIntervalSince(last) >= interval || now < last
    }
}
