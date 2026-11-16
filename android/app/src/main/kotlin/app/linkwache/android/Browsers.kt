package app.linkwache.android

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Browser
import android.provider.Settings
import androidx.browser.customtabs.CustomTabsIntent

/** Installed browsers, the default-browser role, and handing a checked link to the real browser. */
object Browsers {
    data class App(val pkg: String, val label: String, val icon: Drawable?)

    private val PROBE: Uri = Uri.parse("https://example.org/")

    private fun viewIntent() = Intent(Intent.ACTION_VIEW, PROBE).addCategory(Intent.CATEGORY_BROWSABLE)

    /** Package names of every app that opens https links, without Linkwache itself. */
    fun packages(ctx: Context): List<String> {
        @Suppress("DEPRECATION")
        val list = ctx.packageManager.queryIntentActivities(viewIntent(), PackageManager.MATCH_ALL)
        return list.map { it.activityInfo.packageName }.distinct().filter { it != ctx.packageName }
    }

    /** Every app that opens https links (with label and icon), without Linkwache itself. */
    fun installed(ctx: Context): List<App> {
        val pm = ctx.packageManager
        return packages(ctx)
            .map { pkg ->
                val ai = runCatching { pm.getApplicationInfo(pkg, 0) }.getOrNull()
                App(pkg, ai?.let { pm.getApplicationLabel(it).toString() } ?: pkg, ai?.let { runCatching { pm.getApplicationIcon(it) }.getOrNull() })
            }
            .sortedBy { it.label.lowercase() }
    }

    /** The package the system currently opens web links with (null = chooser / none). */
    fun systemDefault(ctx: Context): String? {
        @Suppress("DEPRECATION")
        val ri = ctx.packageManager.resolveActivity(viewIntent(), PackageManager.MATCH_DEFAULT_ONLY) ?: return null
        val pkg = ri.activityInfo?.packageName ?: return null
        return if (pkg == "android" || pkg.contains("resolver")) null else pkg
    }

    fun isInstalled(ctx: Context, pkg: String?): Boolean =
        pkg != null && pkg != ctx.packageName && pkg in packages(ctx)

    /** Suggested forward target: the previous default browser, else the first one found. */
    fun suggestion(ctx: Context): String? {
        val d = systemDefault(ctx)
        if (d != null && d != ctx.packageName) return d
        return installed(ctx).firstOrNull()?.pkg
    }

    fun label(ctx: Context, pkg: String?): String {
        pkg ?: return "–"
        val pm = ctx.packageManager
        return runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
    }

    /** Is Linkwache the default browser? */
    fun isLinkwacheDefault(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = ctx.getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_BROWSER)) return rm.isRoleHeld(RoleManager.ROLE_BROWSER)
        }
        return systemDefault(ctx) == ctx.packageName
    }

    /** The system dialog "Set Linkwache as default browser?" (Android 10+), or null. */
    fun roleRequestIntent(ctx: Context): Intent? {
        if (Build.VERSION.SDK_INT < 29) return null
        val rm = ctx.getSystemService(RoleManager::class.java) ?: return null
        if (!rm.isRoleAvailable(RoleManager.ROLE_BROWSER)) return null
        return rm.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
    }

    fun defaultAppsSettingsIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Open [url] in the saved real browser — always with an explicit package, so a link can
     * never come back to Linkwache (no loop). [asCustomTab] keeps the in-app look for links
     * that arrived from a Custom Tab. Returns false if that browser is gone.
     */
    fun forward(ctx: Context, url: String, pkg: String?, asCustomTab: Boolean = false, extras: Bundle? = null): Boolean {
        if (pkg == null || pkg == ctx.packageName) return false
        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return false
        val intent = if (asCustomTab) {
            CustomTabsIntent.Builder().setShowTitle(true).build().intent.setData(uri)
        } else {
            Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        }
        intent.setPackage(pkg)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Let the browser reuse one tab for links from the same app, like a direct open would.
        extras?.getString(Browser.EXTRA_APPLICATION_ID)?.let { intent.putExtra(Browser.EXTRA_APPLICATION_ID, it) }
        return try {
            ctx.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        } catch (e: SecurityException) {
            false
        }
    }
}
