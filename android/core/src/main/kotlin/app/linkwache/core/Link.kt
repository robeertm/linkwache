package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** What arrives at the app: a web link, or anything else (never launched). */
sealed class Incoming {
    data class Web(val url: HttpUrl) : Incoming()
    data class Refused(val scheme: String) : Incoming()
}

enum class Scope(val wire: String) {
    /** `scheme://host[:port]/path` — query string and fragment removed. */
    URL("url"),

    /** `https://host/` only. */
    DOMAIN("domain");

    companion object {
        fun of(s: String?) = if (s == "domain") DOMAIN else URL
    }
}

object Link {
    private val URL_IN_TEXT = Regex("""\bhttps?://[^\s<>"'()\[\]{}]+|\bwww\.[^\s<>"'()\[\]{}]+""", RegexOption.IGNORE_CASE)

    /** Classify what a VIEW intent or a share carried. */
    fun classify(raw: String?): Incoming {
        val s = raw.orEmpty().trim().filter { !it.isISOControl() }
        if (s.isEmpty()) return Incoming.Refused("")
        val scheme = s.substringBefore(':', "").lowercase()
        if (scheme == "http" || scheme == "https") {
            val u = s.toHttpUrlOrNull()
            return if (u != null && u.host.isNotEmpty()) Incoming.Web(u) else Incoming.Refused(scheme)
        }
        if (s.startsWith("www.", ignoreCase = true) && s.none { it.isWhitespace() }) {
            "https://$s".toHttpUrlOrNull()?.let { return Incoming.Web(it) }
        }
        return Incoming.Refused(scheme.take(20))
    }

    /** First web link in shared free text (a message, a mail), or null. */
    fun fromSharedText(text: String?): HttpUrl? {
        for (m in URL_IN_TEXT.findAll(text.orEmpty())) {
            var u = m.value.trimEnd('.', ',', ';', ':', '!', '?', '…', '»', ')')
            if (!u.startsWith("http", ignoreCase = true)) u = "https://$u"
            val parsed = u.toHttpUrlOrNull() ?: continue
            if (parsed.host.contains('.')) return parsed
        }
        return null
    }

    /** What the server receives for a link (docs/DESKTOP.md section 6). */
    fun reduce(u: HttpUrl, scope: Scope): String = when (scope) {
        Scope.DOMAIN -> "https://${hostForUrl(u)}/"
        Scope.URL -> {
            val port = explicitPort(u).let { if (it.isEmpty()) "" else ":$it" }
            "${u.scheme}://${hostForUrl(u)}$port${u.encodedPath}"
        }
    }

    private fun hostForUrl(u: HttpUrl) = if (u.host.contains(':')) "[${u.host}]" else u.host

    /** Server address check: https, or http only on loopback / private networks. Normalised without trailing slash. */
    fun validServer(s: String?): String? {
        val u = s.orEmpty().trim().toHttpUrlOrNull() ?: return null
        val ok = when (u.scheme) {
            "https" -> true
            else -> isLocalHost(u.host)
        }
        if (!ok || u.host.isEmpty()) return null
        val port = explicitPort(u).let { if (it.isEmpty()) "" else ":$it" }
        val path = u.encodedPath.trimEnd('/')
        return "${u.scheme}://${hostForUrl(u)}$port$path"
    }

    private fun isLocalHost(h: String): Boolean {
        if (h == "localhost" || h == "::1" || h.startsWith("127.")) return true
        if (h.startsWith("10.") || h.startsWith("192.168.")) return true
        val m = Regex("^172\\.(\\d+)\\.").find(h)
        if (m != null && m.groupValues[1].toInt() in 16..31) return true
        if (h.startsWith("100.")) {
            val second = h.split('.').getOrNull(1)?.toIntOrNull() ?: return false
            return second in 64..127 // carrier-grade NAT / mesh VPN range
        }
        return h.startsWith("fd") || h.startsWith("fc")
    }
}
