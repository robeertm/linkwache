package app.linkwache.core

import okhttp3.HttpUrl
import org.json.JSONException
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Previous server verdicts, only on the device: green for 6 h, amber and red for 24 h
 * (the server may send `cacheTtl`). Key = registrable domain + hash of host and path.
 */
class VerdictCache(private val maxEntries: Int = 500) {
    private data class Entry(val expires: Long, val body: String)

    private val map = LinkedHashMap<String, Entry>(64, 0.75f, true)

    @Synchronized
    fun get(key: String, nowSec: Long): ServerVerdict? {
        val e = map[key] ?: return null
        if (e.expires <= nowSec) {
            map.remove(key)
            return null
        }
        return try { V1.parse(e.body) } catch (x: ApiError) { map.remove(key); null }
    }

    @Synchronized
    fun put(key: String, v: ServerVerdict, nowSec: Long) {
        val ttl = v.cacheTtl ?: if (v.level == Level.GRUEN) GREEN_TTL else WARN_TTL
        map[key] = Entry(nowSec + ttl.coerceIn(60, 7 * 86400), v.raw)
        while (map.size > maxEntries) map.remove(map.keys.first())
    }

    @Synchronized
    fun clear() = map.clear()

    @Synchronized
    fun size() = map.size

    @Synchronized
    fun toJson(nowSec: Long): String {
        val o = JSONObject()
        for ((k, e) in map) if (e.expires > nowSec) o.put(k, JSONObject().put("x", e.expires).put("b", e.body))
        return o.toString()
    }

    @Synchronized
    fun load(json: String?, nowSec: Long) {
        if (json.isNullOrEmpty()) return
        try {
            val o = JSONObject(json)
            for (k in o.keys()) {
                val e = o.optJSONObject(k) ?: continue
                val x = e.optLong("x", 0)
                if (x > nowSec) map[k] = Entry(x, e.optString("b"))
            }
        } catch (e: JSONException) {
            // A damaged cache is simply dropped.
        }
    }

    companion object {
        const val GREEN_TTL = 6 * 3600L
        const val WARN_TTL = 24 * 3600L

        fun key(u: HttpUrl, scope: Scope): String {
            val domain = hostInfo(u).domain
            val material = Link.reduce(u, scope)
            val d = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
            return domain + "|" + d.take(12).joinToString("") { "%02x".format(it) }
        }
    }
}
