// Mock of the app's commands for rendering the UI in a plain browser (visual tests).
// Injected before the page scripts; the fixture is chosen with ?fixture=<name>&lang=<code>.
(() => {
  const q = new URLSearchParams(location.search);
  const fixture = q.get("fixture") || "";
  const lang = q.get("lang") || "en";
  const platform = q.get("platform") || "windows";
  const now = Math.floor(Date.now() / 1000);
  const F = (key, stufe, p = {}, extra = {}) => ({ key, stufe, p, ...extra });
  const local = (stufe, findings) => ({ stufe, kurzKey: "v." + stufe, ratKey: "v." + stufe + ".rat", score: 0, findings });
  const results = {
    amber: {
      url: "https://cheap-deals.top/angebot/login?id=8812", target: "https://cheap-deals.top/angebot/login?id=8812", unwrapped: false,
      host: "cheap-deals.top", domain: "cheap-deals.top", unicodeHost: "cheap-deals.top", stufe: "gelb", source: "server",
      kurzKey: "v.gelb.one", ratKey: "v.gelb.one.rat",
      findings: [F("tld", "gelb", { tld: "top" }), F("lure", "info", { words: "login" }), F("db-clean", "info", { n: 3 })],
      local: local("gelb", [F("tld", "gelb", { tld: "top" })]),
    },
    red: {
      url: "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fpaypal.com.secure-login.example%2Fkonto%2Fverify&data=05",
      target: "https://paypal.com.secure-login.example/konto/verify", unwrapped: true,
      host: "paypal.com.secure-login.example", domain: "secure-login.example", unicodeHost: "paypal.com.secure-login.example",
      stufe: "rot", source: "server", kurzKey: "v.rot.multi", ratKey: "v.rot.rat",
      findings: [F("bank", "rot", {}, { muster: true }), F("brand-sub", "rot", { brand: "paypal", domain: "secure-login.example" }),
        F("lure", "gelb", { words: "secure, login, konto, verify" }), F("nxdomain", "info", {})],
      local: local("rot", []),
    },
    offline: {
      url: "http://example.org/rechnung/2026-11.pdf", target: "http://example.org/rechnung/2026-11.pdf", unwrapped: false,
      host: "example.org", domain: "example.org", unicodeHost: "example.org", stufe: "offline", source: "local", reason: "network",
      kurzKey: "v.gelb.one", ratKey: "v.gelb.one.rat",
      findings: [F("http", "gelb", {}), F("lure", "info", { words: "rechnung" })],
      local: local("gelb", [F("http", "gelb", {}), F("lure", "info", { words: "rechnung" })]),
    },
  };
  results["red-step"] = results.red;
  const toasts = {
    "toast-checking": { seq: 1, state: "checking", domain: "example.com", host: "shop.example.com", lang },
    "toast-green": { seq: 1, state: "green", domain: "wikipedia.org", host: "de.wikipedia.org", lang },
    "toast-allowlist": { seq: 1, state: "allowlist", domain: "example.com", host: "mail.example.com", lang },
    "toast-refused": { seq: 1, state: "refused", domain: "mailto:", host: "", lang },
  };
  const browsers = platform === "macos"
    ? [["mac-bundle", "com.apple.safari", "Safari", true], ["mac-bundle", "org.mozilla.firefox", "Firefox", false], ["mac-bundle", "com.google.chrome", "Google Chrome", false]]
    : platform === "linux"
      ? [["linux-desktop", "firefox-esr.desktop", "Firefox ESR", true], ["linux-desktop", "chromium.desktop", "Chromium", false]]
      : [["win-client", "Microsoft Edge", "Microsoft Edge", true], ["win-client", "Google Chrome", "Google Chrome", false], ["win-client", "Firefox-308046B0AF4A39CB", "Mozilla Firefox", false]];
  const settings = {
    lang, server: "https://linkwache.example", scope: "url", allowlist: ["example.com", "meine-bank.example"],
    paused: fixture === "settings-general-paused", pausedUntil: now + 900, updateCheck: true,
    installId: "3f9c2a7be1d04c6f8a51e2b7c9d0a4f1", setupDone: true, autostart: true,
    forward: { kind: browsers[0][0], id: browsers[0][1], name: browsers[0][2], command: "" },
  };
  const history = [
    { time: now - 60, domain: "wikipedia.org", url: "", stufe: "gruen", source: "allowlist", action: "opened" },
    { time: now - 420, domain: "secure-login.example", url: "", stufe: "rot", source: "server", action: "blocked" },
    { time: now - 1800, domain: "cheap-deals.top", url: "", stufe: "gelb", source: "server", action: "open-anyway" },
    { time: now - 3600, domain: "example.org", url: "", stufe: "offline", source: "local", action: "blocked" },
    { time: now - 7200, domain: "example.com", url: "", stufe: "gruen", source: "cache", action: "opened" },
    { time: now - 86400, domain: "", url: "", stufe: "", source: "local", action: "refused" },
  ];
  const update = fixture === "settings-updates-backup"
    ? { state: "available", version: "0.5.1", current: "0.5.0", inapp: true, backup: { version: "0.5.1", old: "0.5.0", path: "C:\\Users\\user\\AppData\\Roaming\\app.linkwache.desktop\\backup\\0.5.0\\linkwache.exe" } }
    : { state: "available", version: "0.5.1", current: "0.5.0", inapp: true, backup: null };
  window.LW_MOCK = {
    invoke(cmd, args) {
      switch (cmd) {
        case "bootstrap": return { lang, platform, version: "0.5.0" };
        case "toast_state": return toasts[fixture] || toasts["toast-checking"];
        case "get_result": {
          const r = results[fixture] || results.amber;
          return { id: 1, result: r, waitMs: q.get("wait") ? Number(q.get("wait")) : 2400, redStep: false };
        }
        case "get_settings": return settings;
        case "list_browsers": return browsers.map(([kind, id, name, prev], i) => ({ target: { kind, id, name, command: "" }, previous: prev, selected: i === 0 }));
        case "handler_status": return { isDefault: fixture !== "settings-browser-notdefault", current: null };
        case "get_history": return history;
        case "update_status": return update;
        case "test_server": return "0.5.0";
        case "make_default": return "user";
        default: return null;
      }
    },
    listen() {},
  };
})();
