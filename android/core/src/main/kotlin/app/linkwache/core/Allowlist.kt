package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Domains the user approved plus a short built-in list of very large sites. Matching is on
 * the registrable domain only and never on look-alikes (IDN/punycode, IP hosts, user info,
 * odd ports). Same lists as the desktop app.
 */
object Allowlist {
    val BUILTIN = setOf(
        "google.com", "google.de", "youtube.com", "wikipedia.org", "wikimedia.org", "bing.com", "duckduckgo.com",
        "ecosia.org", "microsoft.com", "office.com", "live.com", "outlook.com", "microsoftonline.com", "apple.com",
        "icloud.com", "gmx.net", "gmx.de", "web.de", "t-online.de", "yahoo.com", "proton.me", "mozilla.org",
        "amazon.de", "amazon.com", "tagesschau.de",
    )

    /** Hosts on built-in domains that serve content anyone can publish: always checked. */
    val BUILTIN_USER_CONTENT = setOf(
        "sites.google.com", "docs.google.com", "drive.google.com", "forms.office.com", "onedrive.live.com",
        "storage.live.com", "1drv.ms", "web.archive.org",
    )

    sealed class Entry {
        data class Ok(val domain: String) : Entry()
        data object Invalid : Entry()
        data object Idn : Entry()
        data object Ip : Entry()
    }

    /** Normalise a user entry (`https://Shop.Example.com/x` → `example.com`). */
    fun normalize(input: String): Entry {
        val s = input.trim().trimEnd('.').lowercase()
        if (s.isEmpty()) return Entry.Invalid
        val withScheme = if (s.contains("://")) s else "https://$s"
        val u = withScheme.toHttpUrlOrNull() ?: return Entry.Invalid
        val host = u.host
        if (isIpHost(host)) return Entry.Ip
        if (host.contains("xn--") || s.any { it.code > 0x7f }) return Entry.Idn
        if (!host.contains('.')) return Entry.Invalid
        val (domain, suffix, _) = splitHost(host)
        if (domain == suffix) return Entry.Invalid
        return Entry.Ok(domain)
    }

    /** Which allowlist entry a link matches, if any (user entries first, then built-in). */
    fun match(user: Collection<String>, u: HttpUrl): String? {
        val host = u.host.lowercase()
        if (isIpHost(host) || host.contains("xn--")) return null
        if (u.username.isNotEmpty() || u.password.isNotEmpty() || explicitPort(u).isNotEmpty()) return null
        val domain = hostInfo(u).domain
        user.firstOrNull { it == domain }?.let { return it }
        if (host in BUILTIN_USER_CONTENT) return null
        return if (domain in BUILTIN) domain else null
    }
}
