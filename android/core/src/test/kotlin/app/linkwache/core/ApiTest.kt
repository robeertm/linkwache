package app.linkwache.core

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ApiTest {
    private val server = MockWebServer().apply { start() }

    @After
    fun stop() = server.shutdown()

    private fun api(timeout: Long = 2000) = HttpCheckApi(server.url("/").toString(), "0123456789abcdef0123456789abcdef", "1.2.3", timeout)

    @Test
    fun contract() {
        server.enqueue(MockResponse().setBody("""{"api":1,"stufe":"gelb","score":3,"kurzKey":"v.gelb.one","ratKey":"v.gelb.one.rat","kurz":"k","rat":"r","url":"https://a.example/","host":{"host":"a.example"},"chain":["bit.ly"],"findings":[{"key":"tld","stufe":"gelb","p":{"tld":"top"},"titel":"t","text":"x"}],"cacheTtl":21600,"checked":"x","server":"0.5.0"}"""))
        val v = api().check(CheckRequest("https://a.example/", "de", Scope.URL))
        assertEquals(Level.GELB, v.level)
        assertEquals(21600L, v.cacheTtl)
        assertEquals(listOf("bit.ly"), v.chain)
        val req = server.takeRequest()
        assertEquals("/api/v1/check", req.path)
        assertEquals("POST", req.method)
        assertEquals("0123456789abcdef0123456789abcdef", req.getHeader("x-linkwache-install"))
        assertEquals("android/1.2.3", req.getHeader("x-linkwache-client"))
        assertTrue(req.getHeader("content-type")!!.startsWith("application/json"))
        assertNull(req.getHeader("origin"))
        val body = JSONObject(req.body.readUtf8())
        assertEquals("https://a.example/", body.getString("url"))
        assertEquals("de", body.getString("lang"))
        assertEquals("url", body.getString("scope"))
    }

    private fun expect(reason: String, block: () -> Unit) {
        try {
            block()
            fail("expected $reason")
        } catch (e: ApiError) {
            assertEquals(reason, e.reason)
        }
    }

    @Test
    fun errors() {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":"err.rate","retryAfter":30}"""))
        expect("rate") { api().check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"internal"}"""))
        expect("server") { api().check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        server.enqueue(MockResponse().setBody("<html>captive portal</html>"))
        expect("server") { api().check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        server.enqueue(MockResponse().setBody("""{"api":2,"stufe":"gruen"}"""))
        expect("server") { api().check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        server.enqueue(MockResponse().setResponseCode(302).setHeader("location", "https://elsewhere.example/"))
        expect("server") { api().check(CheckRequest("https://a.example/", "de", Scope.URL)) }
    }

    @Test
    fun hardTimeout() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val t0 = System.nanoTime()
        expect("timeout") { api(800).check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 3000)
    }

    @Test
    fun noServerAndUnreachable() {
        expect("noserver") { HttpCheckApi("", "x", "1").check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        expect("noserver") { HttpCheckApi("http://public.example", "x", "1").check(CheckRequest("https://a.example/", "de", Scope.URL)) }
        val port = server.port
        server.shutdown()
        expect("network") { HttpCheckApi("http://127.0.0.1:$port", "x", "1", 1500).check(CheckRequest("https://a.example/", "de", Scope.URL)) }
    }
}
