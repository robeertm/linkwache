package app.linkwache.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import app.linkwache.android.ui.HomeModel
import app.linkwache.android.ui.LinkwacheTheme
import app.linkwache.android.ui.MainScreen
import app.linkwache.android.update.Updater
import app.linkwache.core.Link
import app.linkwache.core.UpdateInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Setup assistant, protection status, settings, history and updates. */
class MainActivity : ComponentActivity(), HomeModel.Host {
    private val model = HomeModel(this)

    private val roleLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra(EXTRA_SETUP, false)) model.setupStep = 1
        if (BuildConfig.DEBUG) intent.getIntExtra("step", 0).takeIf { it > 0 }?.let { model.setupStep = it }
        setContent { LinkwacheTheme { MainScreen(model) } }
    }

    override fun onResume() {
        super.onResume()
        refresh()
        if (Updater.due(this)) checkUpdate(false)
    }

    private fun refresh() {
        val p = lw.prefs
        model.setupDone = p.setupDone
        model.isDefault = Browsers.isLinkwacheDefault(this)
        model.browsers = Browsers.installed(this)
        model.systemDefault = Browsers.systemDefault(this)
        model.forward = p.forwardPackage?.takeIf { Browsers.isInstalled(this, it) }
        if (model.forward == null && model.setupStep == 0 && !p.setupDone) model.setupStep = 1
        model.server = p.server.orEmpty()
        model.serverIsPreset = p.serverOverride == null && BuildConfig.DEFAULT_SERVER.isNotEmpty()
        model.scope = p.scope
        model.pausedUntil = p.pausedUntil
        model.allowlist = p.allowlist.sorted()
        model.history = p.history()
        model.updateAuto = p.updateAuto
        model.update = Updater.found(this)
        model.canInstall = Updater.canInstall(this)
        model.installId = p.installId
        model.version = BuildConfig.VERSION_NAME
    }

    // ── HomeModel.Host ──────────────────────────────────────────────────────────

    override fun requestDefault() {
        val role = Browsers.roleRequestIntent(this)
        try {
            if (role != null && !Browsers.isLinkwacheDefault(this)) roleLauncher.launch(role) else openDefaultSettings()
        } catch (e: ActivityNotFoundException) {
            openDefaultSettings()
        }
    }

    override fun openDefaultSettings() {
        try {
            startActivity(Browsers.defaultAppsSettingsIntent())
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        }
    }

    override fun chooseBrowser(pkg: String) {
        if (pkg == packageName) return
        lw.prefs.forwardPackage = pkg
        refresh()
    }

    override fun setServer(s: String): Boolean {
        val v = Link.validServer(s) ?: return false
        lw.prefs.serverOverride = if (v == Link.validServer(BuildConfig.DEFAULT_SERVER)) null else v
        lw.cache.clear()
        refresh()
        return true
    }

    override fun resetServer() {
        lw.prefs.serverOverride = null
        lw.cache.clear()
        refresh()
    }

    override fun testServer(s: String) {
        val v = Link.validServer(s)
        if (v == null) {
            model.serverTest = HomeModel.ServerTest.Invalid
            return
        }
        model.serverTest = HomeModel.ServerTest.Testing
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) {
                try {
                    val http = OkHttpClient.Builder().callTimeout(6, TimeUnit.SECONDS).followRedirects(false).build()
                    http.newCall(Request.Builder().url("$v/api/health").build()).execute().use { resp ->
                        if (!resp.isSuccessful) return@use HomeModel.ServerTest.Fail
                        val j = JSONObject(resp.body?.string().orEmpty())
                        if (j.optBoolean("ok")) HomeModel.ServerTest.Ok(j.optString("version")) else HomeModel.ServerTest.Fail
                    }
                } catch (e: Exception) {
                    HomeModel.ServerTest.Fail
                }
            }
            model.serverTest = r
        }
    }

    override fun setScope(s: app.linkwache.core.Scope) {
        lw.prefs.scope = s
        refresh()
    }

    override fun setPaused(minutes: Int) {
        lw.prefs.pausedUntil = if (minutes <= 0) 0 else System.currentTimeMillis() + minutes * 60_000L
        refresh()
    }

    override fun addAllowed(input: String): Boolean {
        val e = app.linkwache.core.Allowlist.normalize(input)
        if (e !is app.linkwache.core.Allowlist.Entry.Ok) return false
        lw.prefs.allowlist = lw.prefs.allowlist + e.domain
        refresh()
        return true
    }

    override fun removeAllowed(domain: String) {
        lw.prefs.allowlist = lw.prefs.allowlist - domain
        refresh()
    }

    override fun clearHistory() {
        lw.prefs.clearHistory()
        refresh()
    }

    override fun resetInstallId() {
        lw.prefs.resetInstallId()
        refresh()
    }

    override fun setUpdateAuto(on: Boolean) {
        lw.prefs.updateAuto = on
        refresh()
    }

    override fun checkUpdate(manual: Boolean) {
        model.updateBusy = "set.upd.checking"
        lifecycleScope.launch {
            val r = withContext(Dispatchers.IO) { Updater.check(this@MainActivity) }
            model.updateBusy = null
            model.updateMessage = when (r) {
                is Updater.Result.Available -> null
                Updater.Result.UpToDate -> if (manual) "set.upd.none" else null
                is Updater.Result.Error -> if (manual) r.key else null
            }
            refresh()
        }
    }

    override fun installUpdate(info: UpdateInfo) {
        if (!Updater.canInstall(this)) {
            startActivity(Updater.installPermissionIntent(this))
            return
        }
        model.updateMessage = null
        lifecycleScope.launch {
            val err = withContext(Dispatchers.IO) {
                Updater.downloadAndInstall(this@MainActivity, info) { key -> lifecycleScope.launch { model.updateBusy = key } }
            }
            model.updateBusy = null
            model.updateMessage = err ?: "android.upd.confirm"
        }
    }

    override fun dismissUpdate() {
        model.update = null
    }

    override fun finishSetup() {
        lw.prefs.setupDone = true
        model.setupStep = 0
        refresh()
    }

    override fun tryTestLink() {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TEST_LINK)).setClass(this, CheckActivity::class.java))
    }

    override fun openUrl(url: String) {
        val pkg = lw.prefs.forwardPackage
        if (!Browsers.forward(this, url, pkg)) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClass(this, CheckActivity::class.java))
            } catch (e: ActivityNotFoundException) {
                // nothing to open with
            }
        }
    }

    override fun privacyUrl(): String? = lw.prefs.server?.let { "$it/datenschutz.html?lang=${Texts.lang(this)}" }

    companion object {
        const val EXTRA_SETUP = "setup"
        const val TEST_LINK = "https://example.com/"
    }
}
