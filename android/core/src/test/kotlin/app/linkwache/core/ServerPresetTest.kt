package app.linkwache.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerPresetTest {
    private val old = "https://old-preset.example"
    private val new = "https://new-preset.example"

    @Test
    fun listIsParsedAndNormalized() {
        assertEquals(listOf(old, "https://older.example"), ServerPreset.parseList("$old/, https://older.example;bogus $new", new))
        assertEquals(emptyList<String>(), ServerPreset.parseList("", new))
        assertEquals(emptyList<String>(), ServerPreset.parseList(null))
    }

    @Test
    fun oldPresetMovesToTheNewOne() {
        assertNull(ServerPreset.keepOverride("$old/", new, listOf(old)))
        assertEquals(new, ServerPreset.effective("$old/", new, listOf(old)))
    }

    @Test
    fun ownAddressStays() {
        assertEquals("https://my-own.example", ServerPreset.keepOverride("https://my-own.example/", new, listOf(old)))
        assertEquals("https://my-own.example", ServerPreset.effective("https://my-own.example", new, listOf(old)))
    }

    @Test
    fun freshInstallGetsTheNewPreset() {
        assertNull(ServerPreset.keepOverride(null, new, listOf(old)))
        assertEquals(new, ServerPreset.effective(null, new, listOf(old)))
        assertNull(ServerPreset.keepOverride(new, new, emptyList()))
    }

    @Test
    fun emptyPresetBreaksNothing() {
        assertEquals(old, ServerPreset.keepOverride(old, "", listOf(old)))
        assertEquals(old, ServerPreset.effective(old, "", listOf(old)))
        assertEquals("https://my-own.example", ServerPreset.effective("https://my-own.example", null, emptyList()))
        assertNull(ServerPreset.effective(null, "", emptyList()))
    }
}
