package app.linkwache.android

import android.content.Context
import android.content.SharedPreferences
import app.linkwache.core.EngineSettings
import app.linkwache.core.Link
import app.linkwache.core.Scope
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

/** Everything Linkwache stores — only on this device (no backup, see data_extraction_rules). */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("linkwache", Context.MODE_PRIVATE)

    var setupDone: Boolean
        get() = sp.getBoolean("setupDone", false)
        set(v) = sp.edit().putBoolean("setupDone", v).apply()

    /** User-entered server address; null = the address built into the app. */
    var serverOverride: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()

    val server: String?
        get() = Link.validServer(serverOverride) ?: Link.validServer(BuildConfig.DEFAULT_SERVER)

    var forwardPackage: String?
        get() = sp.getString("forward", null)
        set(v) = sp.edit().putString("forward", v).apply()

    var scope: Scope
        get() = Scope.of(sp.getString("scope", "url"))
        set(v) = sp.edit().putString("scope", v.wire).apply()

    var pausedUntil: Long
        get() = sp.getLong("pausedUntil", 0)
        set(v) = sp.edit().putLong("pausedUntil", v).apply()

    val paused: Boolean get() = pausedUntil > System.currentTimeMillis()

    var allowlist: Set<String>
        get() = sp.getStringSet("allow", emptySet())!!.toSet()
        set(v) = sp.edit().putStringSet("allow", v.toSet()).apply()

    var updateAuto: Boolean
        get() = sp.getBoolean("updAuto", true)
        set(v) = sp.edit().putBoolean("updAuto", v).apply()

    var updateLastCheck: Long
        get() = sp.getLong("updLast", 0)
        set(v) = sp.edit().putLong("updLast", v).apply()

    /** The release found by the last check (JSON of UpdateInfo), null if none. */
    var updateFound: String?
        get() = sp.getString("updFound", null)
        set(v) = sp.edit().putString("updFound", v).apply()

    /** Only read by debug builds (E2E test server for the update check). */
    var debugUpdateApi: String?
        get() = sp.getString("debugUpdateApi", null)
        set(v) = sp.edit().putString("debugUpdateApi", v).apply()

    var cacheJson: String?
        get() = sp.getString("cache", null)
        set(v) = sp.edit().putString("cache", v).apply()

    val installId: String
        get() = sp.getString("installId", null) ?: resetInstallId()

    fun resetInstallId(): String {
        val b = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val id = b.joinToString("") { "%02x".format(it) }
        sp.edit().putString("installId", id).apply()
        return id
    }

    fun engineSettings() = EngineSettings(allowlist = allowlist, scope = scope, paused = paused)

    // ── Local history (last 200 checks) ────────────────────────────────────────

    data class HistoryEntry(val time: Long, val domain: String, val outcome: String, val action: String)

    fun history(): List<HistoryEntry> {
        val a = try { JSONArray(sp.getString("history", "[]")) } catch (e: Exception) { JSONArray() }
        return (0 until a.length()).mapNotNull { i ->
            a.optJSONObject(i)?.let { HistoryEntry(it.optLong("t"), it.optString("d"), it.optString("o"), it.optString("a")) }
        }
    }

    @Synchronized
    fun addHistory(domain: String, outcome: String, action: String) {
        val list = history().toMutableList()
        list.add(0, HistoryEntry(System.currentTimeMillis(), domain, outcome, action))
        val a = JSONArray()
        list.take(MAX_HISTORY).forEach { a.put(JSONObject().put("t", it.time).put("d", it.domain).put("o", it.outcome).put("a", it.action)) }
        sp.edit().putString("history", a.toString()).apply()
    }

    fun clearHistory() = sp.edit().remove("history").apply()

    companion object {
        const val MAX_HISTORY = 200
    }
}
