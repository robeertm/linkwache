package app.linkwache.android

import android.app.Application
import app.linkwache.core.CheckApi
import app.linkwache.core.FailoverCheckApi
import app.linkwache.core.FailoverState
import app.linkwache.core.HttpCheckApi
import app.linkwache.core.HttpHealth
import app.linkwache.core.Psl
import app.linkwache.core.VerdictCache
import kotlin.concurrent.thread

class LinkwacheApp : Application() {
    lateinit var prefs: Prefs
        private set
    val cache = VerdictCache()
    /** Whether the main server is believed down (lives as long as the process, docs/FALLBACK.md). */
    private val failover = FailoverState()

    /** The check client: main server, reserve when the built-in address is in use, installation id self-healing. */
    fun checkApi(): CheckApi {
        val main = prefs.server
        val reserve = prefs.reserveServer
        val version = BuildConfig.VERSION_NAME
        val id = { prefs.installId }
        return FailoverCheckApi(
            main = HttpCheckApi(main, id, version),
            reserve = reserve?.let { HttpCheckApi(it, id, version) },
            state = failover,
            renewInstall = { prefs.resetInstallId() },
            healthProbe = { HttpHealth(main).ok() },
        )
    }

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        // Installations that follow the built-in address move along with it (an own address stays).
        if (prefs.migrateServer()) cache.clear()
        // Load the suffix list and the cache early so the first link is checked quickly.
        thread(name = "lw-warmup", isDaemon = true) {
            Psl.suffix("warm.example.org")
            cache.load(prefs.cacheJson, System.currentTimeMillis() / 1000)
        }
    }

    fun saveCache() {
        prefs.cacheJson = cache.toJson(System.currentTimeMillis() / 1000)
    }
}

val android.content.Context.lw: LinkwacheApp get() = applicationContext as LinkwacheApp
