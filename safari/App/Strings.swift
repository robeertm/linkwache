// Texts of the container app. Source of truth is src/i18n_extension.js ("safari.app.*", eight languages);
// extension/scripts/build.mjs writes them to app-strings.json, which the build phase copies into the app.
import Foundation

struct Strings {
    let lang: String
    private let table: [String: String]
    private let english: [String: String]

    static let supported = ["de", "en", "tr", "pl", "ru", "es", "fr", "it"]

    /// Language: launch argument / setting "LWLanguage", else the first supported system language, else English.
    static func pickLanguage(preferred: [String], override: String?) -> String {
        if let o = override?.lowercased(), supported.contains(o) { return o }
        for p in preferred {
            let code = String(p.lowercased().prefix(2))
            if supported.contains(code) { return code }
        }
        return "en"
    }

    init(bundle: Bundle = .main, defaults: UserDefaults = .standard) {
        let lang = Strings.pickLanguage(preferred: Locale.preferredLanguages, override: defaults.string(forKey: "LWLanguage"))
        var all: [String: [String: String]] = [:]
        if let url = bundle.url(forResource: "app-strings", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let strings = obj["strings"] as? [String: [String: String]] {
            all = strings
        }
        self.lang = lang
        self.table = all[lang] ?? [:]
        self.english = all["en"] ?? [:]
    }

    func t(_ key: String, _ params: [String: String] = [:]) -> String {
        var s = table[key] ?? english[key] ?? key
        for (k, v) in params { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }
}
