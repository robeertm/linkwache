package app.linkwache.core

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

/** Client for `POST <server>/api/v1/check` (docs/API.md). */
data class CheckRequest(val url: String, val lang: String, val scope: Scope)

/** The parts of a v1 answer the app uses. */
data class ServerVerdict(
    val level: Level,
    val kurzKey: String?,
    val ratKey: String?,
    val kurz: String?,
    val rat: String?,
    val url: String?,
    val chain: List<String>,
    val findings: List<Finding>,
    val cacheTtl: Long?,
    val raw: String,
    /** Rules version of the server (0.5.3 = 2); answers before that carry none (= 1). */
    val rules: Int = 1,
)

sealed class ApiError(val reason: String) : Exception(reason) {
    data object NoServer : ApiError("noserver")
    data object Timeout : ApiError("timeout")
    class Network(detail: String) : ApiError("network") { override val message = detail }
    class Status(val code: Int, val error: String) : ApiError(if (code == 429) "rate" else "server")
    class BadResponse(detail: String) : ApiError("server") { override val message = detail }
}

fun interface CheckApi {
    @Throws(ApiError::class)
    fun check(req: CheckRequest): ServerVerdict
}

object V1 {
    fun parse(body: String): ServerVerdict {
        val j = try {
            JSONObject(body)
        } catch (e: JSONException) {
            throw ApiError.BadResponse("not json")
        }
        if (j.optInt("api", 0) != 1) throw ApiError.BadResponse("api")
        val level = Level.of(j.optString("stufe")) ?: throw ApiError.BadResponse("stufe")
        if (level == Level.INFO) throw ApiError.BadResponse("stufe")
        val findings = ArrayList<Finding>()
        j.optJSONArray("findings")?.let { a ->
            for (i in 0 until a.length()) {
                val f = a.optJSONObject(i) ?: continue
                val key = f.optString("key").takeIf { it.isNotEmpty() } ?: continue
                val l = Level.of(f.optString("stufe")) ?: Level.INFO
                val p = HashMap<String, String>()
                f.optJSONObject("p")?.let { po -> po.keys().forEach { k -> p[k] = po.opt(k)?.toString().orEmpty() } }
                findings += Finding(key, l, p, f.optBoolean("muster", false), f.str("titel"), f.str("text"))
            }
        }
        val chain = ArrayList<String>()
        j.optJSONArray("chain")?.let { a -> for (i in 0 until a.length()) a.optString(i)?.let { chain += it } }
        val ttl = if (j.has("cacheTtl")) j.optLong("cacheTtl", -1).takeIf { it > 0 } else null
        return ServerVerdict(level, j.str("kurzKey"), j.str("ratKey"), j.str("kurz"), j.str("rat"), j.str("url"), chain, findings, ttl, body, j.optInt("rules", 1).coerceAtLeast(1))
    }

    fun body(req: CheckRequest): String = JSONObject()
        .put("url", req.url).put("lang", req.lang).put("scope", req.scope.wire).toString()

    private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k).takeIf { it.isNotEmpty() } else null
}

/** The real HTTP client with a hard overall timeout (the check never waits longer). */
class HttpCheckApi(
    private val server: String?,
    private val installId: String,
    private val clientVersion: String,
    timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    base: OkHttpClient = OkHttpClient(),
) : CheckApi {
    private val http = base.newBuilder()
        .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .connectTimeout(minOf(timeoutMs, 4000), TimeUnit.MILLISECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    override fun check(req: CheckRequest): ServerVerdict {
        val s = Link.validServer(server) ?: throw ApiError.NoServer
        val request = Request.Builder()
            .url("$s/api/v1/check")
            .header("x-linkwache-install", installId)
            .header("x-linkwache-client", "android/$clientVersion")
            .header("user-agent", "Linkwache-Android/$clientVersion")
            .post(V1.body(req).toRequestBody(JSON))
            .build()
        try {
            http.newCall(request).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    val err = try { JSONObject(text).optString("error") } catch (e: JSONException) { "" }
                    throw ApiError.Status(r.code, err)
                }
                return V1.parse(text)
            }
        } catch (e: ApiError) {
            throw e
        } catch (e: InterruptedIOException) {
            throw ApiError.Timeout
        } catch (e: IOException) {
            throw ApiError.Network(e.javaClass.simpleName)
        }
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS = 6000L
        private val JSON = "application/json".toMediaType()
    }
}

/** A minimal, serialisable form of a server verdict for the on-device cache. */
fun ServerVerdict.toJson(): String = raw
