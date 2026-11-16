package app.linkwache.fakebrowser

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.TextView

class OpenedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.dataString.orEmpty()
        val tab = intent.hasExtra("android.support.customtabs.extra.SESSION")
        Log.i("FAKEBROWSER", "FAKEBROWSER_OPENED $url customtab=$tab")
        setContentView(TextView(this).apply { text = "Opened: $url"; textSize = 20f; setPadding(48, 160, 48, 48) })
    }
}
