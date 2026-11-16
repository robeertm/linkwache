package app.linkwache.core

import java.net.IDN

/**
 * Public suffix lookup with the ICANN section of the public suffix list only — the same
 * behaviour as tldts with `allowPrivateDomains: false` on the server (src/util.js).
 * The list is bundled as a resource (`linkwache/psl_icann.dat`, one rule per line).
 */
object Psl {
    private class Rules(val exact: Set<String>, val wildcard: Set<String>, val exception: Set<String>)

    private val rules: Rules by lazy { load() }

    private fun load(): Rules {
        val exact = HashSet<String>(8192)
        val wildcard = HashSet<String>()
        val exception = HashSet<String>()
        val stream = Psl::class.java.getResourceAsStream("/linkwache/psl_icann.dat")
            ?: error("public suffix list missing")
        stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (raw in lines) {
                val line = raw.trim()
                if (line.isEmpty() || line.startsWith("//")) continue
                when {
                    line.startsWith("!") -> exception += ascii(line.substring(1))
                    line.startsWith("*.") -> wildcard += ascii(line.substring(2))
                    else -> exact += ascii(line)
                }
            }
        }
        return Rules(exact, wildcard, exception)
    }

    private fun ascii(s: String): String = try {
        IDN.toASCII(s, IDN.ALLOW_UNASSIGNED).lowercase()
    } catch (e: IllegalArgumentException) {
        s.lowercase()
    }

    /** ICANN public suffix of [host]; the last label when no rule matches. */
    fun suffix(host: String): String {
        val h = host.trimEnd('.').lowercase()
        val labels = h.split('.')
        val r = rules
        // Longest matching rule wins; exceptions beat wildcards.
        for (i in labels.indices) {
            val candidate = labels.subList(i, labels.size).joinToString(".")
            if (candidate in r.exception) {
                return labels.subList(i + 1, labels.size).joinToString(".")
            }
            if (candidate in r.exact) return candidate
            if (i + 1 < labels.size) {
                val parent = labels.subList(i + 1, labels.size).joinToString(".")
                if (parent in r.wildcard) return candidate
            }
        }
        return labels.last()
    }
}
