package app.linkwache.android

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import app.linkwache.android.ui.CheckSheet
import app.linkwache.android.ui.GREEN_VISIBLE_MS
import app.linkwache.android.ui.LinkwacheTheme
import app.linkwache.android.ui.SheetActions
import app.linkwache.android.ui.SheetState
import app.linkwache.core.CheckResult
import app.linkwache.core.Decision
import app.linkwache.core.Engine
import app.linkwache.core.HttpCheckApi
import app.linkwache.core.Level
import app.linkwache.core.Link
import app.linkwache.core.Outcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Every tapped web link lands here once Linkwache is the default browser (and shared text).
 * Shows the check sheet over the calling app and hands the link to the real browser —
 * never silently: green opens after a short visible moment, everything else waits for the user.
 */
class CheckActivity : ComponentActivity(), SheetActions {
    private var state by mutableStateOf<SheetState>(SheetState.Checking(""))
    private var raw: String? = null
    private var result: CheckResult? = null
    private var fromCustomTab = false
    private var job: Job? = null
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent { LinkwacheTheme { CheckSheet(state, this) } }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = close()
        })
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        fromCustomTab = intent.hasExtra(EXTRA_CUSTOM_TABS_SESSION)
        raw = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> Link.fromSharedText(intent.getStringExtra(Intent.EXTRA_TEXT))?.toString()
            Intent.ACTION_PROCESS_TEXT -> Link.fromSharedText(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString())?.toString()
            else -> null
        }
        if (raw == null) {
            state = SheetState.Message("android.refused.title", if (intent.action == Intent.ACTION_VIEW) "toast.refused" else "android.share.nolink")
            return
        }
        run()
    }

    private fun run() {
        job?.cancel()
        result = null
        val prefs = lw.prefs
        if (!Browsers.isInstalled(this, prefs.forwardPackage)) {
            state = SheetState.NoBrowser(Browsers.installed(this), missing = prefs.forwardPackage != null)
            return
        }
        val t0 = SystemClock.elapsedRealtime()
        val engine = Engine(prefs.engineSettings(), HttpCheckApi(prefs.server, prefs.installId, BuildConfig.VERSION_NAME), lw.cache)
        val lang = Texts.lang(this)
        job = lifecycleScope.launch {
            val d = withContext(Dispatchers.Default) { engine.prepare(raw) }
            when (d) {
                is Decision.Refused -> {
                    prefs.addHistory(d.scheme.ifEmpty { "?" }, "refused", "refused")
                    state = SheetState.Message("android.refused.title", "toast.refused")
                }
                is Decision.Paused -> {
                    val host = Link.classify(d.url).let { (it as? app.linkwache.core.Incoming.Web)?.url?.host.orEmpty() }
                    prefs.addHistory(host, "paused", "paused")
                    forwardAndFinish(d.url, "paused")
                }
                is Decision.Check -> {
                    val p = d.prepared
                    val early = p.early
                    if (early != null) {
                        show(early, t0)
                        return@launch
                    }
                    if (p.local.level == Level.ROT) {
                        // A local red is shown at once; the server call only adds details.
                        show(Engine.baseResult(p), t0)
                    } else {
                        state = SheetState.Checking(app.linkwache.core.hostInfo(p.target).unicodeHost)
                    }
                    val r = withContext(Dispatchers.IO) { engine.remote(p, lang) }
                    withContext(Dispatchers.IO) { lw.saveCache() }
                    show(r, t0)
                }
            }
        }
    }

    private fun show(r: CheckResult, t0: Long) {
        val ms = SystemClock.elapsedRealtime() - t0
        result = r.copy(elapsedMs = ms)
        Log.i(TAG, "check outcome=${r.outcome} source=${r.source} reason=${r.reason} ms=$ms server=${serverTag(lw.prefs.server)}")
        state = SheetState.Done(result!!, Browsers.label(this, lw.prefs.forwardPackage))
        if (r.outcome == Outcome.GRUEN) {
            lifecycleScope.launch {
                delay(GREEN_VISIBLE_MS)
                if (!done && result?.url == r.url) forwardAndFinish(r.url, "opened")
            }
        }
    }

    private fun forwardAndFinish(url: String, action: String) {
        if (done) return
        val pkg = lw.prefs.forwardPackage
        if (!Browsers.forward(this, url, pkg, fromCustomTab, intent?.extras)) {
            state = SheetState.NoBrowser(Browsers.installed(this), missing = true)
            return
        }
        done = true
        Log.i(TAG, "forwarded action=$action")
        result?.let { lw.prefs.addHistory(it.domain, it.outcome.name.lowercase(), action) }
        finish()
    }

    override fun open() {
        val r = result ?: return
        forwardAndFinish(r.url, if (r.outcome == Outcome.GRUEN) "opened" else "open-anyway")
    }

    override fun close() {
        if (done) return
        done = true
        job?.cancel()
        result?.let { lw.prefs.addHistory(it.domain, it.outcome.name.lowercase(), "blocked") }
        Log.i(TAG, "closed without opening")
        finish()
    }

    override fun retry() = run()

    override fun choose(pkg: String) {
        if (pkg == packageName) return
        lw.prefs.forwardPackage = pkg
        if (raw != null) run() else finish()
    }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    companion object {
        const val TAG = "Linkwache"
        const val EXTRA_CUSTOM_TABS_SESSION = "android.support.customtabs.extra.SESSION"
    }

    /** First 12 hex digits of SHA-256(host): lets tests confirm the server without the address in any log. */
    private fun serverTag(server: String?): String {
        val host = server?.substringAfter("://")?.substringBefore('/')?.substringBefore(':') ?: return "none"
        val d = java.security.MessageDigest.getInstance("SHA-256").digest(host.toByteArray())
        return d.take(6).joinToString("") { "%02x".format(it) }
    }
}
