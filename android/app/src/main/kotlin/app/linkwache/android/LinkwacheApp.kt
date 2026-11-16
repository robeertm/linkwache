package app.linkwache.android

import android.app.Application
import app.linkwache.core.Psl
import app.linkwache.core.VerdictCache
import kotlin.concurrent.thread

class LinkwacheApp : Application() {
    lateinit var prefs: Prefs
        private set
    val cache = VerdictCache()

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
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
