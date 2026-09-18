// Alle Texte, die ein Nutzer sieht — in acht Sprachen. Befunde und Urteile
// werden als Schlüssel gespeichert und erst beim Anzeigen übersetzt, deshalb
// liest jeder Empfänger eines Ergebnis-Links das Ergebnis in seiner Sprache.
// Neue Texte: erst hier in ALLEN Sprachen anlegen, dann benutzen.

import { MORE } from "./i18n_more.js";

export const LANGS = ["de", "en", "tr", "pl", "ru", "es", "fr", "it"];
export const LANG_NAMES = { de: "Deutsch", en: "English", tr: "Türkçe", pl: "Polski", ru: "Русский", es: "Español", fr: "Français", it: "Italiano" };
export const DEFAULT_LANG = "de";

export function pickLang(req, explicit) {
  if (explicit && LANGS.includes(explicit)) return explicit;
  const al = (req?.headers?.get("accept-language") || "").toLowerCase();
  for (const part of al.split(",")) {
    const code = part.trim().slice(0, 2);
    if (LANGS.includes(code)) return code;
  }
  return DEFAULT_LANG;
}

export function t(lang, key, p = {}) {
  const d = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  let s = d[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  for (const [k, v] of Object.entries(p)) s = s.split("{" + k + "}").join(String(v));
  return s;
}

const S = {};

S.de = {
  "site.tagline": "Link prüfen, ohne ihn zu öffnen",
  "site.desc": "Verdächtigen Link einfügen, Ampel lesen. Kostenlos, ohne Anmeldung, nichts wird auf deinem Gerät geöffnet.",
  "nav.how": "So geht’s", "nav.legal": "Impressum", "nav.start": "Start",
  "home.h1": "Komischer Link bekommen? Erst prüfen, dann klicken — oder eben nicht.",
  "home.lead": "Füge den Link ein (oder gleich die ganze Nachricht). Die Linkwache schaut ihn sich von außen an — auf deinem Handy wird nichts geöffnet — und sagt dir in einfachen Worten, was dran ist.",
  "home.label": "Link oder Nachricht hier einfügen",
  "home.placeholder": "z. B. https://beispiel-seite.example/gewinn — oder die ganze WhatsApp-Nachricht",
  "home.check": "Link prüfen", "home.checking": "Prüfe …", "home.paste": "Aus Zwischenablage einfügen",
  "home.hint": "Kostenlos · ohne Anmeldung · wir speichern nur den geprüften Link, keine Namen, keine Nummern.",
  "home.how.h": "So geht’s in jedem Messenger",
  "home.s1.h": "1 · Link gedrückt halten", "home.s1.p": "In WhatsApp, Signal, Telegram, SMS oder Mail den Link lange drücken → „Kopieren“ (nicht antippen!).",
  "home.s2.h": "2 · Hier einfügen", "home.s2.p": "Diese Seite öffnen, oben einfügen, „Link prüfen“. Fertig.",
  "home.s3.h": "3 · Ergebnis teilen", "home.s3.p": "Der Ergebnis-Link lässt sich weiterschicken — an den, der dir den Link geschickt hat.",
  "home.fast.h": "Noch schneller",
  "home.android.h": "📱 Android: „Teilen“", "home.android.p": "Diese Seite einmal über das Browser-Menü „Zum Startbildschirm hinzufügen“. Danach taucht die Linkwache im Teilen-Menü jedes Messengers auf.",
  "home.ios.h": "🍎 iPhone: Kurzbefehl", "home.ios.p": "Einmal den Kurzbefehl anlegen (3 Schritte, 1 Minute). Danach: Link teilen → „Linkwache“.", "home.ios.link": "Kurzbefehl anlegen",
  "home.mail.h": "✉️ Per Mail", "home.mail.p": "Verdächtige Mail einfach weiterleiten an {mail}. Die Antwort kommt automatisch.",
  "home.tg.h": "💬 Telegram", "home.tg.p": "Nachricht an {bot} weiterleiten — Antwort in Sekunden.",
  "home.what.h": "Was wird geprüft?",
  "home.what.p": "Alter und Besitzer der Domain, Endung, Tarnung hinter Cloudflare, Zertifikate, Kurzlink-Ziele, nachgeahmte Markennamen, Köderwörter, die Betrugsdatenbanken von Google Safe Browsing, URLhaus und PhishTank, frühere Sandbox-Scans — und ein Screenshot der Seite aus einer Sandbox, damit du siehst, was du nicht anklicken sollst. Der Link wird dabei nie auf deinem Gerät geöffnet.",
  "foot.note": "Die Linkwache sucht Warnzeichen — sie beweist keine Unschuld. Bei Rot: nicht öffnen, Absender anrufen.",
  "foot.coffee": "☕ Gib einen Kaffee aus", "foot.privacy": "Datenschutz", "foot.source": "Quelltext",
  "wait.check": "⏳ Ich schaue mir den Link von außen an — Domain, Alter, Datenbanken … (5–10 Sekunden)",
  "err.nolink": "Das sieht nicht nach einem Link aus. Bitte den Link (oder die Nachricht mit dem Link) einfügen.",
  "err.clip": "Dein Browser gibt die Zwischenablage nicht frei — bitte lange drücken und „Einfügen“ wählen.",
  "err.net": "Keine Verbindung zur Linkwache. Bitte nochmal versuchen.", "err.fail": "Prüfung fehlgeschlagen.",
  "err.rate": "Zu viele Prüfungen in kurzer Zeit. Bitte eine Minute warten.",
  "err.notfound": "Kein Ergebnis unter dieser Kennung (Ergebnisse werden nach 90 Tagen gelöscht).",
  "r.checked": "Geprüfter Link", "r.unwrapped": "Kurzlink aufgelöst", "r.facts": "Technische Fakten",
  "r.domain": "Domain", "r.subdomain": "Unter-Domain", "r.registered": "Registriert", "r.unknown": "unbekannt", "r.ips": "Server-Adressen", "r.none": "keine",
  "r.ns": "Nameserver", "r.mx": "Mail-Server", "r.present": "vorhanden", "r.certs": "Zertifikate", "r.certs.n": "{n} Einträge, erster {d}", "r.na": "nicht abrufbar",
  "r.dbs": "Datenbanken", "r.hit": "Treffer", "r.nohit": "kein Treffer", "r.listed": "gelistet", "r.notsetup": "nicht eingerichtet", "r.scans": "{n} frühere Scans", "r.noscans": "keine früheren Scans",
  "r.when": "Geprüft", "r.copy": "Ergebnis-Link kopieren", "r.copied": "Kopiert ✓", "r.wa": "Per WhatsApp teilen",
  "r.wa.text": "Ich habe den Link mit der Linkwache geprüft: {kurz} — {url}", "r.again": "Anderen Link prüfen",
  "r.shot": "So sieht die Seite aus — aufgenommen in der Sandbox von urlscan.io, nicht auf deinem Gerät.", "r.shot.title": "Titel: „{t}“.", "r.shot.server": "Server: {c}.", "r.shot.report": "Sandbox-Bericht",
  "r.pending": "⏳ Die Sandbox nimmt gerade einen Screenshot der Seite auf (dauert etwa eine halbe Minute) …",
  "r.share.lbl": "Link zu diesem Ergebnis — zum Weitergeben:",
  "r.noshot": "Die Sandbox konnte die Seite nicht laden — deshalb gibt es keinen Screenshot. Das passiert bei ganz frischen Seiten oder wenn eine Seite Prüfdienste abweist; die Bewertung oben gilt trotzdem.", "r.noshot.err": "Meldung der Sandbox: {e}.",
  "r.timeout": "Die Sandbox hat nicht rechtzeitig geantwortet — die Bewertung oben gilt trotzdem.",
  "r.nf.h": "Kein Ergebnis unter dieser Kennung", "r.nf.p": "Ergebnisse werden nach 90 Tagen gelöscht.", "r.nf.new": "Neu prüfen",
  "stufe.rot": "Nicht öffnen", "stufe.gelb": "Vorsicht", "stufe.gruen": "Keine Warnzeichen",
  "v.rot.multi": "Betrug — mehrere klare Warnzeichen", "v.rot.one": "Sehr wahrscheinlich Betrug",
  "v.rot.rat": "Nicht öffnen, nichts eingeben, nicht weiterleiten. Wenn ein Freund den Link geschickt hat: anrufen — sein Konto ist vermutlich gekapert.",
  "v.gelb.multi": "Auffällig — nur mit Vorsicht", "v.gelb.multi.rat": "Nur öffnen, wenn du genau diesen Absender und genau diese Adresse erwartest. Im Zweifel die Firma über ihre bekannte Seite oder App direkt aufrufen.",
  "v.gelb.one": "Ein Warnzeichen — genauer hinsehen", "v.gelb.one.rat": "Ein einzelnes Warnzeichen reicht nicht für ein Urteil. Prüfe, ob der Absender diesen Link wirklich geschickt hat.",
  "v.gruen": "Keine Warnzeichen gefunden", "v.gruen.rat": "Das ist kein Freispruch: ganz neue Betrugsseiten stehen in keiner Liste. Bleib misstrauisch, wenn die Seite Passwörter, Codes oder Zahlungsdaten will.",
  "pat.vote": "Passt zur „Abstimmungsmasche“ (WhatsApp-Kontodiebstahl)", "pat.vote.t": "„Stimm bitte für … ab“ → Handynummer → Code für „Verknüpfte Geräte“. Wer den Code eingibt, gibt sein WhatsApp ab. Der Absender ist meist selbst schon gekapert — ruf ihn an.",
  "pat.parcel": "Passt zur „Paket-Masche“", "pat.parcel.t": "Angeblich hängt ein Paket fest, eine kleine Gebühr soll es freigeben. Ziel sind Kartendaten. Pakete verfolgt man nur über die App oder Seite des Versenders, die man selbst aufruft.",
  "pat.bank": "Passt zur „Bank-Masche“", "pat.bank.t": "Eine Bank schickt nie Links zum Anmelden. Wenn dein Konto wirklich ein Problem hat, siehst du es in der App oder auf der Seite, die du selbst eintippst.",
  "f.ip-host": "Nackte IP-Adresse statt Domainname", "f.ip-host.t": "Seriöse Anbieter verlinken auf ihren Namen, nicht auf eine Zahlenadresse.",
  "f.at-sign": "„@“ im Link", "f.at-sign.t": "Alles vor dem @ ist Täuschung — der Browser geht dorthin, was NACH dem @ steht.",
  "f.idn": "Sonderzeichen im Domainnamen", "f.idn.t": "Der Name enthält Zeichen, die wie lateinische Buchstaben aussehen ({host}). So wird z. B. „paypaI“ mit großem i aus „paypal“.",
  "f.http": "Unverschlüsselt (http statt https)", "f.http.t": "Fast jede echte Seite ist heute verschlüsselt. Ein http-Link ist entweder alt oder nachlässig.",
  "f.port": "Ungewöhnlicher Port :{port}", "f.port.t": "Normale Webseiten brauchen keine Portnummer im Link.",
  "f.tld": "Endung .{tld} ist bei Betrügern beliebt", "f.tld.t": "Billig und anonym zu registrieren. Firmen, Banken und Behörden nutzen so etwas praktisch nie.",
  "f.brand-sub": "„{brand}“ steht nur VOR der eigentlichen Domain", "f.brand-sub.t": "Die Seite gehört {domain}, nicht {brand}. Der Markenname vorne ist Tarnung — der Besitzer ist immer der Teil direkt vor der Endung.",
  "f.brand-typo": "Sieht aus wie „{brand}“, ist es aber nicht", "f.brand-typo.t": "{domain} ist eine andere Domain als die echte von {brand}. Zusätze wie „-login“, „-service“ oder Tippfehler sind das klassische Muster.",
  "f.subdomains": "Sehr viele Unter-Domains", "f.subdomains.t": "Lange Ketten vor dem eigentlichen Namen sollen den Blick vom Besitzer ablenken.",
  "f.lure": "Köderwörter im Link: {words}", "f.lure.t": "Wörter wie „login“, „verify“, „vote“ oder „paket“ sollen Handlungsdruck erzeugen.",
  "f.shortener": "Kurzlink", "f.shortener.t": "Das Ziel ist versteckt. Die Linkwache löst ihn auf, ohne das Ziel zu öffnen.",
  "f.long": "Sehr langer Link", "f.long.t": "Lange Zeichenketten enthalten oft eine Kennung, die genau dich wiedererkennt.",
  "f.unwrapped": "Kurzlink führt zu {host}", "f.unwrapped.t": "Aufgelöst, ohne das Ziel zu öffnen. Beurteilt wird das Ziel.",
  "f.nxdomain": "Domain ist (noch) nicht erreichbar", "f.nxdomain.t": "Kein Server hinterlegt — entweder schon abgeschaltet oder noch nicht scharf.",
  "f.cloudflare": "Versteckt hinter Cloudflare", "f.cloudflare.t": "Der echte Server ist nicht sichtbar. Viele seriöse Seiten nutzen das auch — bei einer frischen Domain ist es aber typisch für Betrugskampagnen.",
  "f.no-mx": "Keine E-Mail-Einträge", "f.no-mx.t": "Eine Firma hat Mailadressen unter ihrer Domain. Hier gibt es keine — die Domain existiert nur für diese Seite.",
  "f.dns-error": "DNS-Auskunft nicht erreichbar", "f.dns-error.t": "Die Namensauflösung hat nicht geantwortet — dieser Teil der Prüfung fehlt.",
  "f.rdap-none": "Registrierungsdaten nicht abrufbar", "f.rdap-none.t": "Manche Endungen (z. B. .de) geben das Alter nicht öffentlich heraus.",
  "f.age-fresh": "Domain erst vor {age} registriert", "f.age-fresh.t": "Fast alle Betrugsseiten leben auf Domains, die Tage oder Stunden alt sind. Echte Firmen haben ihre Adresse seit Jahren.",
  "f.age-young": "Domain ist erst {age} Tage alt", "f.age-young.t": "Jung. Kein Beweis, aber ein Grund, genauer hinzusehen.",
  "f.age-old": "Domain seit {years} Jahren registriert", "f.age-old.t": "Betrüger halten Domains selten so lange.",
  "age.hours": "wenigen Stunden", "age.days": "{n} Tag(en)",
  "f.ct-none": "Kein Zertifikat in den öffentlichen Listen", "f.ct-none.t": "Jede https-Seite hinterlässt dort eine Spur — keine Spur heißt: sehr neu oder nie ordentlich eingerichtet.",
  "f.safebrowsing": "Google Safe Browsing warnt vor dieser Seite", "f.safebrowsing.t": "Dieselbe Liste, die Chrome und Firefox ein rotes Warnschild zeigen lässt: {types}",
  "f.urlhaus": "Bei URLhaus als Schadsoftware-Verteiler gelistet", "f.urlhaus.t": "{n} gemeldete Adresse(n) unter diesem Host.",
  "f.phishtank": "Bei PhishTank als Phishing gemeldet", "f.phishtank.t.v": "Von Freiwilligen bestätigt.", "f.phishtank.t.u": "Gemeldet, noch nicht bestätigt.",
  "f.urlscan-verdict": "Die Sandbox stuft die Seite als bösartig ein", "f.urlscan-verdict.t": "Automatische Einstufung von urlscan.io.", "f.urlscan-verdict.b": "Sie ahmt nach: {brands}",
  "f.db-clean": "In {n} Betrugsdatenbank(en) nicht gelistet", "f.db-clean.t": "Das ist kein Freispruch: neue Betrugsseiten stehen die ersten Stunden nirgends.",
  "tg.start": "Hallo! Schick mir einen verdächtigen Link — oder leite mir die Nachricht weiter, in der er steckt. Ich prüfe ihn, ohne ihn zu öffnen, und sage dir in einfachen Worten, was dran ist.\n\nIch speichere keine Namen und keine Nummern, nur den geprüften Link.",
  "tg.nolink": "Ich habe in der Nachricht keinen Link gefunden. Schick mir den Link selbst oder leite die Nachricht weiter, in der er steht.",
  "tg.wait1": "Einen Moment, ich prüfe den Link …", "tg.waitn": "Einen Moment, ich prüfe {n} Links …", "tg.fail": "Die Prüfung ist fehlgeschlagen: {e}",
  "txt.checked": "Geprüft: {url}", "txt.details": "Alle Details: {url}",
  "mail.nolink": "Hallo,\n\nin der weitergeleiteten Mail habe ich keinen Link gefunden. Bitte leite die verdächtige Mail so weiter, wie sie ist (nicht als Anhang), oder schick den Link direkt.\n\n– Linkwache",
  "mail.intro1": "Hallo,\n\nich habe den Link aus deiner Mail geprüft — ohne ihn zu öffnen.\n\n", "mail.intron": "Hallo,\n\nich habe {n} Links aus deiner Mail geprüft — ohne sie zu öffnen.\n\n",
  "mail.outro": "\n\nDie Linkwache sucht Warnzeichen, sie beweist keine Unschuld. Bei Rot: nicht öffnen, nichts eingeben, Absender anrufen.\n\n– Linkwache · {site}", "mail.contact": "\nRückfragen: {mail}", "mail.re": "Linkprüfung",
};

S.en = {
  "site.tagline": "Check a link without opening it",
  "site.desc": "Paste a suspicious link, read the traffic light. Free, no sign-up, nothing is opened on your device.",
  "nav.how": "How it works", "nav.legal": "Legal notice", "nav.start": "Home",
  "home.h1": "Got a strange link? Check first, then click — or don’t.",
  "home.lead": "Paste the link (or the whole message). Linkwache looks at it from the outside — nothing is opened on your phone — and tells you in plain words what’s going on.",
  "home.label": "Paste the link or message here",
  "home.placeholder": "e.g. https://beispiel-seite.example/gewinn — or the whole WhatsApp message",
  "home.check": "Check link", "home.checking": "Checking …", "home.paste": "Paste from clipboard",
  "home.hint": "Free · no sign-up · we only store the checked link — no names, no numbers.",
  "home.how.h": "How it works in any messenger",
  "home.s1.h": "1 · Press and hold the link", "home.s1.p": "In WhatsApp, Signal, Telegram, SMS or mail, long-press the link → “Copy” (don’t tap it!).",
  "home.s2.h": "2 · Paste it here", "home.s2.p": "Open this page, paste at the top, “Check link”. Done.",
  "home.s3.h": "3 · Share the result", "home.s3.p": "The result link can be forwarded — to whoever sent you the link.",
  "home.fast.h": "Even faster",
  "home.android.h": "📱 Android: “Share”", "home.android.p": "Add this page to your home screen once via the browser menu. Linkwache then appears in every messenger’s share menu.",
  "home.ios.h": "🍎 iPhone: Shortcut", "home.ios.p": "Create the shortcut once (3 steps, 1 minute). Then: share link → “Linkwache”.", "home.ios.link": "Create the shortcut",
  "home.mail.h": "✉️ By mail", "home.mail.p": "Just forward a suspicious mail to {mail}. The reply comes automatically.",
  "home.tg.h": "💬 Telegram", "home.tg.p": "Forward the message to {bot} — answer within seconds.",
  "home.what.h": "What is checked?",
  "home.what.p": "Age and owner of the domain, its ending, hiding behind Cloudflare, certificates, short-link targets, imitated brand names, bait words, the fraud databases of Google Safe Browsing, URLhaus and PhishTank, earlier sandbox scans — and a screenshot of the page taken in a sandbox so you can see what not to click. The link is never opened on your device.",
  "foot.note": "Linkwache looks for warning signs — it does not prove innocence. On red: don’t open, call the sender.",
  "foot.coffee": "☕ Buy me a coffee", "foot.privacy": "Privacy", "foot.source": "Source code",
  "wait.check": "⏳ Looking at the link from the outside — domain, age, databases … (5–10 seconds)",
  "err.nolink": "That doesn’t look like a link. Please paste the link (or the message containing it).",
  "err.clip": "Your browser won’t share the clipboard — please long-press and choose “Paste”.",
  "err.net": "No connection to Linkwache. Please try again.", "err.fail": "Check failed.",
  "err.rate": "Too many checks in a short time. Please wait a minute.",
  "err.notfound": "No result under this ID (results are deleted after 90 days).",
  "r.checked": "Checked link", "r.unwrapped": "Short link resolved", "r.facts": "Technical facts",
  "r.domain": "Domain", "r.subdomain": "subdomain", "r.registered": "Registered", "r.unknown": "unknown", "r.ips": "Server addresses", "r.none": "none",
  "r.ns": "Name servers", "r.mx": "Mail servers", "r.present": "present", "r.certs": "Certificates", "r.certs.n": "{n} entries, first {d}", "r.na": "not available",
  "r.dbs": "Databases", "r.hit": "hit", "r.nohit": "no hit", "r.listed": "listed", "r.notsetup": "not configured", "r.scans": "{n} earlier scans", "r.noscans": "no earlier scans",
  "r.when": "Checked", "r.copy": "Copy result link", "r.copied": "Copied ✓", "r.wa": "Share via WhatsApp",
  "r.wa.text": "I checked this link with Linkwache: {kurz} — {url}", "r.again": "Check another link",
  "r.shot": "This is what the page looks like — captured in the urlscan.io sandbox, not on your device.", "r.shot.title": "Title: “{t}”.", "r.shot.server": "Server: {c}.", "r.shot.report": "Sandbox report",
  "r.pending": "⏳ The sandbox is taking a screenshot of the page (about half a minute) …",
  "r.share.lbl": "Link to this result — to pass on:",
  "r.noshot": "The sandbox could not load the page — so there is no screenshot. This happens with brand-new pages or when a page turns away checking services; the verdict above still stands.", "r.noshot.err": "Sandbox message: {e}.",
  "r.timeout": "The sandbox didn’t answer in time — the verdict above still stands.",
  "r.nf.h": "No result under this ID", "r.nf.p": "Results are deleted after 90 days.", "r.nf.new": "Check again",
  "stufe.rot": "Do not open", "stufe.gelb": "Caution", "stufe.gruen": "No warning signs",
  "v.rot.multi": "Scam — several clear warning signs", "v.rot.one": "Very likely a scam",
  "v.rot.rat": "Don’t open it, don’t enter anything, don’t forward it. If a friend sent it: call them — their account is probably hijacked.",
  "v.gelb.multi": "Suspicious — caution only", "v.gelb.multi.rat": "Only open it if you expect exactly this sender and exactly this address. When in doubt, go to the company’s known site or app yourself.",
  "v.gelb.one": "One warning sign — look closer", "v.gelb.one.rat": "A single warning sign isn’t a verdict. Check whether the sender really sent this link.",
  "v.gruen": "No warning signs found", "v.gruen.rat": "That is not an acquittal: brand-new scam sites aren’t on any list yet. Stay wary if the page asks for passwords, codes or payment details.",
  "pat.vote": "Matches the “voting scam” (WhatsApp account theft)", "pat.vote.t": "“Please vote for …” → phone number → code for “Linked devices”. Whoever enters the code hands over their WhatsApp. The sender is usually hijacked already — call them.",
  "pat.parcel": "Matches the “parcel scam”", "pat.parcel.t": "A parcel is supposedly stuck and a small fee will release it. The target is your card data. Track parcels only via the carrier’s own app or site that you open yourself.",
  "pat.bank": "Matches the “bank scam”", "pat.bank.t": "A bank never sends links to log in. If your account really has a problem, you’ll see it in the app or on the site you type in yourself.",
  "f.ip-host": "Bare IP address instead of a domain name", "f.ip-host.t": "Serious providers link to their name, not to a numeric address.",
  "f.at-sign": "“@” in the link", "f.at-sign.t": "Everything before the @ is a decoy — the browser goes to what comes AFTER the @.",
  "f.idn": "Special characters in the domain name", "f.idn.t": "The name contains characters that look like Latin letters ({host}). That’s how “paypaI” with a capital i is made from “paypal”.",
  "f.http": "Unencrypted (http instead of https)", "f.http.t": "Almost every real site is encrypted today. An http link is either old or careless.",
  "f.port": "Unusual port :{port}", "f.port.t": "Normal websites don’t need a port number in the link.",
  "f.tld": "The ending .{tld} is popular with scammers", "f.tld.t": "Cheap and anonymous to register. Companies, banks and authorities practically never use it.",
  "f.brand-sub": "“{brand}” only appears BEFORE the real domain", "f.brand-sub.t": "The page belongs to {domain}, not to {brand}. The brand name up front is camouflage — the owner is always the part right before the ending.",
  "f.brand-typo": "Looks like “{brand}”, but isn’t", "f.brand-typo.t": "{domain} is a different domain from {brand}’s real one. Additions like “-login”, “-service” or typos are the classic pattern.",
  "f.subdomains": "Very many subdomains", "f.subdomains.t": "Long chains in front of the real name are meant to distract from the owner.",
  "f.lure": "Bait words in the link: {words}", "f.lure.t": "Words like “login”, “verify”, “vote” or “parcel” are meant to create pressure to act.",
  "f.shortener": "Short link", "f.shortener.t": "The target is hidden. Linkwache resolves it without opening the target.",
  "f.long": "Very long link", "f.long.t": "Long strings often contain an ID that identifies exactly you.",
  "f.unwrapped": "Short link leads to {host}", "f.unwrapped.t": "Resolved without opening the target. The target is what gets judged.",
  "f.nxdomain": "Domain is not reachable (yet)", "f.nxdomain.t": "No server behind it — either already shut down or not live yet.",
  "f.cloudflare": "Hidden behind Cloudflare", "f.cloudflare.t": "The real server isn’t visible. Many legitimate sites use this too — on a fresh domain, though, it’s typical for scam campaigns.",
  "f.no-mx": "No e-mail records", "f.no-mx.t": "A company has mail addresses under its domain. There are none here — the domain exists only for this page.",
  "f.dns-error": "DNS lookup unavailable", "f.dns-error.t": "Name resolution didn’t answer — this part of the check is missing.",
  "f.rdap-none": "Registration data not available", "f.rdap-none.t": "Some endings (e.g. .de) don’t publish the age.",
  "f.age-fresh": "Domain registered only {age} ago", "f.age-fresh.t": "Almost all scam sites live on domains that are days or hours old. Real companies have had their address for years.",
  "f.age-young": "Domain is only {age} days old", "f.age-young.t": "Young. Not proof, but a reason to look closer.",
  "f.age-old": "Domain registered for {years} years", "f.age-old.t": "Scammers rarely keep domains that long.",
  "age.hours": "a few hours", "age.days": "{n} day(s)",
  "f.ct-none": "No certificate in the public logs", "f.ct-none.t": "Every https site leaves a trace there — no trace means: very new or never set up properly.",
  "f.safebrowsing": "Google Safe Browsing warns about this page", "f.safebrowsing.t": "The same list that makes Chrome and Firefox show a red warning: {types}",
  "f.urlhaus": "Listed at URLhaus as a malware distributor", "f.urlhaus.t": "{n} reported address(es) under this host.",
  "f.phishtank": "Reported to PhishTank as phishing", "f.phishtank.t.v": "Confirmed by volunteers.", "f.phishtank.t.u": "Reported, not yet confirmed.",
  "f.urlscan-verdict": "The sandbox rates this page as malicious", "f.urlscan-verdict.t": "Automatic rating by urlscan.io.", "f.urlscan-verdict.b": "It imitates: {brands}",
  "f.db-clean": "Not listed in {n} fraud database(s)", "f.db-clean.t": "That is not an acquittal: new scam sites aren’t listed anywhere for the first hours.",
  "tg.start": "Hi! Send me a suspicious link — or forward me the message it’s in. I check it without opening it and tell you in plain words what’s going on.\n\nI store no names and no numbers, only the checked link.",
  "tg.nolink": "I couldn’t find a link in that message. Send me the link itself or forward the message it’s in.",
  "tg.wait1": "One moment, checking the link …", "tg.waitn": "One moment, checking {n} links …", "tg.fail": "The check failed: {e}",
  "txt.checked": "Checked: {url}", "txt.details": "All details: {url}",
  "mail.nolink": "Hello,\n\nI couldn’t find a link in the forwarded mail. Please forward the suspicious mail as it is (not as an attachment), or send the link directly.\n\n– Linkwache",
  "mail.intro1": "Hello,\n\nI checked the link from your mail — without opening it.\n\n", "mail.intron": "Hello,\n\nI checked {n} links from your mail — without opening them.\n\n",
  "mail.outro": "\n\nLinkwache looks for warning signs, it does not prove innocence. On red: don’t open, don’t enter anything, call the sender.\n\n– Linkwache · {site}", "mail.contact": "\nQuestions: {mail}", "mail.re": "Link check",
};

Object.assign(S, MORE);
export const STRINGS = S;

/** Befund (key, stufe, p) → Titel + Text in der Sprache. */
export function findingText(lang, f) {
  const k = f.muster ? "pat." + f.key : "f." + f.key;
  let text;
  if (f.key === "phishtank") text = t(lang, f.p?.verified ? "f.phishtank.t.v" : "f.phishtank.t.u");
  else if (f.key === "urlscan-verdict") text = f.p?.brands ? t(lang, "f.urlscan-verdict.b", f.p) : t(lang, "f.urlscan-verdict.t");
  else if (f.key === "age-fresh") text = t(lang, "f.age-fresh.t");
  else text = t(lang, k + ".t", f.p || {});
  let titel;
  if (f.key === "age-fresh") titel = t(lang, "f.age-fresh", { age: f.p.days === 0 ? t(lang, "age.hours") : t(lang, "age.days", { n: f.p.days }) });
  else titel = t(lang, k, f.p || {});
  return { titel, text };
}

/** Urteil (kurzKey, ratKey) → Texte. */
export function verdictText(lang, v) {
  return { kurz: t(lang, v.kurzKey), rat: t(lang, v.ratKey), stufe: t(lang, "stufe." + v.stufe) };
}
