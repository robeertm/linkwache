# Linkwache einrichten — Schritt für Schritt

Geschrieben für: Robert, der die Linkwache selbst ans Netz bringt. Alles, was ein Konto oder eine
Zustimmung braucht, musst du selbst machen; alles danach kann ich (oder du mit `wrangler`) erledigen.
Reihenfolge einhalten — jeder Block baut auf dem vorigen auf. Gesamtzeit ohne Domain-Freischaltung:
etwa eine Stunde.

## 0 · Was du brauchst

| | Wofür | Kosten |
|---|---|---|
| Cloudflare-Konto | Hosting (Worker, KV, Email Routing, Domain-DNS) | 0 € |
| Domain `linkwache.de` (frei, Stand 18.09.2026) | Adresse, Mail-Eingang | ~5–10 €/Jahr |
| urlscan.io-Konto | Sandbox-Screenshots | 0 € (Free: 100 Scans/Tag reichen) |
| Google-Cloud-Projekt | Safe-Browsing-Schlüssel | 0 € (10 000 Abfragen/Tag) |
| Telegram-Bot (@BotFather) | Telegram-Eingang | 0 € |
| PayPal.me-Name | Spendenknopf | 0 € |
| Node.js ≥ 20 auf deinem Mac | `wrangler` (Kommandozeile) | 0 € |

## 1 · Cloudflare-Konto und Domain

1. https://dash.cloudflare.com → Konto anlegen (E-Mail + Passwort, 2FA einschalten).
2. **Domain registrieren:** links „Domain Registration“ → „Register Domains“ → `linkwache.de` suchen →
   kaufen. Cloudflare verkauft zum Einkaufspreis; die Domain liegt dann direkt bei Cloudflare, DNS ist
   automatisch richtig. (Alternative: Domain woanders kaufen und die Nameserver auf Cloudflare umstellen —
   dauert bis zu 24 h länger.)
3. Nach dem Kauf: „Websites“ → `linkwache.de` erscheint mit Status „Active“.

## 2 · Wrangler auf dem Mac

```
cd ~/Projects/linkwache
npm install
npx wrangler login          # öffnet den Browser, einmal „Allow“ klicken
npx wrangler whoami         # muss dein Konto zeigen
```

## 3 · KV-Speicher anlegen

```
npx wrangler kv namespace create RESULTS
```
Die Ausgabe enthält `id = "…"`. Diese ID in `wrangler.toml` bei `[[kv_namespaces]]` statt `REPLACE_ME`
eintragen. Fertig — mehr Speicher gibt es nicht; Ergebnisse löschen sich nach 90 Tagen selbst.

## 4 · Erster Deploy (noch ohne Schlüssel)

```
npx wrangler deploy
```
Ausgabe: `https://linkwache.<dein-konto>.workers.dev`. Aufrufen — die Seite läuft schon, nur ohne
Sandbox-Screenshot und ohne Safe Browsing. Dann die eigene Domain dazu:

Cloudflare-Dashboard → „Workers & Pages“ → `linkwache` → „Settings“ → „Domains & Routes“ → „Add“ →
„Custom Domain“ → `linkwache.de` (und noch einmal `www.linkwache.de`). Zertifikat kommt automatisch,
nach 1–5 Minuten ist https://linkwache.de live.

## 5 · Schlüssel (Secrets) — jeweils einmal `wrangler secret put`

Jeder Befehl fragt den Wert interaktiv ab; nichts landet in Dateien oder im Repo.

### 5a · Google Safe Browsing
1. https://console.cloud.google.com → Projekt anlegen (Name egal, z. B. „linkwache“).
2. „APIs & Services“ → „Library“ → **„Safe Browsing API“** → Enable.
3. „Credentials“ → „Create credentials“ → „API key“. Den Schlüssel unter „Edit“ auf die
   Safe-Browsing-API beschränken (Restrict key → API restrictions).
4. `npx wrangler secret put SAFE_BROWSING_KEY`
Bedingungen: nur nicht-kommerzielle Nutzung; auf der Seite steht der Pflichthinweis
„Advisory provided by Google“ bereits (render.js).

### 5b · urlscan.io (Sandbox-Screenshots)
1. https://urlscan.io → „Sign up“ (E-Mail). 2. Rechts oben → „Settings & API“ → „API Keys“ → „Create
new API key“. 3. `npx wrangler secret put URLSCAN_KEY`.
Die Linkwache scannt mit Sichtbarkeit **unlisted** (nicht per Suche auffindbar). Free-Kontingent: 100
unlisted Scans/Tag — reicht für den Freundeskreis.

### 5c · URLhaus (optional)
https://auth.abuse.ch → Konto → Auth-Key → `npx wrangler secret put URLHAUS_KEY`. Ohne Schlüssel
wird URLhaus einfach übersprungen (steht dann als „nicht erreichbar“ in den Fakten).

### 5d · Telegram-Bot
1. In Telegram `@BotFather` öffnen → `/newbot` → Name „Linkwache“, Benutzername z. B. `LinkwacheBot`
   (muss auf „bot“ enden). BotFather gibt dir den **Token**.
2. `npx wrangler secret put TELEGRAM_TOKEN` (den Token einfügen)
3. Ein Geheimnis ausdenken (20+ Zeichen, z. B. aus `openssl rand -hex 16`):
   `npx wrangler secret put TELEGRAM_SECRET`
4. Webhook setzen (Token und Geheimnis einsetzen):
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://linkwache.de/telegram&secret_token=<GEHEIMNIS>&drop_pending_updates=true"
   ```
   Antwort muss `"ok":true` sein.
5. In `wrangler.toml`: `TELEGRAM_BOT = "LinkwacheBot"` → `npx wrangler deploy`. Dann taucht die
   Telegram-Kachel auf der Startseite auf.
6. Test: dem Bot einen Link schicken.

### 5e · Mail-Eingang (pruefen@linkwache.de)
1. Dashboard → `linkwache.de` → **„Email“ → „Email Routing“** → „Get started“ → die vorgeschlagenen
   MX/TXT-Einträge „Add records automatically“.
2. „Routing rules“ → „Create address“: `pruefen` → Action **„Send to a Worker“** → `linkwache`.
3. In `wrangler.toml`: `MAIL_IN = "on"` und `CONTACT_MAIL = "pruefen@linkwache.de"` →
   `npx wrangler deploy`.
4. Test: eine Mail mit einem Link an pruefen@linkwache.de schicken — die Antwort kommt binnen einer
   Minute vom selben Absender zurück. (Cloudflare antwortet nur an die Adresse, von der die Mail kam.)

### 5f · Spendenknopf
1. https://paypal.me → „Create your PayPal.Me link“ → Namen wählen (z. B. `paypal.me/RobertM`).
   Dein bestehendes PayPal-Konto reicht; es muss kein Geschäftskonto sein.
2. In `wrangler.toml`: `PAYPAL_ME = "RobertM"` → `npx wrangler deploy`. Der Knopf „☕ Gib einen Kaffee
   aus“ erscheint im Fuß jeder Seite.

## 6 · Impressum und Datenschutz ausfüllen

`public/impressum.html`: die Platzhalter `[Vorname Nachname]`, `[Straße Hausnummer]`, `[PLZ Ort]`,
`[kontakt@…]` ersetzen. `public/datenschutz.html` ist fertig und passt zur tatsächlichen Technik
(keine Cookies, keine IPs, 90 Tage Ergebnisse, Liste der Drittdienste). Danach `npx wrangler deploy`.

## 7 · Nutzer-Anleitung (was du deinen Freunden schickst)

> Komischen Link bekommen? Nicht anklicken. Link **lange drücken → Kopieren**, dann
> https://linkwache.de öffnen, einfügen, „Link prüfen“. Oder die Mail an pruefen@linkwache.de
> weiterleiten. Oder die Nachricht an @LinkwacheBot in Telegram weiterleiten.

Android-Nutzer: Seite im Chrome-Menü „Zum Startbildschirm hinzufügen“ → danach unter „Teilen“.
iPhone-Nutzer: https://linkwache.de/kurzbefehl.html (3 Schritte).

## 8 · Betrieb

- **Kosten:** 0 € bei Cloudflare Free (100 000 Worker-Aufrufe/Tag, KV 100 000 Lese-/1 000 Schreibvorgänge
  pro Tag — ein Freundeskreis kommt nie in die Nähe).
- **Missbrauch:** 20 Prüfungen pro Minute je Absender sind im Worker begrenzt. Bei Bedarf im Dashboard
  unter „Security“ → „WAF“ weitere Regeln.
- **Logs:** `npx wrangler tail` zeigt live, was passiert (keine IPs im Log, Links schon).
- **Update:** `git pull && npx wrangler deploy`.
- **Alles abschalten:** Dashboard → Workers → `linkwache` → „Delete“, plus Email-Routing-Regel löschen.

## 9 · Was NICHT im Repo liegt

Alle Schlüssel (`wrangler secret`), die KV-ID steht in `wrangler.toml` (unkritisch), Impressum-Daten
trägst du selbst ein. `.dev.vars` (lokale Schlüssel für `wrangler dev`) ist in `.gitignore`.

---

## Variante B · Selbst gehostet auf einer Synology (oder jedem Docker-Host)

Statt Cloudflare: derselbe Code als Node-Dienst im Container (`server/index.js`, `Dockerfile`,
`deploy/nas/docker-compose.yml`). Kein Cloudflare-Konto nötig; es fehlt nur der Mail-Eingang
(braucht Cloudflare Email Routing).

| Baustein | Wo / Wie |
|---|---|
| Quelle | `/volume1/docker/linkwache/src` (Repo ohne node_modules) |
| Image | `docker build -t linkwache:latest /volume1/docker/linkwache/src` |
| Stack | `/volume1/docker/linkwache/docker-compose.yml` + `linkwache.env` (0600, Vorlage `deploy/nas/linkwache.env.example`) + `data/` (Ergebnisse, 90 Tage) |
| Container | `linkwache`, nur `127.0.0.1:8081`, read-only, cap_drop ALL, no-new-privileges, 256 MB, Nutzer `node`, Watchtower aus |
| Impressum | `LEGAL_NAME`, `LEGAL_STREET`, `LEGAL_CITY`, `LEGAL_PLACE`, `CONTACT_MAIL` in `linkwache.env` — die Seiten `impressum.html`/`datenschutz.html` tragen Platzhalter, der Server füllt sie beim Ausliefern |
| Reverse Proxy (DSM) | drei Regeln für deinen Hostnamen, alle → `localhost:8081`, Header `X-Forwarded-For: $proxy_add_x_forwarded_for`, `X-Forwarded-Proto: $scheme`, `X-Forwarded-Host: $host`: **HTTPS 443** (HSTS), **HTTPS 8443** (HSTS; Ziel der IPv4-Weiterleitung) und **HTTP 80** (der Server antwortet 301 auf https). Zertifikat: das Synology-DDNS-Wildcard-Zertifikat, DSM verlängert es selbst |
| Router | Weiterleitung WAN **443/tcp → NAS:8443** und WAN **80/tcp → NAS:80**. DSM-nginx antwortet fremden Hostnamen auf allen drei Ports nur mit 403/404 — kein DSM-Login nach außen. NAS-443 nicht weiterleiten, wenn dort noch andere Dienste hängen |
| IPv6 | Trägt die DDNS-Adresse auch einen AAAA-Eintrag (die NAS selbst), landen Geräte im eigenen LAN per IPv6 **direkt auf NAS-Port 443** — deshalb die 443-Regel. Ohne sie: falsches Zertifikat + 403 im eigenen Haus, während es von außen (IPv4) läuft. Immer mit `curl -4` **und** `curl -6` prüfen |
| Ergänzungen | Telegram/Safe Browsing/urlscan sobald die Schlüssel in `linkwache.env` stehen (`docker-compose up -d` danach). iPhone-Kurzbefehl: `public/Linkwache.shortcut` ist mit `shortcuts sign --mode anyone` signiert und zeigt auf die Instanz, für die er gebaut wurde — für eine eigene Instanz neu erzeugen und signieren (macOS) |

**Update einspielen:** neuen Tarball nach `/volume1/docker/linkwache/src`, `docker build …`, `docker-compose up -d`.
**Abschalten:** `docker-compose down` im Stack-Ordner + Router-Weiterleitungen deaktivieren.
