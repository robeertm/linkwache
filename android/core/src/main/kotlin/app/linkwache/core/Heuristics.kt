package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Offline heuristics and verdict, ported from `src/checks.js` (`heuristics`) and
 * `src/verdict.js`. The shared vectors in `test/vectors/heuristics.json` pin this port.
 */
object Heuristics {
    val RISKY_TLDS = setOf(
        "zip", "mov", "top", "xyz", "icu", "cfd", "rest", "sbs", "cyou", "click", "gq", "ml", "cf", "ga", "tk", "buzz",
        "monster", "quest", "bond", "lat", "boats", "hair", "makeup", "skin", "beauty", "motorcycles", "autos", "cam",
        "surf", "fun", "life", "run", "live", "work", "world", "link", "site", "online", "website", "space", "store",
        "shop", "vip", "biz.id", "my.id", "web.id", "co.vu", "pw", "su", "ws", "cc", "asia", "bar", "best",
    )

    val BRANDS = listOf(
        "paypal", "sparkasse", "volksbank", "postbank", "commerzbank", "deutschebank", "ing-diba", "dkb", "comdirect",
        "n26", "klarna", "amazon", "dhl", "dpd", "hermes", "ups", "fedex", "deutschepost", "whatsapp", "telegram",
        "signal", "instagram", "facebook", "microsoft", "office365", "outlook", "apple", "icloud", "google", "netflix",
        "disney", "spotify", "ebay", "kleinanzeigen", "vinted", "zalando", "otto", "lidl", "aldi", "rewe", "telekom",
        "vodafone", "o2", "1und1", "ionos", "strato", "gmx", "web.de", "bahn", "elster", "bundesagentur", "finanzamt",
        "polizei", "ikea", "steam", "playstation", "xbox", "coinbase", "binance", "bitpanda", "trade-republic",
        "scalable", "check24", "booking", "airbnb",
    )

    val BRAND_HOMES = setOf(
        "office.com", "office365.com", "live.com", "outlook.com", "microsoft.com", "microsoftonline.com",
        "sharepoint.com", "onedrive.com", "xbox.com", "apple.com", "icloud.com", "google.com", "google.de",
        "gmail.com", "youtube.com", "googleusercontent.com", "amazon.com", "amazon.de", "paypal.com", "paypal.de",
        "facebook.com", "instagram.com", "whatsapp.com", "dhl.de", "dhl.com", "deutschepost.de", "telekom.de",
        "t-online.de", "ebay.com", "ebay.de", "netflix.com", "spotify.com", "steampowered.com", "steamcommunity.com",
    )

    val LURE_WORDS = listOf(
        "login", "signin", "anmelden", "verify", "verifizier", "bestaetig", "bestätig", "secure", "sicherheit", "konto",
        "account", "update", "aktualisier", "wallet", "sperr", "unlock", "freischalt", "vote", "voting", "abstimm",
        "gewinn", "prize", "bonus", "paket", "zustell", "delivery", "zoll", "customs", "gebuehr", "invoice", "rechnung",
        "mahnung", "steuer", "refund", "rueckerstatt", "support", "helpdesk", "2fa", "otp", "code", "webmail",
        "password", "passwort",
    )

    val SHORTENERS = setOf(
        "bit.ly", "t.co", "tinyurl.com", "cutt.ly", "rb.gy", "is.gd", "goo.gl", "ow.ly", "buff.ly", "t.ly",
        "shorturl.at", "rebrand.ly", "s.id", "lnkd.in", "tiny.cc", "shorte.st", "adf.ly", "u.to", "v.gd", "qr.ae",
        "bl.ink", "short.io", "kurzelinks.de", "t1p.de", "ogy.de", "1url.de", "shorturl.com", "surl.li", "clck.ru",
        "vk.cc",
    )

    /** `heuristics(url)`; `raw` is the URL string as received (length and `@` are inspected). */
    fun heuristics(raw: String): List<Finding>? = raw.toHttpUrlOrNull()?.let { heuristics(raw, it) }

    fun heuristics(raw: String, u: HttpUrl): List<Finding> {
        val f = ArrayList<Finding>()
        val h = hostInfo(u)
        if (h.isIp) f += Finding("ip-host", Level.ROT)
        if (u.username.isNotEmpty() || u.password.isNotEmpty() || raw.contains('@')) f += Finding("at-sign", Level.ROT)
        if (h.isIdn) f += Finding("idn", Level.GELB, mapOf("host" to h.unicodeHost))
        if (u.scheme == "http") f += Finding("http", Level.GELB)
        if (h.port.isNotEmpty() && h.port != "80" && h.port != "443") f += Finding("port", Level.GELB, mapOf("port" to h.port))

        val tldKey = h.tld.lowercase()
        val tldTail = tldKey.substringAfterLast('.')
        if (tldKey in RISKY_TLDS || tldTail in RISKY_TLDS) f += Finding("tld", Level.GELB, mapOf("tld" to h.tld))

        val domLower = h.domain.lowercase()
        if (domLower !in BRAND_HOMES) {
            fun strip(s: String) = s.filter { it != '-' && it != '.' }
            val domStripped = strip(domLower)
            val subStripped = strip(h.sub)
            val firstLabel = domLower.substringBefore('.')
            for (b in BRANDS) {
                val bb = strip(b)
                val inSub = h.sub.isNotEmpty() && subStripped.contains(bb)
                val inDomain = domStripped.contains(bb)
                val isBrandDomain = domLower == "$b.${h.tld}" || domLower.startsWith("$b.")
                if (inSub && !isBrandDomain) {
                    f += Finding("brand-sub", Level.ROT, mapOf("brand" to b, "domain" to h.domain))
                    break
                }
                if (inDomain && !isBrandDomain && firstLabel != b) {
                    f += Finding("brand-typo", Level.ROT, mapOf("brand" to b, "domain" to h.domain))
                    break
                }
            }
        }

        if (h.subCount >= 3) f += Finding("subdomains", Level.GELB)

        val pathLow = decodeLenient(h.path).lowercase()
        val hits = LURE_WORDS.filter { pathLow.contains(it) || domLower.contains(it) }.distinct()
        if (hits.isNotEmpty()) {
            f += Finding("lure", if (hits.size >= 2) Level.GELB else Level.INFO, mapOf("words" to hits.take(4).joinToString(", ")))
        }
        if (h.domain in SHORTENERS) f += Finding("shortener", Level.INFO)
        // JavaScript's String.length counts UTF-16 code units, like Kotlin's.
        if (raw.length > 120) f += Finding("long", Level.INFO)
        return f
    }

    private fun weight(l: Level) = when (l) {
        Level.ROT -> 10
        Level.GELB -> 3
        Level.GRUEN -> -2
        else -> 0
    }

    private fun anyIn(hay: String, words: List<String>) = words.any { hay.contains(it) }

    /** `verdict(findings, { url })` of `src/verdict.js`. */
    fun verdict(findings: List<Finding>, url: String): Verdict {
        val keys = findings.map { it.key }.toSet()
        val low = url.lowercase()
        val all = ArrayList<Finding>()
        if ("age-fresh" in keys && anyIn(low, listOf("vot", "abstimm", "poll", "contest", "wettbewerb", "dance", "tanz", "ballet"))) {
            all += Finding("vote", Level.ROT, pattern = true)
        }
        if (("brand-sub" in keys || "brand-typo" in keys || "age-fresh" in keys) &&
            anyIn(low, listOf("dhl", "dpd", "hermes", "ups", "fedex", "paket", "zustell", "zoll", "customs", "post"))
        ) {
            all += Finding("parcel", Level.ROT, pattern = true)
        }
        if (("brand-sub" in keys || "brand-typo" in keys) &&
            anyIn(low, listOf("bank", "sparkasse", "paypal", "volksbank", "postbank", "dkb", "n26", "ing", "comdirect", "klarna", "tan", "login", "konto"))
        ) {
            all += Finding("bank", Level.ROT, pattern = true)
        }
        all += findings
        val score = all.sumOf { weight(it.level) }
        val rot = all.count { it.level == Level.ROT }
        val gelb = all.count { it.level == Level.GELB }
        val (stufe, kurz, rat) = when {
            rot >= 1 || score >= 10 -> Triple(Level.ROT, if (rot >= 2) "v.rot.multi" else "v.rot.one", "v.rot.rat")
            gelb >= 2 || score >= 5 -> Triple(Level.GELB, "v.gelb.multi", "v.gelb.multi.rat")
            gelb == 1 || score >= 2 -> Triple(Level.GELB, "v.gelb.one", "v.gelb.one.rat")
            else -> Triple(Level.GRUEN, "v.gruen", "v.gruen.rat")
        }
        return Verdict(stufe, kurz, rat, score, all.sortedBy { it.level.order })
    }

    fun assess(raw: String): Verdict? = heuristics(raw)?.let { verdict(it, raw) }
}
