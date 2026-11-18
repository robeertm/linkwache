package app.linkwache.core

/** Levels as the server names them. [order] sorts worst first, [severity] ranks verdicts. */
enum class Level(val wire: String, val order: Int, val severity: Int) {
    ROT("rot", 0, 3),
    GELB("gelb", 1, 2),
    INFO("info", 2, 0),
    GRUEN("gruen", 3, 1);

    companion object {
        fun of(s: String?): Level? = entries.firstOrNull { it.wire == s }
    }
}

/**
 * One finding: [key] (translated as `f.<key>`, or `pat.<key>` for patterns), level and
 * parameters. [titel]/[text] are only set when the server translated them.
 */
data class Finding(
    val key: String,
    val level: Level,
    val p: Map<String, String> = emptyMap(),
    val pattern: Boolean = false,
    val titel: String? = null,
    val text: String? = null,
)

data class Verdict(
    val level: Level,
    val kurzKey: String,
    val ratKey: String,
    val score: Int,
    val findings: List<Finding>,
)

/** What the check sheet shows. */
enum class Outcome { GRUEN, GELB, ROT, OFFLINE }

enum class Source { ALLOWLIST, CACHE, SERVER, LOCAL }

data class CheckResult(
    /** The link as clicked — this is what opens if the user goes ahead. */
    val url: String,
    /** The judged target (differs from [url] when a wrapper was unwrapped). */
    val target: String,
    val unwrapped: Boolean,
    val host: String,
    val domain: String,
    val unicodeHost: String,
    val outcome: Outcome,
    val source: Source,
    /** Why the check could not finish (`timeout`, `network`, `server`, `rate`, `noserver`). */
    val reason: String? = null,
    val kurzKey: String,
    val ratKey: String,
    val kurz: String? = null,
    val rat: String? = null,
    val findings: List<Finding>,
    val local: Verdict,
    val allowEntry: String? = null,
    /** Server verdict was shortened by redirects (shortener chain), informational. */
    val chain: List<String> = emptyList(),
    val elapsedMs: Long = 0,
    /** The server answer came from the reserve server (shows a quiet note). */
    val viaReserve: Boolean = false,
)
