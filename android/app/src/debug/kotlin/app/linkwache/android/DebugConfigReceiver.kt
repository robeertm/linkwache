package app.linkwache.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import app.linkwache.core.Scope

/**
 * adb shell am broadcast -n app.linkwache.android/.DebugConfigReceiver \
 *   --es server http://10.0.2.2:8787 --es forward app.linkwache.fakebrowser --ez setupDone true
 */
class DebugConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val p = context.lw.prefs
        intent.getStringExtra("server")?.let { p.serverOverride = it }
        intent.getStringExtra("forward")?.let { p.forwardPackage = it }
        intent.getStringExtra("scope")?.let { p.scope = Scope.of(it) }
        intent.getStringExtra("updateApi")?.let { p.debugUpdateApi = it.ifEmpty { null } }
        intent.getStringExtra("allow")?.let { p.allowlist = it.split(',').filter { s -> s.isNotBlank() }.toSet() }
        if (intent.hasExtra("setupDone")) p.setupDone = intent.getBooleanExtra("setupDone", false)
        if (intent.hasExtra("updateAuto")) p.updateAuto = intent.getBooleanExtra("updateAuto", true)
        if (intent.getBooleanExtra("clear", false)) {
            p.clearHistory()
            context.lw.cache.clear()
            p.cacheJson = null
            p.updateFound = null
            p.updateLastCheck = 0
        }
        if (intent.getBooleanExtra("demoHistory", false)) {
            p.clearHistory()
            p.addHistory("example.org", "gruen", "opened")
            p.addHistory("cheap-deals.top", "gelb", "blocked")
            p.addHistory("example.com", "gruen", "opened")
            p.addHistory("secure-login.example", "rot", "blocked")
            p.addHistory("wikipedia.org", "gruen", "opened")
        }
        Log.i("Linkwache", "debug config applied")
        resultCode = 1
    }
}
