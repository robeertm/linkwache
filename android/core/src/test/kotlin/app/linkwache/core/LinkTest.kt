package app.linkwache.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkTest {
    @Test
    fun serverAddress() {
        assertEquals("https://lw.example", Link.validServer("https://lw.example/"))
        assertEquals("https://lw.example/sub", Link.validServer(" https://lw.example/sub/ "))
        assertEquals("http://10.0.2.2:8787", Link.validServer("http://10.0.2.2:8787"))
        assertEquals("http://192.168.1.5", Link.validServer("http://192.168.1.5/"))
        assertNull(Link.validServer("http://lw.example"))
        assertNull(Link.validServer("ftp://lw.example"))
        assertNull(Link.validServer(""))
    }

    @Test
    fun sharedText() {
        assertEquals("https://paket-info.example/x", Link.fromSharedText("Ihr Paket: https://paket-info.example/x. Danke!").toString())
        assertEquals("https://www.example.org/", Link.fromSharedText("schau mal www.example.org").toString())
        assertNull(Link.fromSharedText("kein link hier"))
    }

    @Test
    fun allowlistEntries() {
        assertEquals(Allowlist.Entry.Ok("example.com"), Allowlist.normalize("https://Shop.Example.com/x"))
        assertEquals(Allowlist.Entry.Ok("example.co.uk"), Allowlist.normalize("a.example.co.uk"))
        assertEquals(Allowlist.Entry.Ip, Allowlist.normalize("192.0.2.1"))
        assertEquals(Allowlist.Entry.Idn, Allowlist.normalize("pаypal.com"))
        assertEquals(Allowlist.Entry.Invalid, Allowlist.normalize("co.uk"))
        assertEquals(Allowlist.Entry.Invalid, Allowlist.normalize("localhost"))
    }

    @Test
    fun updates() {
        val rel = """{"tag_name":"v0.6.0","draft":false,"prerelease":false,"html_url":"https://github.com/o/r/releases/tag/v0.6.0","assets":[
            {"name":"Linkwache-android-0.6.0.apk","size":123,"browser_download_url":"https://github.com/o/r/releases/download/v0.6.0/Linkwache-android-0.6.0.apk","digest":"sha256:${"a".repeat(64)}"},
            {"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/o/r/releases/download/v0.6.0/SHA256SUMS.txt"}]}"""
        val u = Update.parseLatest(rel, "0.5.0")!!
        assertEquals("0.6.0", u.version)
        assertEquals("a".repeat(64), u.sha256)
        assertNull(Update.parseLatest(rel, "0.6.0"))
        assertNull(Update.parseLatest(rel, "0.10.0"))
        assertNull(Update.parseLatest(rel.replace("\"prerelease\":false", "\"prerelease\":true"), "0.5.0"))
        assertNull(Update.parseLatest(rel.replace("Linkwache-android-0.6.0.apk", "other.apk"), "0.5.0"))
        assertNull(Update.parseLatest(rel.replace("v0.6.0\",\"draft", "v0.7.0\",\"draft"), "0.5.0"))
        val noDigest = Update.parseLatest(rel.replace("\"digest\":\"sha256:${"a".repeat(64)}\"", "\"digest\":null"), "0.5.0")!!
        assertNull(noDigest.sha256)
        assertTrue(noDigest.sumsUrl!!.endsWith("SHA256SUMS.txt"))
        assertEquals("b".repeat(64), Update.shaFromSums("${"c".repeat(64)}  other.zip\n${"B".repeat(64)}  Linkwache-android-0.6.0.apk\n", "Linkwache-android-0.6.0.apk"))
        assertTrue(Update.compare("0.10.0", "0.9.9") > 0)
        assertEquals(500, Update.versionCode("0.5.0"))
        assertEquals(10203, Update.versionCode("1.2.3"))
        assertTrue(Update.sameSigner(setOf("x"), setOf("x")))
        assertTrue(!Update.sameSigner(setOf("x"), setOf("x", "y")))
        assertTrue(!Update.sameSigner(emptySet(), emptySet()))
    }
}
