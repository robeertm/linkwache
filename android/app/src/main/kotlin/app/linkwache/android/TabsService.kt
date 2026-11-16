package app.linkwache.android

import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsService
import androidx.browser.customtabs.CustomTabsSessionToken

/**
 * Minimal Custom Tabs provider. Apps that show links in a Custom Tab look for the default
 * browser's provider; by answering, Linkwache receives those links in [CheckActivity]
 * instead of being skipped. Nothing is ever prefetched or warmed up for an unchecked link.
 */
class TabsService : CustomTabsService() {
    override fun warmup(flags: Long) = true
    override fun newSession(sessionToken: CustomTabsSessionToken) = true
    override fun mayLaunchUrl(sessionToken: CustomTabsSessionToken, url: Uri?, extras: Bundle?, otherLikelyBundles: MutableList<Bundle>?) = true
    override fun extraCommand(commandName: String, args: Bundle?): Bundle? = null
    override fun updateVisuals(sessionToken: CustomTabsSessionToken, bundle: Bundle?) = false
    override fun requestPostMessageChannel(sessionToken: CustomTabsSessionToken, postMessageOrigin: Uri) = false
    override fun postMessage(sessionToken: CustomTabsSessionToken, message: String, extras: Bundle?) = RESULT_FAILURE_DISALLOWED
    override fun validateRelationship(sessionToken: CustomTabsSessionToken, relation: Int, origin: Uri, extras: Bundle?) = false
    override fun receiveFile(sessionToken: CustomTabsSessionToken, uri: Uri, purpose: Int, extras: Bundle?) = false
    override fun cleanUpSession(sessionToken: CustomTabsSessionToken) = true
}
