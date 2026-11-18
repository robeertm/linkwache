package app.linkwache.core

/**
 * The server address built into the app ("preset") and earlier built-in addresses. Both come from the
 * build (repository variables in CI), never from the source. The app stores an address only when the
 * user enters one that differs from the preset; installations without a stored address follow the
 * preset automatically. A stored address that equals the current or an earlier preset (entered by
 * hand, or stored by a test build) is treated as following the preset as well, never an address of the
 * user's own.
 */
object ServerPreset {
    /** Earlier presets separated by commas, semicolons or whitespace; normalized, without [preset]. */
    fun parseList(s: String?, preset: String? = null): List<String> {
        val p = Link.validServer(preset)
        val out = ArrayList<String>()
        for (item in s.orEmpty().split(',', ';', ' ', '\t', '\n', '\r')) {
            val v = Link.validServer(item) ?: continue
            if (v != p && v !in out) out.add(v)
        }
        return out
    }

    /**
     * The stored address worth keeping: null when it follows the preset (equals the current or an earlier
     * one) or is invalid. With an empty preset everything valid is kept, so nothing ever breaks.
     */
    fun keepOverride(override: String?, preset: String?, migrateFrom: List<String>): String? {
        val v = Link.validServer(override) ?: return null
        val p = Link.validServer(preset) ?: return v
        return if (v == p || v in migrateFrom) null else v
    }

    /** The address in use: the user's own one, otherwise the preset; null when there is none. */
    fun effective(override: String?, preset: String?, migrateFrom: List<String>): String? =
        keepOverride(override, preset, migrateFrom) ?: Link.validServer(preset) ?: Link.validServer(override)

    /** The reserve address: only while the built-in address is in use (never for an own address), and not the main address itself. */
    fun reserve(override: String?, preset: String?, migrateFrom: List<String>, fallback: String?): String? {
        val p = Link.validServer(preset) ?: return null
        if (effective(override, preset, migrateFrom) != p) return null
        return Link.validServer(fallback)?.takeIf { it != p }
    }
}
