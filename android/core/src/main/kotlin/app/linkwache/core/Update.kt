package app.linkwache.core

import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Update discovery from the GitHub release marked "latest" (pre-releases are never offered:
 * the release broker promotes a release only after the gate is green).
 */
data class UpdateInfo(
    val version: String,
    val apkName: String,
    val apkUrl: String,
    val size: Long,
    /** Lowercase hex SHA-256 from the asset digest, or null if it must come from SHA256SUMS.txt. */
    val sha256: String?,
    val sumsUrl: String?,
    val pageUrl: String,
)

object Update {
    val APK_NAME = Regex("^Linkwache-android-(\\d+\\.\\d+\\.\\d+)\\.apk$")
    private val SHA = Regex("^[0-9a-f]{64}$")

    /** Parse `GET /repos/<owner>/<repo>/releases/latest`; null if it carries no APK or is not newer. */
    fun parseLatest(json: String, current: String): UpdateInfo? {
        val j = try { JSONObject(json) } catch (e: JSONException) { return null }
        if (j.optBoolean("draft") || j.optBoolean("prerelease")) return null
        val tagVersion = j.optString("tag_name").removePrefix("v")
        val assets = j.optJSONArray("assets") ?: return null
        var apk: JSONObject? = null
        var sums: String? = null
        for (i in 0 until assets.length()) {
            val a = assets.optJSONObject(i) ?: continue
            val name = a.optString("name")
            if (APK_NAME.matches(name)) apk = a
            if (name == "SHA256SUMS.txt") sums = a.optString("browser_download_url").takeIf { it.startsWith("https://") }
        }
        apk ?: return null
        val name = apk.optString("name")
        val version = APK_NAME.find(name)!!.groupValues[1]
        if (tagVersion.isNotEmpty() && tagVersion != version) return null
        if (compare(version, current) <= 0) return null
        val url = apk.optString("browser_download_url")
        if (!url.startsWith("https://")) return null
        val digest = apk.optString("digest").removePrefix("sha256:").lowercase().takeIf { SHA.matches(it) }
        if (digest == null && sums == null) return null
        return UpdateInfo(version, name, url, apk.optLong("size", -1), digest, sums, j.optString("html_url"))
    }

    /** Line `<sha256>  <name>` from a SHA256SUMS.txt. */
    fun shaFromSums(text: String, name: String): String? = text.lineSequence()
        .map { it.trim().split(Regex("\\s+\\*?"), limit = 2) }
        .firstOrNull { it.size == 2 && it[1].trim() == name && SHA.matches(it[0].lowercase()) }
        ?.get(0)?.lowercase()

    /** Semantic version compare (`0.10.0` > `0.9.3`); pre-release suffixes are ignored. */
    fun compare(a: String, b: String): Int {
        fun parts(s: String) = s.removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val pa = parts(a)
        val pb = parts(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val c = (pa.getOrElse(i) { 0 }).compareTo(pb.getOrElse(i) { 0 })
            if (c != 0) return c
        }
        return 0
    }

    fun sha256(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256(file: File): String = file.inputStream().use { sha256(it) }

    /**
     * The downloaded APK may only be installed when its signing certificates are exactly the
     * ones of the running app (Android enforces it as well; we refuse before even trying).
     */
    fun sameSigner(installed: Set<String>, candidate: Set<String>): Boolean =
        installed.isNotEmpty() && installed == candidate

    /** versionCode from a version name: 1.2.3 → 10203 (patch and minor below 100). */
    fun versionCode(name: String): Int {
        val p = name.split('.').map { it.toInt() }
        require(p.size == 3 && p[1] < 100 && p[2] < 100) { "version $name" }
        return p[0] * 10000 + p[1] * 100 + p[2]
    }
}
