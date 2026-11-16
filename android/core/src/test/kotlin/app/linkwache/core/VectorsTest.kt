package app.linkwache.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared vectors pin this port to the server code (heuristics.json, redirectors.json). */
class VectorsTest {
    @Test
    fun heuristicsVectorsMatchTheServer() {
        val vectors = JSONObject(TestFiles.read("test/vectors/heuristics.json")).getJSONArray("vectors")
        assertTrue(vectors.length() >= 30)
        val failures = ArrayList<String>()
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val url = v.getString("url")
            val expected = (0 until v.getJSONArray("findings").length()).map {
                val f = v.getJSONArray("findings").getJSONObject(it)
                f.getString("key") + ":" + f.getString("stufe")
            }
            val got = Heuristics.heuristics(url)
            if (got == null) {
                failures += "$url: does not parse"
                continue
            }
            val gotKeys = got.map { it.key + ":" + it.level.wire }
            val stufe = Heuristics.verdict(got, url).level.wire
            if (gotKeys != expected || stufe != v.getString("stufe")) {
                failures += "$url: expected $expected/${v.getString("stufe")}, got $gotKeys/$stufe"
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun redirectorVectors() {
        val vectors = JSONObject(TestFiles.read("test/vectors/redirectors.json")).getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val out = if (v.isNull("out")) null else v.getString("out")
            assertEquals(v.getString("in"), out, Redirectors.unwrap(v.getString("in")))
        }
    }

    @Test
    fun brandOwnersOwnDomainsAreNotImitations() {
        for (u in listOf("https://outlook.office.com/mail/", "https://login.microsoftonline.com/x", "https://outlook.live.com/")) {
            assertEquals(u, 0, Heuristics.heuristics(u)!!.count { it.level == Level.ROT })
        }
        assertTrue(Heuristics.heuristics("https://paypal.com.office.com.example/")!!.any { it.key == "brand-sub" })
    }

    @Test
    fun publicSuffixIcannOnly() {
        assertEquals("co.uk", Psl.suffix("accounts.example.co.uk"))
        assertEquals("io", Psl.suffix("someone.github.io"))
        assertEquals(Triple("example.co.uk", "co.uk", "accounts"), splitHost("accounts.example.co.uk"))
        assertEquals(Triple("github.io", "io", "someone"), splitHost("someone.github.io"))
    }
}
