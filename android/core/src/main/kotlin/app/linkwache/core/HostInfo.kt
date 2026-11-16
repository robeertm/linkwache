package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.IDN
import java.net.URLDecoder

/** Host decomposition, a port of `hostInfo` in `src/util.js`. */
data class HostInfo(
    /** Lowercase host (punycode, IPv6 without brackets). */
    val host: String,
    /** Registrable domain; the host itself for IPs and suffix-only hosts. */
    val domain: String,
    val tld: String,
    val sub: String,
    val isIp: Boolean,
    val subCount: Int,
    val isIdn: Boolean,
    val unicodeHost: String,
    /** Explicit non-default port, empty otherwise. */
    val port: String,
    /** Encoded path plus `?query` (like `pathname + search`). */
    val path: String,
)

private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

fun isIpHost(host: String): Boolean = host.contains(':') || IPV4.matches(host)

/** Registrable domain, suffix and subdomain of a (non-IP) host. */
fun splitHost(host: String): Triple<String, String, String> {
    val h = host.trimEnd('.').lowercase()
    val suffix = Psl.suffix(h)
    if (h.length <= suffix.length || !h.endsWith(".$suffix")) return Triple(h, suffix, "")
    val left = h.substring(0, h.length - suffix.length - 1)
    val dot = left.lastIndexOf('.')
    val sub = if (dot >= 0) left.substring(0, dot) else ""
    val label = if (dot >= 0) left.substring(dot + 1) else left
    return Triple("$label.$suffix", suffix, sub)
}

fun toUnicodeHost(host: String): String = try {
    IDN.toUnicode(host, IDN.ALLOW_UNASSIGNED)
} catch (e: IllegalArgumentException) {
    host
}

fun explicitPort(u: HttpUrl): String = if (u.port != HttpUrl.defaultPort(u.scheme)) u.port.toString() else ""

fun hostInfo(u: HttpUrl): HostInfo {
    val host = u.host.lowercase()
    val ip = isIpHost(host)
    val (domain, tld, sub) = if (ip) Triple(host, host.substringAfterLast('.'), "") else splitHost(host)
    val unicode = if (ip) host else toUnicodeHost(host)
    val query = u.encodedQuery
    val path = u.encodedPath + if (!query.isNullOrEmpty()) "?$query" else ""
    return HostInfo(
        host = host,
        domain = domain,
        tld = tld,
        sub = sub,
        isIp = ip,
        subCount = if (sub.isEmpty()) 0 else sub.split('.').size,
        isIdn = host.contains("xn--") || unicode.any { it.code > 0x7f },
        unicodeHost = unicode,
        port = explicitPort(u),
        path = path,
    )
}

fun registrableDomain(url: String): String? = url.toHttpUrlOrNull()?.let { hostInfo(it).domain }

/** Lenient `decodeURIComponent`: malformed escapes stay as they are. */
fun decodeLenient(s: String): String = try {
    URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")
} catch (e: IllegalArgumentException) {
    s
}
