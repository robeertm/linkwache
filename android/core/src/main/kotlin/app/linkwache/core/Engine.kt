package app.linkwache.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * The check flow (docs/DESKTOP.md section 5): classify → refuse non-http(s) → unwrap
 * wrappers → local heuristics → allowlist → cache → server (hard timeout) → merge.
 * Never "opens silently": an error ends as OFFLINE with the local assessment, except that a
 * locally red link stays red.
 */
data class EngineSettings(
    val allowlist: Set<String> = emptySet(),
    val scope: Scope = Scope.URL,
    val paused: Boolean = false,
)

data class Prepared(
    val url: String,
    val target: HttpUrl,
    val unwrapped: Boolean,
    val local: Verdict,
    /** Allowlist or cache hit: no server call needed. */
    val early: CheckResult?,
)

sealed class Decision {
    data class Refused(val scheme: String) : Decision()
    data class Paused(val url: String) : Decision()
    data class Check(val prepared: Prepared) : Decision()
}

class Engine(
    private val settings: EngineSettings,
    private val api: CheckApi,
    private val cache: VerdictCache,
    private val nowSec: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    fun prepare(raw: String?): Decision {
        val u = when (val inc = Link.classify(raw)) {
            is Incoming.Refused -> return Decision.Refused(inc.scheme)
            is Incoming.Web -> inc.url
        }
        val url = u.toString()
        if (settings.paused) return Decision.Paused(url)
        val unwrappedRaw = Redirectors.unwrap(url)
        val target = unwrappedRaw?.toHttpUrl() ?: u
        val targetRaw = unwrappedRaw ?: url
        val local = Heuristics.verdict(Heuristics.heuristics(targetRaw, target), targetRaw)
        val base = Prepared(url, target, unwrappedRaw != null, local, null)
        if (local.level != Level.ROT) {
            Allowlist.match(settings.allowlist, target)?.let { entry ->
                val r = baseResult(base).copy(
                    outcome = Outcome.GRUEN, source = Source.ALLOWLIST, kurzKey = "v.gruen", ratKey = "v.gruen.rat",
                    findings = emptyList(), allowEntry = entry,
                )
                return Decision.Check(base.copy(early = r))
            }
        }
        cache.get(VerdictCache.key(target, settings.scope), nowSec())?.let { v ->
            return Decision.Check(base.copy(early = merge(base, v, Source.CACHE)))
        }
        return Decision.Check(base)
    }

    /** Ask the server (blocking, hard timeout in the client) and cache the answer. */
    fun remote(p: Prepared, lang: String): CheckResult {
        val req = CheckRequest(Link.reduce(p.target, settings.scope), lang, settings.scope)
        return try {
            val v = api.check(req)
            cache.put(VerdictCache.key(p.target, settings.scope), v, nowSec())
            merge(p, v, Source.SERVER)
        } catch (e: ApiError) {
            offline(p, e.reason)
        } catch (e: RuntimeException) {
            offline(p, "server")
        }
    }

    /** Full check: early answer if there is one, else the server. */
    fun check(raw: String?, lang: String): Pair<Decision, CheckResult?> {
        val d = prepare(raw)
        val r = (d as? Decision.Check)?.let { it.prepared.early ?: remote(it.prepared, lang) }
        return d to r
    }

    companion object {
        fun baseResult(p: Prepared): CheckResult {
            val h = hostInfo(p.target)
            return CheckResult(
                url = p.url, target = p.target.toString(), unwrapped = p.unwrapped,
                host = h.host, domain = h.domain, unicodeHost = h.unicodeHost,
                outcome = p.local.level.toOutcome(), source = Source.LOCAL,
                kurzKey = p.local.kurzKey, ratKey = p.local.ratKey,
                findings = p.local.findings, local = p.local,
            )
        }

        private fun Level.toOutcome() = when (this) {
            Level.ROT -> Outcome.ROT
            Level.GELB -> Outcome.GELB
            else -> Outcome.GRUEN
        }

        /**
         * Combine the server answer with the local assessment: the worse level wins, server
         * findings (translated) first, local findings the server did not report are added.
         */
        fun merge(p: Prepared, v: ServerVerdict, source: Source): CheckResult {
            val r = baseResult(p)
            val keys = v.findings.map { it.key }.toSet()
            val findings = (v.findings + p.local.findings.filter { it.key !in keys }).sortedBy { it.level.order }
            val worse = p.local.level.severity > v.level.severity
            return if (worse) {
                r.copy(findings = findings, source = source, chain = v.chain)
            } else {
                r.copy(
                    outcome = v.level.toOutcome(), findings = findings, source = source, chain = v.chain,
                    kurzKey = v.kurzKey ?: r.kurzKey, ratKey = v.ratKey ?: r.ratKey, kurz = v.kurz, rat = v.rat,
                )
            }
        }

        fun offline(p: Prepared, reason: String): CheckResult {
            val r = baseResult(p)
            // A link the local heuristics already rate red stays blocked without the server.
            if (p.local.level == Level.ROT) return r.copy(reason = reason)
            return r.copy(outcome = Outcome.OFFLINE, reason = reason)
        }
    }
}
