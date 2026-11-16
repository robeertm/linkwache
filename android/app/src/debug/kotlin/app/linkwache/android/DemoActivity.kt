package app.linkwache.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.linkwache.android.ui.CheckSheet
import app.linkwache.android.ui.LinkwacheTheme
import app.linkwache.android.ui.SheetActions
import app.linkwache.android.ui.SheetState
import app.linkwache.core.ApiError
import app.linkwache.core.Decision
import app.linkwache.core.Engine
import app.linkwache.core.EngineSettings
import app.linkwache.core.Finding
import app.linkwache.core.Level
import app.linkwache.core.Outcome
import app.linkwache.core.Source
import app.linkwache.core.VerdictCache

/**
 * Gallery of every check-sheet state for screenshots (debug builds only):
 * adb shell am start -n app.linkwache.android/.DemoActivity --es state gelb
 */
class DemoActivity : ComponentActivity(), SheetActions {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val which = intent.getStringExtra("state") ?: "gelb"
        val (state, reveal) = build(which)
        setContent {
            LinkwacheTheme {
                Box(Modifier.fillMaxSize()) {
                    FakeInbox()
                    CheckSheet(state, this@DemoActivity, countdownFrom = if (intent.getBooleanExtra("counting", false)) 3 else 0, revealRedStep = reveal)
                }
            }
        }
    }

    private fun prepared(url: String) =
        (Engine(EngineSettings(), { throw ApiError.Timeout }, VerdictCache()).prepare(url) as Decision.Check).prepared

    private fun build(which: String): Pair<SheetState, Boolean> {
        val browser = Browsers.label(this, lw.prefs.forwardPackage).takeIf { it != "–" } ?: "Browser"
        return when (which) {
            "checking" -> SheetState.Checking("shop.example.org") to false
            "green" -> SheetState.Done(Engine.baseResult(prepared("https://www.example.org/news")), browser) to false
            "gelb" -> {
                val p = prepared("https://cheap-deals.top/angebot")
                val r = Engine.baseResult(p).copy(
                    outcome = Outcome.GELB, source = Source.SERVER, kurzKey = "v.gelb.multi", ratKey = "v.gelb.multi.rat",
                    findings = listOf(Finding("age-young", Level.GELB, mapOf("age" to "41"))) + p.local.findings,
                )
                SheetState.Done(r, browser) to false
            }
            "rot", "rot2" -> {
                val p = prepared("https://paypal.com.secure-login.example/konto/verify")
                SheetState.Done(Engine.baseResult(p).copy(source = Source.SERVER), browser) to (which == "rot2")
            }
            "offline" -> SheetState.Done(Engine.offline(prepared("https://shop.example.org/cart"), "timeout"), browser) to false
            "nobrowser" -> SheetState.NoBrowser(Browsers.installed(this), missing = true) to false
            else -> SheetState.Message("android.refused.title", "toast.refused") to false
        }
    }

    override fun open() = Unit
    override fun close() = Unit
    override fun retry() = Unit
    override fun choose(pkg: String) = Unit
}

/** A neutral stand-in for the app the link came from (a message list). */
@Composable
private fun FakeInbox() {
    val c = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().background(c.background).windowInsetsPadding(WindowInsets.statusBars).padding(20.dp)) {
        Box(Modifier.fillMaxWidth().height(48.dp).background(c.surfaceContainerHigh, RoundedCornerShape(24.dp)))
        Spacer(Modifier.height(20.dp))
        repeat(9) { i ->
            Row(Modifier.padding(vertical = 12.dp)) {
                Box(Modifier.size(44.dp).background(if (i == 2) c.primary.copy(alpha = 0.55f) else c.surfaceContainerHighest, CircleShape))
                Spacer(Modifier.size(14.dp))
                Column(Modifier.weight(1f)) {
                    Box(Modifier.fillMaxWidth(if (i % 2 == 0) 0.55f else 0.4f).height(12.dp).background(c.onSurface.copy(alpha = 0.22f), RoundedCornerShape(6.dp)))
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth(0.85f).height(10.dp).background(c.onSurface.copy(alpha = 0.12f), RoundedCornerShape(5.dp)))
                    Spacer(Modifier.height(6.dp))
                    Box(Modifier.fillMaxWidth(0.7f).height(10.dp).background(c.onSurface.copy(alpha = 0.12f), RoundedCornerShape(5.dp)))
                }
            }
        }
    }
}

