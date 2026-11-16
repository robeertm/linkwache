package app.linkwache.android

import android.annotation.SuppressLint
import android.content.Context
import app.linkwache.core.CheckResult
import app.linkwache.core.Finding

/**
 * Texts by key (`btn.close`, `f.tld`, …) from the generated string resources
 * (android/scripts/gen-strings.mjs). Placeholders `{name}` are filled from [p].
 */
object Texts {
    fun resName(key: String) = "lw_" + key.replace('.', '_').replace('-', '_')

    @SuppressLint("DiscouragedApi")
    fun get(ctx: Context, key: String, vararg p: Pair<String, Any?>): String {
        val id = ctx.resources.getIdentifier(resName(key), "string", ctx.packageName)
        var s = if (id != 0) ctx.getString(id) else key
        for ((k, v) in p) s = s.replace("{$k}", v?.toString().orEmpty())
        return s
    }

    fun has(ctx: Context, key: String): Boolean {
        @SuppressLint("DiscouragedApi")
        val id = ctx.resources.getIdentifier(resName(key), "string", ctx.packageName)
        return id != 0
    }

    private fun fill(s: String, p: Map<String, String>): String {
        var out = s
        for ((k, v) in p) out = out.replace("{$k}", v)
        return out
    }

    fun findingTitle(ctx: Context, f: Finding): String {
        f.titel?.let { return it }
        val key = (if (f.pattern) "pat." else "f.") + f.key
        return if (has(ctx, key)) fill(get(ctx, key), f.p) else f.key
    }

    fun findingText(ctx: Context, f: Finding): String? {
        f.text?.let { return it }
        val key = (if (f.pattern) "pat." else "f.") + f.key + ".t"
        return if (has(ctx, key)) fill(get(ctx, key), f.p) else null
    }

    fun verdictShort(ctx: Context, r: CheckResult): String = r.kurz ?: get(ctx, r.kurzKey)
    fun verdictAdvice(ctx: Context, r: CheckResult): String = r.rat ?: get(ctx, r.ratKey)

    /** Server language parameter: the app's current language if the server knows it. */
    fun lang(ctx: Context): String {
        val l = ctx.resources.configuration.locales[0].language
        return if (l in setOf("de", "en", "tr", "pl", "ru", "es", "fr", "it")) l else "en"
    }
}
