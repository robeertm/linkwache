package app.linkwache.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** All eight languages carry every text, with the same placeholders; wording rules hold. */
class StringsTest {
    private val res = File(System.getProperty("linkwache.android") ?: "..", "app/src/main/res")
    private val langs = listOf("en", "de", "tr", "pl", "ru", "es", "fr", "it")

    private fun load(lang: String): Map<String, String> {
        val f = File(res, (if (lang == "en") "values" else "values-$lang") + "/strings_lw.xml")
        assertTrue("missing $f", f.exists())
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f)
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length).associate { i ->
            val n = nodes.item(i)
            n.attributes.getNamedItem("name").nodeValue to n.textContent
        }
    }

    private val placeholder = Regex("\\{[a-z]+\\}")

    @Test
    fun everyLanguageIsComplete() {
        val en = load("en")
        assertTrue(en.size > 200)
        for (l in langs) {
            val m = load(l)
            assertEquals("keys of $l", en.keys, m.keys)
            for ((k, v) in m) {
                assertTrue("$l $k empty", v.isNotBlank())
                assertEquals("placeholders $l $k", placeholder.findAll(en[k]!!).map { it.value }.toSet(), placeholder.findAll(v).map { it.value }.toSet())
            }
        }
    }

    @Test
    fun neverCallsALinkSafe() {
        val en = load("en")
        for ((k, v) in en) {
            val cleaned = v.replace("Safe Browsing", "").replace("Safe Links", "")
            assertTrue("$k says safe: $v", !Regex("\\bsafe\\b", RegexOption.IGNORE_CASE).containsMatchIn(cleaned))
        }
        val de = load("de")
        for (k in de.keys.filter { it.startsWith("lw_toast_") || it.startsWith("lw_lvl_") || it == "lw_v_gruen" }) {
            assertTrue("$k: ${de[k]}", !Regex("\\bsicher\\b", RegexOption.IGNORE_CASE).containsMatchIn(de[k]!!))
        }
    }

    @Test
    fun codeOnlyUsesExistingKeys() {
        val en = load("en").keys
        val src = File(System.getProperty("linkwache.android") ?: "..", "app/src")
        val used = Regex("""\bt\("([a-z0-9.\-]+)"""")
        val missing = ArrayList<String>()
        src.walkTopDown().filter { it.extension == "kt" }.forEach { f ->
            for (m in used.findAll(f.readText())) {
                val key = m.groupValues[1]
                if (key.endsWith(".")) continue
                if (Texts.resName(key) !in en) missing += "${f.name}: $key"
            }
        }
        assertTrue(missing.joinToString("\n"), missing.isEmpty())
    }
}
