package app.linkwache.android.update

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.linkwache.android.BuildConfig
import app.linkwache.android.lw
import app.linkwache.core.Update
import app.linkwache.core.UpdateInfo
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Updater from day one: notice in the app when the GitHub release marked "latest" carries a
 * newer APK; one tap downloads it, verifies SHA-256 and the signing certificate, then hands it
 * to the system installer. App data (settings, allowlist, history) is kept by Android.
 */
object Updater {
    const val CHECK_INTERVAL_MS = 12 * 3600 * 1000L

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Debug builds can point the check at a test server (E2E); release builds never do. */
    private fun latestUrl(ctx: Context): String {
        if (BuildConfig.DEBUG) ctx.lw.prefs.debugUpdateApi?.let { return it }
        return "https://api.github.com/repos/${BuildConfig.UPDATE_REPO}/releases/latest"
    }

    sealed class Result {
        data class Available(val info: UpdateInfo) : Result()
        data object UpToDate : Result()
        data class Error(val key: String) : Result()
    }

    fun due(ctx: Context): Boolean {
        val p = ctx.lw.prefs
        return p.updateAuto && System.currentTimeMillis() - p.updateLastCheck > CHECK_INTERVAL_MS
    }

    /** Blocking; call from a background dispatcher. */
    fun check(ctx: Context): Result {
        val p = ctx.lw.prefs
        val req = Request.Builder().url(latestUrl(ctx))
            .header("accept", "application/vnd.github+json")
            .header("user-agent", "Linkwache-Android/${BuildConfig.VERSION_NAME}")
            .build()
        return try {
            http.newCall(req).execute().use { r ->
                p.updateLastCheck = System.currentTimeMillis()
                if (r.code == 404) { p.updateFound = null; return Result.UpToDate }
                if (!r.isSuccessful) return Result.Error("set.upd.error")
                val testServer = BuildConfig.DEBUG && p.debugUpdateApi != null
                val info = Update.parseLatest(r.body?.string().orEmpty(), BuildConfig.VERSION_NAME, allowHttp = testServer)
                p.updateFound = info?.let { toJson(it) }
                if (info == null) Result.UpToDate else Result.Available(info)
            }
        } catch (e: IOException) {
            Result.Error("set.upd.error")
        }
    }

    fun found(ctx: Context): UpdateInfo? = ctx.lw.prefs.updateFound?.let { fromJson(it) }
        ?.takeIf { Update.compare(it.version, BuildConfig.VERSION_NAME) > 0 }

    fun canInstall(ctx: Context): Boolean = ctx.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))

    /**
     * Download, verify and install. Returns null when the system installer took over
     * (the user confirms there), else the text key of the error. Blocking.
     */
    fun downloadAndInstall(ctx: Context, info: UpdateInfo, progress: (String) -> Unit): String? {
        progress("android.upd.downloading")
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, info.apkName)
        try {
            val expected = info.sha256 ?: info.sumsUrl?.let { url ->
                http.newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (!r.isSuccessful) null else Update.shaFromSums(r.body?.string().orEmpty(), info.apkName)
                }
            } ?: return "android.upd.err.sha"
            http.newCall(Request.Builder().url(info.apkUrl).build()).execute().use { r ->
                if (!r.isSuccessful) return "android.upd.err.download"
                val body = r.body ?: return "android.upd.err.download"
                if (body.contentLength() > MAX_APK_BYTES) return "android.upd.err.download"
                apk.outputStream().use { out ->
                    val input = body.byteStream()
                    val buf = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_APK_BYTES) return "android.upd.err.download"
                        out.write(buf, 0, n)
                    }
                }
            }
            progress("android.upd.verifying")
            val verdict = verify(ctx, apk, expected)
            if (verdict != null) {
                apk.delete()
                return verdict
            }
            install(ctx, apk)
            return null
        } catch (e: IOException) {
            apk.delete()
            return "android.upd.err.download"
        }
    }

    /** null if the APK may be installed, else the text key of the reason. */
    fun verify(ctx: Context, apk: File, expectedSha: String): String? {
        if (!Update.sha256(apk).equals(expectedSha, ignoreCase = true)) return "android.upd.err.sha"
        val pm = ctx.packageManager
        val candidate = archiveInfo(pm, apk) ?: return "android.upd.err.signer"
        if (candidate.packageName != ctx.packageName) return "android.upd.err.signer"
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
        if (code <= BuildConfig.VERSION_CODE) return "android.upd.err.signer"
        val installed = signers(installedInfo(pm, ctx.packageName))
        if (!Update.sameSigner(installed, signers(candidate))) return "android.upd.err.signer"
        return null
    }

    @SuppressLint("PackageManagerGetSignatures")
    @Suppress("DEPRECATION")
    private val SIG_FLAGS = PackageManager.GET_SIGNATURES or (if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0)

    @Suppress("DEPRECATION")
    private fun archiveInfo(pm: PackageManager, apk: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(SIG_FLAGS.toLong()))
        else pm.getPackageArchiveInfo(apk.path, SIG_FLAGS)

    @Suppress("DEPRECATION")
    private fun installedInfo(pm: PackageManager, pkg: String): PackageInfo =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(SIG_FLAGS.toLong()))
        else pm.getPackageInfo(pkg, SIG_FLAGS)

    /** SHA-256 of every signing certificate. */
    @Suppress("DEPRECATION")
    fun signers(info: PackageInfo): Set<String> {
        val certs = if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            val si = info.signingInfo!!
            if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
        } else {
            info.signatures
        }
        return certs.orEmpty().map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
            setSize(apk.length())
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("linkwache.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java).setPackage(ctx.packageName), flags)
            session.commit(pi.intentSender)
        }
    }

    private const val MAX_APK_BYTES = 100L * 1024 * 1024

    fun toJson(i: UpdateInfo): String = JSONObject()
        .put("version", i.version).put("apkName", i.apkName).put("apkUrl", i.apkUrl).put("size", i.size)
        .put("sha256", i.sha256 ?: JSONObject.NULL).put("sumsUrl", i.sumsUrl ?: JSONObject.NULL).put("pageUrl", i.pageUrl)
        .toString()

    fun fromJson(s: String): UpdateInfo? = try {
        val j = JSONObject(s)
        UpdateInfo(
            j.getString("version"), j.getString("apkName"), j.getString("apkUrl"), j.optLong("size", -1),
            if (j.isNull("sha256")) null else j.getString("sha256"),
            if (j.isNull("sumsUrl")) null else j.getString("sumsUrl"),
            j.optString("pageUrl"),
        )
    } catch (e: Exception) {
        null
    }
}
