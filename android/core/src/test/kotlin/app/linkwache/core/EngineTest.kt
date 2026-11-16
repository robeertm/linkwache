package app.linkwache.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineTest {
    private fun answer(stufe: String, findings: String = "[]", ttl: String = "") =
        V1.parse("""{"api":1,"rules":2,"stufe":"$stufe","score":0,"kurzKey":"v.$stufe","ratKey":"v.$stufe.rat","kurz":"K-$stufe","rat":"R","url":"x","host":{},"chain":[],"findings":$findings$ttl,"checked":"t","server":"0.5.0"}""")

    private class Recorder(var reply: () -> ServerVerdict) : CheckApi {
        val calls = ArrayList<CheckRequest>()
        override fun check(req: CheckRequest): ServerVerdict { calls += req; return reply() }
    }

    @Test
    fun greenFromServerAndCached() {
        val api = Recorder { answer("gruen") }
        var now = 1000L
        val cache = VerdictCache()
        val e = Engine(EngineSettings(), api, cache) { now }
        val (_, r) = e.check("https://shop.example.org/a/b?token=secret#frag", "de")
        assertEquals(Outcome.GRUEN, r!!.outcome)
        assertEquals(Source.SERVER, r.source)
        // Query and fragment never leave the device.
        assertEquals("https://shop.example.org/a/b", api.calls.single().url)
        val (_, again) = e.check("https://shop.example.org/a/b?other=1", "de")
        assertEquals(Source.CACHE, again!!.source)
        assertEquals(1, api.calls.size)
        now += VerdictCache.GREEN_TTL + 1
        e.check("https://shop.example.org/a/b", "de")
        assertEquals(2, api.calls.size)
    }

    @Test
    fun domainScopeSendsHostOnly() {
        val api = Recorder { answer("gruen") }
        Engine(EngineSettings(scope = Scope.DOMAIN), api, VerdictCache()).check("https://a.example.org:8443/x?y", "en")
        assertEquals("https://a.example.org/", api.calls.single().url)
        assertEquals(Scope.DOMAIN, api.calls.single().scope)
    }

    @Test
    fun localRedBeatsServerGreen() {
        val api = Recorder { answer("gruen") }
        val (_, r) = Engine(EngineSettings(), api, VerdictCache()).check("https://paypal.com.secure-login.example/x", "de")
        assertEquals(Outcome.ROT, r!!.outcome)
        assertTrue(r.findings.any { it.key == "brand-sub" })
    }

    @Test
    fun serverWarningsWin() {
        val api = Recorder { answer("gelb", """[{"key":"age-young","stufe":"gelb","p":{"age":40},"titel":"T","text":"X"}]""") }
        val (_, r) = Engine(EngineSettings(), api, VerdictCache()).check("https://new-shop.example/", "de")
        assertEquals(Outcome.GELB, r!!.outcome)
        assertEquals("K-gelb", r.kurz)
        assertEquals("T", r.findings.first().titel)
        assertEquals("40", r.findings.first().p["age"])
    }

    @Test
    fun offlineNeverOpensSilently() {
        for (err in listOf(ApiError.Timeout, ApiError.Network("x"), ApiError.Status(500, "internal"), ApiError.Status(429, "err.rate"), ApiError.NoServer)) {
            val api = Recorder { throw err }
            val (_, r) = Engine(EngineSettings(), api, VerdictCache()).check("https://example.org/", "de")
            assertEquals(Outcome.OFFLINE, r!!.outcome)
            assertEquals(err.reason, r.reason)
        }
    }

    @Test
    fun offlineLocalRedStaysRed() {
        val api = Recorder { throw ApiError.Timeout }
        val (_, r) = Engine(EngineSettings(), api, VerdictCache()).check("https://192.0.2.10/login", "de")
        assertEquals(Outcome.ROT, r!!.outcome)
        assertEquals("timeout", r.reason)
    }

    @Test
    fun allowlistSkipsServer() {
        val api = Recorder { error("must not be called") }
        val e = Engine(EngineSettings(allowlist = setOf("example.org")), api, VerdictCache())
        val (_, r) = e.check("https://accounts.example.org/x", "de")
        assertEquals(Source.ALLOWLIST, r!!.source)
        assertEquals("example.org", r.allowEntry)
        val (_, w) = e.check("https://www.wikipedia.org/wiki/Link", "de")
        assertEquals(Outcome.GRUEN, w!!.outcome)
        // Look-alikes and user content never match the allowlist.
        val api2 = Recorder { answer("gruen") }
        val e2 = Engine(EngineSettings(), api2, VerdictCache())
        assertEquals(Source.SERVER, e2.check("https://docs.google.com/forms/x", "de").second!!.source)
        assertEquals(Source.SERVER, e2.check("https://google.com:8080/", "de").second!!.source)
        assertEquals(Source.SERVER, e2.check("https://xn--ggle-0nda.com/", "de").second!!.source)
    }

    @Test
    fun wrappersAreUnwrapped() {
        val api = Recorder { answer("gruen") }
        val (_, r) = Engine(EngineSettings(), api, VerdictCache())
            .check("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcheap-deals.top%2F&data=1", "de")
        assertTrue(r!!.unwrapped)
        assertEquals("https://cheap-deals.top/", r.target)
        assertEquals("https://cheap-deals.top/", api.calls.single().url)
        assertTrue(r.url.contains("safelinks"))
        assertEquals(Outcome.GELB, r.outcome)
    }

    @Test
    fun foreignSchemesAreRefusedAndPauseOpensDirectly() {
        val e = Engine(EngineSettings(), Recorder { answer("gruen") }, VerdictCache())
        for (s in listOf("mailto:a@example.org", "javascript:alert(1)", "intent://x#Intent;end", "file:///sdcard/x.html", "", "tel:123")) {
            assertTrue(s, e.prepare(s) is Decision.Refused)
        }
        assertTrue(Engine(EngineSettings(paused = true), Recorder { answer("gruen") }, VerdictCache()).prepare("https://example.org") is Decision.Paused)
    }

    @Test
    fun cacheSurvivesSerialisation() {
        val c = VerdictCache()
        c.put("k", answer("rot"), 100)
        val d = VerdictCache().apply { load(c.toJson(100), 100) }
        assertEquals(Level.ROT, d.get("k", 200)!!.level)
        assertNull(d.get("k", 100 + VerdictCache.WARN_TTL + 1))
    }

    @Test
    fun answersOfOlderRulesAreNotUsed() {
        // a red answer cached by 0.5.1 (no rules field), as stored on the device
        val old = V1.parse("""{"api":1,"stufe":"rot","findings":[]}""")
        assertEquals(1, old.rules)
        val c = VerdictCache()
        c.put("k", old, 100)
        assertNull("pre-0.5.3 answer ignored", c.get("k", 101))
        val stored = """{"k":{"x":999999,"b":${org.json.JSONObject.quote(old.raw)}}}"""
        val d = VerdictCache().apply { load(stored, 100) }
        assertEquals(0, d.size())
        // newer rules from the server drop everything older
        d.put("n", answer("gruen"), 100)
        d.noteRules(3)
        assertNull(d.get("n", 101))
    }

    @Test
    fun serverMaySoftenAFindingItReportedItself() {
        val soft = V1.parse("""{"api":1,"rules":2,"stufe":"gruen","findings":[{"key":"http","stufe":"info","p":{"known":true}}]}""")
        val (_, r) = Engine(EngineSettings(), Recorder { soft }, VerdictCache()).check("http://www.example.com/", "en")
        assertEquals(Outcome.GRUEN, r!!.outcome)
        // a local finding the server did not report still counts
        val (_, r2) = Engine(EngineSettings(), Recorder { answer("gruen") }, VerdictCache()).check("http://plain.example.net/", "en")
        assertEquals(Outcome.GELB, r2!!.outcome)
    }
}
