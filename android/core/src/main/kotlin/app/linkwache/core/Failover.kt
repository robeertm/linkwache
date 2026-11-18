package app.linkwache.core

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Reserve-server failover (docs/FALLBACK.md). A pure state machine: the clock, the executor of the
 * background probe and both servers are injected.
 */

/** True for real network or server failures; false for answers the reserve would give the same way. */
val ApiError.failoverWorthy: Boolean
    get() = when (this) {
        ApiError.NoServer -> false
        ApiError.Timeout -> true
        is ApiError.Network -> true
        is ApiError.BadResponse -> true
        is ApiError.Status -> when {
            code == 429 -> false
            code >= 500 -> true
            else -> !json
        }
    }

/** The server told us the installation id is unusable: make a new one and repeat once. */
private val ApiError.isInstallError: Boolean
    get() = this is ApiError.Status && code == 400 && error == "err.install"

/** Whether the main server is believed down, shared by all checks of the process. */
class FailoverState(private val clock: () -> Long = System::currentTimeMillis) {
    private var downUntil = 0L
    private var lastProbe = Long.MIN_VALUE
    private var probing = false
    private var mainError: ApiError? = null

    @Synchronized fun isDown(): Boolean = clock() < downUntil

    @Synchronized fun markDown(e: ApiError) {
        downUntil = clock() + DOWN_MS
        mainError = e
    }

    @Synchronized fun clear() {
        downUntil = 0
        mainError = null
    }

    /** The failure that put the main server on the down list (reported when the reserve fails too). */
    @Synchronized fun lastMainError(): ApiError? = mainError

    /** Start the health probe if the main server is down and the last one is at least a minute old. */
    fun maybeProbe(run: (Runnable) -> Unit, probe: () -> Boolean) {
        synchronized(this) {
            val now = clock()
            if (now >= downUntil || probing || (lastProbe != Long.MIN_VALUE && now - lastProbe < PROBE_EVERY_MS)) return
            probing = true
            lastProbe = now
        }
        try {
            run(Runnable {
                val ok = try { probe() } catch (e: Exception) { false }
                synchronized(this) { probing = false }
                if (ok) clear()
            })
        } catch (e: RuntimeException) {
            synchronized(this) { probing = false }
        }
    }

    companion object {
        const val DOWN_MS = 5 * 60_000L
        const val PROBE_EVERY_MS = 60_000L
    }
}

class FailoverCheckApi(
    private val main: TimedCheckApi,
    /** Null = no reserve (none built in, or the user's own address is in use). */
    private val reserve: TimedCheckApi?,
    private val state: FailoverState = FailoverState(),
    private val clock: () -> Long = System::currentTimeMillis,
    /** Called when the server rejects the installation id (400 err.install). */
    private val renewInstall: () -> Unit = {},
    /** `GET <main>/api/health`, true on `ok`; runs on [async], never during a check. */
    private val healthProbe: () -> Boolean = { false },
    private val async: (Runnable) -> Unit = Failover.backgroundExecutor,
) : CheckApi {

    override fun check(req: CheckRequest): ServerVerdict {
        val t0 = clock()
        fun left() = TOTAL_MS - (clock() - t0)
        if (reserve == null) return call(main, req, MAIN_MS, ::left)
        state.maybeProbe(async, healthProbe)
        return if (state.isDown()) viaReserveFirst(req, ::left) else mainFirst(req, ::left)
    }

    private fun mainFirst(req: CheckRequest, left: () -> Long): ServerVerdict {
        val reserve = reserve!!
        try {
            val v = call(main, req, MAIN_MS, left)
            state.clear()
            return v
        } catch (e: ApiError) {
            if (!e.failoverWorthy) throw e
            state.markDown(e)
            val budget = minOf(RESERVE_MS, left())
            if (budget < MIN_MS) throw e
            try {
                return call(reserve, req, budget, left).copy(viaReserve = true)
            } catch (r: ApiError) {
                throw e // both failed: the reason of the main server
            }
        }
    }

    private fun viaReserveFirst(req: CheckRequest, left: () -> Long): ServerVerdict {
        val reserve = reserve!!
        try {
            return call(reserve, req, minOf(RESERVE_MS, left()), left).copy(viaReserve = true)
        } catch (r: ApiError) {
            if (!r.failoverWorthy) throw r
        }
        val mainWas = state.lastMainError() ?: ApiError.Timeout
        val budget = minOf(MAIN_MS, left())
        if (budget < MIN_MS) throw mainWas
        try {
            val v = call(main, req, budget, left)
            state.clear()
            return v
        } catch (e: ApiError) {
            if (e.failoverWorthy) state.markDown(e)
            throw e
        }
    }

    /** One call; a rejected installation id is renewed and the call repeated once on the same server. */
    private fun call(api: TimedCheckApi, req: CheckRequest, timeoutMs: Long, left: () -> Long): ServerVerdict {
        try {
            return api.check(req, timeoutMs)
        } catch (e: ApiError) {
            if (!e.isInstallError) throw e
            renewInstall()
            val budget = minOf(timeoutMs, left())
            if (budget < MIN_MS) throw e
            return api.check(req, budget)
        }
    }

    companion object {
        const val MAIN_MS = 4500L
        const val RESERVE_MS = 6000L
        const val TOTAL_MS = 8000L
        const val MIN_MS = 1500L
    }
}

object Failover {
    val backgroundExecutor: (Runnable) -> Unit by lazy {
        val ex = Executors.newSingleThreadExecutor { r -> Thread(r, "lw-health").also { it.isDaemon = true } }
        ({ r: Runnable -> ex.execute(r) })
    }
}

/** `GET <server>/api/health` with a 3 s timeout: a 200 JSON answer with `ok: true` means the server is back. */
class HttpHealth(private val server: String?, base: OkHttpClient = OkHttpClient()) {
    private val http = base.newBuilder()
        .callTimeout(3, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    fun ok(): Boolean {
        val s = Link.validServer(server) ?: return false
        return try {
            http.newCall(Request.Builder().url("$s/api/health").get().build()).execute().use { r ->
                r.code == 200 && JSONObject(r.body?.string().orEmpty()).optBoolean("ok", false)
            }
        } catch (e: Exception) {
            false
        }
    }
}
