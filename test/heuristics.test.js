import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristics } from "../src/checks.js";
import { extractUrls, normalizeInput, hostInfo, defang } from "../src/util.js";
import { verdict } from "../src/verdict.js";
import { t, findingText, verdictText, LANGS, STRINGS } from "../src/i18n.js";

const keys = (url) => new Set(heuristics(url).findings.map((f) => f.key));

test("Links aus einer WhatsApp-Nachricht fischen", () => {
  const t = "Hi! Kannst du bitte für Alexandra abstimmen? https://star-voted.biz.id/home/votedb danke!! Und www.beispiel.de/x.";
  assert.deepEqual(extractUrls(t), ["https://star-voted.biz.id/home/votedb", "https://www.beispiel.de/x"]);
  assert.equal(normalizeInput("sparkasse-login.top"), "https://sparkasse-login.top/");
  assert.equal(normalizeInput("kein link"), null);
});

test("Domain-Zerlegung kennt biz.id als Endung", () => {
  const h = hostInfo("https://star-voted.biz.id/home/votedb");
  assert.equal(h.domain, "star-voted.biz.id");
  assert.equal(h.tld, "biz.id");
  assert.equal(h.sub, "");
});

test("Marke in der Subdomain ist Tarnung, Marke als Domain nicht", () => {
  assert.ok(keys("https://paypal.com.login-secure.xyz/signin").has("brand-sub"));
  assert.ok(!keys("https://www.paypal.com/signin").has("brand-sub"));
  assert.ok(!keys("https://www.paypal.com/signin").has("brand-typo"));
  assert.ok(keys("https://paypal-kundenservice.de/konto").has("brand-typo"));
});

test("Warnzeichen: IP, @, http, riskante Endung, Köderwörter", () => {
  const k = keys("http://192.168.7.7/login");
  assert.ok(k.has("ip-host") && k.has("http"));
  assert.ok(keys("https://amazon.de@evil.top/x").has("at-sign"));
  assert.ok(keys("https://star-voted.biz.id/home/votedb").has("tld"));
  assert.ok(keys("https://star-voted.biz.id/home/votedb").has("lure"));
});

test("Urteil: frische Domain + Abstimmung = rot mit Muster; alte saubere Domain = grün", () => {
  const f = [{ key: "age-fresh", stufe: "rot", p: { days: 0 } }, { key: "tld", stufe: "gelb", p: { tld: "biz.id" } }];
  const v = verdict(f, { url: "https://star-voted.biz.id/home/votedb" });
  assert.equal(v.stufe, "rot");
  assert.ok(v.findings.some((x) => x.key === "vote" && x.muster));
  assert.equal(verdictText("de", v).kurz, "Betrug — mehrere klare Warnzeichen");
  assert.equal(verdictText("en", v).kurz, "Scam — several clear warning signs");
  const g = verdict([{ key: "age-old", stufe: "gruen", p: { years: 12 } }, { key: "db-clean", stufe: "info", p: { n: 3 } }], { url: "https://www.heise.de/" });
  assert.equal(g.stufe, "gruen");
  const y = verdict([{ key: "tld", stufe: "gelb", p: { tld: "xyz" } }], { url: "https://irgendwas.xyz/" });
  assert.equal(y.stufe, "gelb");
});

test("Entschärfte Darstellung ist nicht anklickbar", () => {
  assert.equal(defang("https://star-voted.biz.id/x"), "hxxps://star-voted[.]biz[.]id/x");
});

test("Jede Sprache hat jeden Schlüssel, Platzhalter bleiben erhalten", () => {
  const de = Object.keys(STRINGS.de);
  for (const l of LANGS) {
    const missing = de.filter((k) => !(k in STRINGS[l]));
    assert.deepEqual(missing, [], l + " fehlt: " + missing.join(","));
    for (const k of de) {
      const ph = (STRINGS.de[k].match(/\{\w+\}/g) || []).sort();
      const ph2 = (STRINGS[l][k].match(/\{\w+\}/g) || []).sort();
      assert.deepEqual(ph2, ph, `${l}:${k} Platzhalter`);
    }
  }
  const fr = findingText("fr", { key: "age-fresh", stufe: "rot", p: { days: 3 } });
  assert.equal(fr.titel, "Domaine enregistré il y a seulement 3 jour(s)");
  assert.equal(findingText("tr", { key: "brand-sub", stufe: "rot", p: { brand: "paypal", domain: "x.xyz" } }).titel, "„paypal“ yalnızca gerçek alan adının ÖNÜNDE");
  assert.equal(t("ru", "stufe.rot"), "Не открывать");
});
