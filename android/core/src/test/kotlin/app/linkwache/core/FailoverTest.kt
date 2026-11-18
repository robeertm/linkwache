package app.linkwache.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FailoverTest {
    private class Clock { var now = 1_000_000L; fun get() = now }

    private val req = CheckRequest("https://a.example/", "de", Scope.URL)

    private fun verdict(level: Level = Level.GRUEN) =
        ServerVerdict(level, null, null, null, null, null, emptyList(), emptyList(), null, "{}")

    /** A fake server: answers from a script, spends fake time, records the timeout it was given. */
    private class Fake(val clock: Clock, var reply: (Int) -> ServerVerdict) : TimedCheckApi {
        var calls = 0
        val timeouts = ArrayList<Long>()
        override fun check(req: CheckRequest): ServerVerdict = check(req, 6000)
        override fun check(req: CheckRequest, timeoutMs: Long): ServerVerdict {
            calls++
            timeouts += timeoutMs
            return reply(calls)
        }
    }

    private fun failing(c: Clock, e: ApiError, spendMs: Long) = Fake(c) { c.now += spendMs; throw e }
    private fun answering(c: Clock, level: Level = Level.GRUEN) = Fake(c) { verdict(level) }

    private class Setup(
        val clock: Clock, val main: Fake, val reserve: Fake?,
        val probeOk: Boolean = false,
    ) {
        val state = FailoverState(clock::get)
        var renewed = 0
        var probes = 0
        val queued = ArrayList<Runnable>()
        var probeResult = probeOk
        val api = FailoverCheckApi(
            main, reserve, state, clock::get,
            renewInstall = { renewed++ },
            healthProbe = { probes++; probeResult },
            async = { it.run() },
        )
    }

    private fun expectError(s: Setup, reason: String) {
        try {
            s.api.check(req)
            fail("expected $reason")
        } catch (e: ApiError) {
            assertEquals(reason, e.reason)
        }
    }

    @Test
    fun mainDownReserveAnswersViaReserve() {
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Timeout, 4500), answering(c, Level.GELB))
        val v = s.api.check(req)
        assertEquals(Level.GELB, v.level)
        assertTrue(v.viaReserve)
        assertEquals(listOf(4500L), s.main.timeouts)
        assertEquals(listOf(3500L), s.reserve!!.timeouts) // min(6 s, 8 s - 4.5 s)
        assertTrue(s.state.isDown())
    }

    @Test
    fun mainUpIsNotMarkedViaReserve() {
        val c = Clock()
        val s = Setup(c, answering(c), answering(c))
        assertFalse(s.api.check(req).viaReserve)
        assertEquals(0, s.reserve!!.calls)
    }

    @Test
    fun failoverWorthyClasses() {
        for (e in listOf(
            ApiError.Network("x"), ApiError.Status(500, "internal"), ApiError.Status(503, ""),
            ApiError.Status(502, "", json = false), ApiError.Status(404, "", json = false), ApiError.BadResponse("api"),
        )) {
            val c = Clock()
            val s = Setup(c, failing(c, e, 100), answering(c))
            assertTrue("$e", s.api.check(req).viaReserve)
        }
    }

    @Test
    fun notFailoverWorthyNeverReachesTheReserve() {
        for (e in listOf(
            ApiError.Status(429, "err.rate"), ApiError.Status(403, "refused"), ApiError.Status(400, "err.url"),
            ApiError.Status(413, "err.size"), ApiError.NoServer,
        )) {
            val c = Clock()
            val s = Setup(c, failing(c, e, 50), answering(c))
            try {
                s.api.check(req)
                fail("expected error for $e")
            } catch (x: ApiError) {
                assertEquals(e.reason, x.reason)
            }
            assertEquals("$e", 0, s.reserve!!.calls)
            assertFalse(s.state.isDown())
        }
    }

    @Test
    fun bothDownReportsTheMainReason() {
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Timeout, 4500), failing(c, ApiError.Network("x"), 100))
        expectError(s, "timeout")
        assertTrue(c.now - 1_000_000L <= 8000)
        // down-marked: the reserve fails first, then the main one is tried again with the rest
        val s2 = Setup(c, failing(c, ApiError.Status(503, ""), 100), failing(c, ApiError.Network("x"), 100))
        expectError(s2, "server")
        expectError(s2, "server")
        assertEquals(2, s2.main.calls)
    }

    @Test
    fun ownAddressHasNoReserve() {
        val p = "https://main.example"
        val migrate = emptyList<String>()
        assertNull(ServerPreset.reserve("https://own.example", p, migrate, "https://reserve.example"))
        assertEquals("https://reserve.example", ServerPreset.reserve(null, p, migrate, "https://reserve.example"))
        assertEquals("https://reserve.example", ServerPreset.reserve(p, p, migrate, "https://reserve.example"))
        assertNull(ServerPreset.reserve(null, p, migrate, ""))
        assertNull(ServerPreset.reserve(null, p, migrate, p))
        assertNull(ServerPreset.reserve(null, "", migrate, "https://reserve.example"))
        // no reserve api given: a failure stays a failure
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Timeout, 4500), null)
        expectError(s, "timeout")
    }

    @Test
    fun installErrorRenewsAndRepeatsOnTheSameServer() {
        val c = Clock()
        val main = Fake(c) { n -> if (n == 1) throw ApiError.Status(400, "err.install") else verdict() }
        val s = Setup(c, main, answering(c))
        val v = s.api.check(req)
        assertFalse(v.viaReserve)
        assertEquals(1, s.renewed)
        assertEquals(2, main.calls)
        assertEquals(0, s.reserve!!.calls)
        assertFalse(s.state.isDown())
        // repeats only once
        val c2 = Clock()
        val bad = failing(c2, ApiError.Status(400, "err.install"), 10)
        val s2 = Setup(c2, bad, answering(c2))
        expectError(s2, "server")
        assertEquals(2, bad.calls)
        assertEquals(0, s2.reserve!!.calls)
    }

    @Test
    fun rateLimitIsRespected() {
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Status(429, "err.rate"), 20), answering(c))
        expectError(s, "rate")
        assertEquals(0, s.reserve!!.calls)
    }

    @Test
    fun budgetNeverExceedsEightSeconds() {
        val c = Clock()
        val t0 = c.now
        // main eats 4.5 s, the reserve is given 3.5 s and eats all of it
        val s = Setup(c, failing(c, ApiError.Timeout, 4500), failing(c, ApiError.Timeout, 3500))
        expectError(s, "timeout")
        assertTrue(c.now - t0 <= 8000)
        assertEquals(3500L, s.reserve!!.timeouts.single())
        // main used the whole budget: the reserve is skipped below 1.5 s
        val c2 = Clock()
        val s2 = Setup(c2, failing(c2, ApiError.Timeout, 7000), answering(c2))
        expectError(s2, "timeout")
        assertEquals(0, s2.reserve!!.calls)
        // reserve gets at most 6 s
        val c3 = Clock()
        val s3 = Setup(c3, failing(c3, ApiError.Network("x"), 100), answering(c3))
        assertTrue(s3.api.check(req).viaReserve)
        assertEquals(6000L, s3.reserve!!.timeouts.single())
    }

    @Test
    fun downStateSendsChecksStraightToTheReserveAndBackAfterFiveMinutes() {
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Timeout, 10), answering(c))
        assertTrue(s.api.check(req).viaReserve)
        val mainCalls = s.main.calls
        c.now += 30_000
        assertTrue(s.api.check(req).viaReserve)
        assertEquals(mainCalls, s.main.calls) // main not asked while marked down
        assertEquals(6000L, s.reserve!!.timeouts.last())
        // after five minutes the main server is tried first again
        c.now += 5 * 60_000
        s.main.reply = { verdict() }
        val v = s.api.check(req)
        assertFalse(v.viaReserve)
        assertFalse(s.state.isDown())
    }

    @Test
    fun healthProbeSwitchesBackAtMostOncePerMinute() {
        val c = Clock()
        val s = Setup(c, failing(c, ApiError.Timeout, 10), answering(c))
        s.api.check(req) // marks down; probe is not started during the failing check
        assertEquals(0, s.probes)
        s.probeResult = false
        s.api.check(req)
        assertEquals(1, s.probes)
        c.now += 20_000
        s.api.check(req)
        assertEquals(1, s.probes) // within a minute: no new probe
        c.now += 41_000
        s.probeResult = true
        s.main.reply = { verdict() } // the main server is back
        val v = s.api.check(req)
        assertEquals(2, s.probes)
        assertFalse(s.state.isDown()) // the probe cleared the mark
        assertFalse(v.viaReserve) // so this check already asked the main server first
    }

    @Test
    fun probeNeverBlocksTheCheck() {
        val c = Clock()
        val queued = ArrayList<Runnable>()
        val state = FailoverState(c::get)
        val main = failing(c, ApiError.Timeout, 10)
        val reserve = answering(c)
        var probed = 0
        val api = FailoverCheckApi(main, reserve, state, c::get, healthProbe = { probed++; true }, async = { queued += it })
        api.check(req)
        assertTrue(api.check(req).viaReserve)
        assertEquals(0, probed) // handed to the executor, not run inside the check
        assertEquals(1, queued.size)
        queued.single().run()
        assertEquals(1, probed)
        assertFalse(state.isDown())
    }
}
