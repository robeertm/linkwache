// Plain test runner for the container app's update logic (no XCTest needed):
//   swiftc -swift-version 5 -parse-as-library safari/App/VersionCheck.swift safari/App/Strings.swift safari/tests/VersionCheckTests.swift -o /tmp/lw-vc && /tmp/lw-vc
import Foundation

var failures = 0
func check(_ cond: Bool, _ what: String) {
    if cond { print("PASS \(what)") } else { print("FAIL \(what)"); failures += 1 }
}

@main
struct VersionCheckTests {
    static func main() {
        check(VersionCheck.parse("v0.6.0") == [0, 6, 0], "parse with v")
        check(VersionCheck.parse("1.2.3-beta.1") == [1, 2, 3], "parse pre-release suffix")
        check(VersionCheck.parse("1.2") == nil, "two numbers are not a version")
        check(VersionCheck.parse("garbage") == nil, "garbage")
        check(VersionCheck.isNewer("0.6.1", than: "0.6.0"), "patch newer")
        check(VersionCheck.isNewer("v1.0.0", than: "0.9.9"), "major newer")
        check(!VersionCheck.isNewer("0.6.0", than: "0.6.0"), "same is not newer")
        check(!VersionCheck.isNewer("0.5.9", than: "0.6.0"), "older is not newer")
        check(!VersionCheck.isNewer("x", than: "0.6.0"), "unparsable is never newer")
        check(VersionCheck.isNewer("0.10.0", than: "0.9.0"), "numeric, not lexical")

        let rel = #"{"tag_name":"v0.6.2","draft":false,"prerelease":false,"assets":[]}"#.data(using: .utf8)!
        check(VersionCheck.latestVersion(fromReleaseJSON: rel) == "0.6.2", "release json")
        let pre = #"{"tag_name":"v0.7.0","prerelease":true}"#.data(using: .utf8)!
        check(VersionCheck.latestVersion(fromReleaseJSON: pre) == nil, "pre-release ignored")
        check(VersionCheck.latestVersion(fromReleaseJSON: Data("nope".utf8)) == nil, "broken json")
        check(VersionCheck.latestVersion(fromReleaseJSON: Data(#"{"tag_name":"latest"}"#.utf8)) == nil, "tag without version")

        let now = Date()
        check(VersionCheck.isDue(lastCheck: nil, now: now), "never checked -> due")
        check(!VersionCheck.isDue(lastCheck: now.addingTimeInterval(-3600), now: now), "an hour ago -> not due")
        check(VersionCheck.isDue(lastCheck: now.addingTimeInterval(-90_000), now: now), "a day ago -> due")
        check(VersionCheck.isDue(lastCheck: now.addingTimeInterval(3600), now: now), "clock went back -> due")

        check(Strings.pickLanguage(preferred: ["de-DE", "en"], override: nil) == "de", "system language")
        check(Strings.pickLanguage(preferred: ["ja-JP", "fr-FR"], override: nil) == "fr", "first supported language")
        check(Strings.pickLanguage(preferred: ["ja-JP"], override: nil) == "en", "fallback English")
        check(Strings.pickLanguage(preferred: ["de-DE"], override: "it") == "it", "override wins")
        check(Strings.pickLanguage(preferred: ["de-DE"], override: "xx") == "de", "unknown override ignored")

        if failures > 0 { print("\(failures) FAILED"); exit(1) }
        print("ALL PASSED")
    }
}
