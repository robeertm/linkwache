package app.linkwache.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.linkwache.core.Finding
import app.linkwache.core.Level
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class AndroidPartsTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun forwardNeverLoopsToItself() {
        assertFalse(Browsers.forward(ctx, "https://example.org/", ctx.packageName))
        assertFalse(Browsers.forward(ctx, "https://example.org/", null))
        assertFalse(Browsers.forward(ctx, "javascript:alert(1)", "com.example.browser"))
        assertFalse(Browsers.forward(ctx, "intent://x#Intent;end", "com.example.browser"))
    }

    @Test
    fun textsResolveWithPlaceholders() {
        assertEquals("Open anyway (3)", Texts.get(ctx, "btn.openin", "n" to 3))
        val f = Finding("tld", Level.GELB, mapOf("tld" to "top"))
        assertEquals("The ending .top is popular with scammers", Texts.findingTitle(ctx, f))
        assertEquals("server text wins", Texts.findingTitle(ctx, f.copy(titel = "server text wins")))
        assertTrue(Texts.findingText(ctx, f)!!.isNotEmpty())
    }

    @Test
    @Config(qualifiers = "de")
    fun germanTexts() {
        assertEquals("Keine Warnzeichen gefunden", Texts.get(ctx, "v.gruen"))
        assertEquals("de", Texts.lang(ctx))
    }

    @Test
    fun prefsKeepHistoryShortAndLocal() {
        val p = Prefs(ctx)
        p.clearHistory()
        repeat(Prefs.MAX_HISTORY + 20) { p.addHistory("d$it.example", "gruen", "opened") }
        assertEquals(Prefs.MAX_HISTORY, p.history().size)
        assertEquals("d219.example", p.history().first().domain)
        assertEquals(32, p.installId.length)
        val old = p.installId
        assertTrue(p.resetInstallId() != old)
    }

    @Test
    fun builtInAddressMovesOwnAddressStays() {
        val old = "https://old-preset.example"
        val new = "https://new-preset.example"
        val p = Prefs(ctx)
        // 0.5.x stored nothing for the preset: follows the new one without any change
        p.serverOverride = null
        assertFalse(p.migrateServer(new, listOf(old)))
        assertEquals(null, p.serverOverride)
        // a stored copy of the old preset is dropped
        p.serverOverride = "$old/"
        assertTrue(p.migrateServer(new, listOf(old)))
        assertEquals(null, p.serverOverride)
        // an own address stays
        p.serverOverride = "https://my-own.example"
        assertFalse(p.migrateServer(new, listOf(old)))
        assertEquals("https://my-own.example", p.serverOverride)
        // empty preset: nothing is touched
        p.serverOverride = old
        assertFalse(p.migrateServer("", listOf(old)))
        assertEquals(old, p.serverOverride)
        p.serverOverride = null
    }
}
