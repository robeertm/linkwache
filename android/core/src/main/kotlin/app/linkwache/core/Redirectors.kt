package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Known link wrappers (mail safety links, social networks, search engines) hide the real
 * target. They are unwrapped locally before the check (docs/DESKTOP.md section 3).
 * Vectors: `test/vectors/redirectors.json`.
 */
object Redirectors {
    const val MAX_LEVELS = 3

    private fun wrapperParams(u: HttpUrl): List<String>? {
        val host = u.host.lowercase()
        val path = u.encodedPath
        if (host.endsWith(".safelinks.protection.outlook.com")) return listOf("url")
        val (domain, _, sub) = splitHost(host)
        if (domain.substringBefore('.') == "google" && (sub.isEmpty() || sub == "www") && path == "/url") {
            return listOf("q", "url")
        }
        return when {
            (host == "l.facebook.com" || host == "lm.facebook.com") && path == "/l.php" -> listOf("u")
            host == "l.instagram.com" && path == "/" -> listOf("u")
            host in setOf("www.youtube.com", "youtube.com", "m.youtube.com") && path == "/redirect" -> listOf("q")
            host == "slack-redir.net" && path == "/link" -> listOf("url")
            (host == "www.linkedin.com" || host == "linkedin.com") && path == "/safety/go" -> listOf("url")
            else -> null
        }
    }

    /** One unwrapping step: the embedded http(s) target, or null. */
    fun unwrapOnce(u: HttpUrl): HttpUrl? {
        val names = wrapperParams(u) ?: return null
        for (name in names) {
            val v = u.queryParameter(name) ?: continue
            return v.trim().toHttpUrlOrNull()
        }
        return null
    }

    /** The real target behind (up to three nested) wrappers, or null if [raw] is no wrapper. */
    fun unwrap(raw: String): String? {
        var cur = raw.toHttpUrlOrNull() ?: return null
        var changed = false
        repeat(MAX_LEVELS) {
            val next = unwrapOnce(cur) ?: return@repeat
            cur = next
            changed = true
        }
        return if (changed) cur.toString() else null
    }
}
