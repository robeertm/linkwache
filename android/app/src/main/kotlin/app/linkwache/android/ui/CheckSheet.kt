package app.linkwache.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.linkwache.android.Browsers
import app.linkwache.android.R
import app.linkwache.android.Texts
import app.linkwache.core.CheckResult
import app.linkwache.core.Finding
import app.linkwache.core.Level
import app.linkwache.core.Outcome
import app.linkwache.core.Source
import kotlinx.coroutines.delay

/** What the check sheet shows. */
sealed interface SheetState {
    data class Checking(val domain: String) : SheetState
    data class Done(val r: CheckResult, val browser: String) : SheetState
    data class NoBrowser(val apps: List<Browsers.App>, val missing: Boolean) : SheetState
    data class Message(val titleKey: String, val textKey: String) : SheetState
}

interface SheetActions {
    fun open()
    fun close()
    fun retry()
    fun choose(pkg: String)
}

/** Seconds before "Open anyway" becomes active (docs/DESKTOP.md: amber → after 3 s). */
const val OPEN_ANYWAY_DELAY_S = 3

/** Green stays visible this long before the link opens. */
const val GREEN_VISIBLE_MS = 700L

@Composable
private fun t(key: String, vararg p: Pair<String, Any?>): String = Texts.get(LocalContext.current, key, *p)

@Composable
fun CheckSheet(state: SheetState, actions: SheetActions, countdownFrom: Int = OPEN_ANYWAY_DELAY_S, revealRedStep: Boolean = false) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.38f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                // Tapping outside never opens anything; it only closes non-green sheets.
                if (state !is SheetState.Checking && !(state is SheetState.Done && state.r.outcome == Outcome.GRUEN)) actions.close()
            },
        contentAlignment = Alignment.BottomCenter,
    ) {
        var shown by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { shown = true }
        AnimatedVisibility(visible = shown, enter = slideInVertically(tween(180)) { it / 3 } + fadeIn(tween(140))) {
            Surface(
                modifier = Modifier
                    .widthIn(max = 640.dp)
                    .fillMaxWidth()
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    .testTag("sheet"),
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 2.dp,
                shadowElevation = 12.dp,
            ) {
                Column(
                    Modifier
                        .windowInsetsPadding(WindowInsets.navigationBars)
                        .padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 20.dp)
                        .animateContentSize(),
                ) {
                    Box(
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .size(width = 36.dp, height = 4.dp)
                            .background(MaterialTheme.colorScheme.outlineVariant, CircleShape),
                    )
                    Spacer(Modifier.height(16.dp))
                    when (state) {
                        is SheetState.Checking -> CheckingContent(state)
                        is SheetState.Done -> when (state.r.outcome) {
                            Outcome.GRUEN -> GreenContent(state)
                            Outcome.GELB -> WarnContent(state, actions, countdownFrom)
                            Outcome.ROT -> RedContent(state, actions, revealRedStep)
                            Outcome.OFFLINE -> OfflineContent(state, actions, countdownFrom)
                        }
                        is SheetState.NoBrowser -> NoBrowserContent(state, actions)
                        is SheetState.Message -> MessageContent(state, actions)
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(icon: @Composable () -> Unit, title: String, subtitle: String?, tint: Color, bg: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).background(bg, CircleShape), contentAlignment = Alignment.Center) {
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides tint) { icon() }
        }
        Spacer(Modifier.size(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("sheet-title"))
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag("sheet-domain"),
                )
            }
        }
    }
}

@Composable
private fun ShieldIcon(tint: Color) {
    Image(painterResource(R.drawable.ic_shield), null, Modifier.size(24.dp), colorFilter = ColorFilter.tint(tint))
}

@Composable
private fun SymbolIcon(v: ImageVector) = Icon(v, null, Modifier.size(24.dp))

@Composable
private fun CheckingContent(s: SheetState.Checking) {
    val sig = LocalSignal.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(36.dp), strokeWidth = 3.dp, color = MaterialTheme.colorScheme.primary)
            ShieldIcon(MaterialTheme.colorScheme.primary.copy(alpha = 0.85f))
        }
        Spacer(Modifier.size(14.dp))
        Column(Modifier.weight(1f)) {
            Text(t("toast.checking"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("sheet-title"))
            Text(
                s.domain, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("sheet-domain"),
            )
        }
    }
    Spacer(Modifier.height(18.dp))
    LinearProgressIndicator(Modifier.fillMaxWidth().height(4.dp), color = MaterialTheme.colorScheme.primary, trackColor = sig.greyBg)
    Spacer(Modifier.height(6.dp))
}

@Composable
private fun GreenContent(s: SheetState.Done) {
    val sig = LocalSignal.current
    val title = if (s.r.source == Source.ALLOWLIST) t("toast.allowlist") else t("toast.green")
    Header({ SymbolIcon(Icons.Filled.Check) }, title, s.r.unicodeHost, sig.ok, sig.okBg)
    Spacer(Modifier.height(16.dp))
    var go by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { go = true }
    val progress by animateFloatAsState(if (go) 1f else 0f, tween(GREEN_VISIBLE_MS.toInt(), easing = LinearEasing), label = "open")
    LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(4.dp), color = sig.ok, trackColor = sig.okBg, drawStopIndicator = {})
    Spacer(Modifier.height(10.dp))
    Text(t("android.sheet.opening", "browser" to s.browser), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun LinkLines(r: CheckResult) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (r.unwrapped) {
            Text(t("warn.target"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(r.target, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LevelChip(level: Level) {
    val sig = LocalSignal.current
    val c = when (level) {
        Level.ROT -> sig.crit
        Level.GELB -> sig.warn
        Level.GRUEN -> sig.ok
        Level.INFO -> sig.grey
    }
    Box(Modifier.padding(top = 7.dp).size(10.dp).background(c, CircleShape).testTag("lvl-${level.wire}"))
    Spacer(Modifier.size(12.dp))
}

@Composable
private fun FindingsList(findings: List<Finding>, maxHeightDp: Int = 260) {
    val ctx = LocalContext.current
    val shown = findings.filter { it.level != Level.INFO || findings.size <= 4 }.take(8)
    if (shown.isEmpty()) {
        Text(t("warn.nofindings"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    Column(
        Modifier.heightIn(max = maxHeightDp.dp).verticalScroll(rememberScrollState()).testTag("findings"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        for (f in shown) {
            Row {
                LevelChip(f.level)
                Column(Modifier.weight(1f)) {
                    Text(Texts.findingTitle(ctx, f), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                    Texts.findingText(ctx, f)?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun Countdown(from: Int, key: Any): Int {
    var left by rememberSaveable(key) { mutableIntStateOf(from) }
    LaunchedEffect(key) {
        while (left > 0) {
            delay(1000)
            left--
        }
    }
    return left
}

@Composable
private fun OpenAnywayButton(left: Int, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = left == 0,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("btn-open-anyway"),
    ) { Text(if (left > 0) t("btn.openin", "n" to left) else t("btn.openanyway")) }
}

@Composable
private fun PrimaryButton(text: String, tag: String, onClick: () -> Unit, color: Color? = null) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag(tag),
        colors = if (color != null) ButtonDefaults.buttonColors(containerColor = color) else ButtonDefaults.buttonColors(),
    ) { Text(text) }
}

@Composable
private fun Footer() {
    Spacer(Modifier.height(14.dp))
    Text(t("warn.footer"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun WarnContent(s: SheetState.Done, a: SheetActions, countdownFrom: Int) {
    val sig = LocalSignal.current
    val ctx = LocalContext.current
    Header({ SymbolIcon(Icons.Filled.Warning) }, t("warn.title.gelb"), s.r.unicodeHost, sig.warn, sig.warnBg)
    Spacer(Modifier.height(14.dp))
    VerdictBox(Texts.verdictShort(ctx, s.r), t("warn.lead.gelb"), sig.warn, sig.warnBg)
    Spacer(Modifier.height(14.dp))
    LinkLines(s.r)
    Text(t("warn.findings"), style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(10.dp))
    FindingsList(s.r.findings)
    Footer()
    Spacer(Modifier.height(18.dp))
    PrimaryButton(t("btn.dontopen"), "btn-dont-open", a::close)
    Spacer(Modifier.height(8.dp))
    OpenAnywayButton(Countdown(countdownFrom, s.r.url), a::open)
}

@Composable
private fun VerdictBox(title: String, text: String, c: Color, bg: Color) {
    Column(
        Modifier.fillMaxWidth().background(bg, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = c, modifier = Modifier.testTag("verdict"))
        Spacer(Modifier.height(4.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun RedContent(s: SheetState.Done, a: SheetActions, revealRedStep: Boolean) {
    val sig = LocalSignal.current
    val ctx = LocalContext.current
    var step by rememberSaveable(s.r.url) { mutableStateOf(revealRedStep) }
    Header({ SymbolIcon(Icons.Filled.Close) }, t("warn.title.rot"), s.r.unicodeHost, sig.crit, sig.critBg)
    Spacer(Modifier.height(14.dp))
    VerdictBox(Texts.verdictShort(ctx, s.r), t("warn.lead.rot"), sig.crit, sig.critBg)
    Spacer(Modifier.height(14.dp))
    LinkLines(s.r)
    if (!step) {
        Text(t("warn.findings"), style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(10.dp))
        FindingsList(s.r.findings)
        Text(Texts.verdictAdvice(ctx, s.r), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 14.dp))
        Spacer(Modifier.height(18.dp))
        PrimaryButton(t("btn.close"), "btn-close", a::close)
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = { step = true }, modifier = Modifier.fillMaxWidth().testTag("btn-know")) {
            Text(t("btn.know"), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(14.dp))
        Text(t("red.title"), style = MaterialTheme.typography.titleMedium, color = sig.crit)
        Spacer(Modifier.height(4.dp))
        Text(t("red.text"), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(16.dp))
        PrimaryButton(t("btn.cancel"), "btn-cancel", a::close)
        Spacer(Modifier.height(8.dp))
        val left = Countdown(OPEN_ANYWAY_DELAY_S, "red" + s.r.url)
        OutlinedButton(
            onClick = a::open, enabled = left == 0,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("btn-open-red"),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = sig.crit),
        ) { Text(if (left > 0) "${t("red.confirm")} ($left)" else t("red.confirm")) }
    }
}

@Composable
private fun OfflineContent(s: SheetState.Done, a: SheetActions, countdownFrom: Int) {
    val sig = LocalSignal.current
    Header({ SymbolIcon(Icons.Filled.Info) }, t("warn.title.offline"), s.r.unicodeHost, sig.grey, sig.greyBg)
    Spacer(Modifier.height(14.dp))
    val reason = s.r.reason ?: "network"
    VerdictBox(t("lvl.offline"), t("warn.reason.$reason"), sig.grey, sig.greyBg)
    Spacer(Modifier.height(12.dp))
    Text(t("warn.lead.offline"), style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(14.dp))
    Text(t("warn.local"), style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(10.dp))
    val local = s.r.local.findings.filter { it.level != Level.INFO }
    if (local.isEmpty()) {
        Text(t("warn.local.none"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        FindingsList(local, 180)
    }
    Spacer(Modifier.height(18.dp))
    PrimaryButton(t("btn.dontopen"), "btn-dont-open", a::close)
    Spacer(Modifier.height(8.dp))
    FilledTonalButton(onClick = a::retry, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("btn-retry")) {
        Icon(Icons.Filled.Refresh, null, Modifier.size(18.dp))
        Spacer(Modifier.size(8.dp))
        Text(t("btn.retry"))
    }
    Spacer(Modifier.height(8.dp))
    OpenAnywayButton(Countdown(countdownFrom, s.r.url + (s.r.reason ?: "")), a::open)
}

@Composable
private fun NoBrowserContent(s: SheetState.NoBrowser, a: SheetActions) {
    Header({ ShieldIcon(MaterialTheme.colorScheme.primary) }, t("android.browser.choose"), null, MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer)
    Spacer(Modifier.height(12.dp))
    Text(
        if (s.missing) t("android.browser.missing") else t("setup.browser.p"),
        style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(12.dp))
    if (s.apps.isEmpty()) {
        Text(t("setup.browser.none"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
    }
    Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
        for (app in s.apps) BrowserRow(app, selected = false) { a.choose(app.pkg) }
    }
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = a::close, modifier = Modifier.fillMaxWidth()) { Text(t("btn.cancel")) }
}

@Composable
private fun MessageContent(s: SheetState.Message, a: SheetActions) {
    val sig = LocalSignal.current
    Header({ SymbolIcon(Icons.Filled.Info) }, t(s.titleKey), null, sig.grey, sig.greyBg)
    Spacer(Modifier.height(12.dp))
    Text(t(s.textKey), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("sheet-message"))
    Spacer(Modifier.height(18.dp))
    PrimaryButton(t("btn.close"), "btn-close", a::close)
}
