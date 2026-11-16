package app.linkwache.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.linkwache.android.Browsers
import app.linkwache.android.Prefs
import app.linkwache.android.R
import app.linkwache.android.Texts
import app.linkwache.core.Scope
import app.linkwache.core.UpdateInfo
import java.text.DateFormat
import java.util.Date

/** State of the main screen; the activity fills it and receives the actions. */
@Stable
class HomeModel(val host: Host) {
    interface Host {
        fun requestDefault()
        fun openDefaultSettings()
        fun chooseBrowser(pkg: String)
        fun setServer(s: String): Boolean
        fun resetServer()
        fun testServer(s: String)
        fun setScope(s: Scope)
        fun setPaused(minutes: Int)
        fun addAllowed(input: String): Boolean
        fun removeAllowed(domain: String)
        fun clearHistory()
        fun resetInstallId()
        fun setUpdateAuto(on: Boolean)
        fun checkUpdate(manual: Boolean)
        fun installUpdate(info: UpdateInfo)
        fun dismissUpdate()
        fun finishSetup()
        fun tryTestLink()
        fun openUrl(url: String)
        fun privacyUrl(): String?
    }

    sealed interface ServerTest {
        data object Idle : ServerTest
        data object Testing : ServerTest
        data object Invalid : ServerTest
        data object Fail : ServerTest
        data class Ok(val version: String) : ServerTest
    }

    var setupDone by mutableStateOf(true)
    /** 0 = home; 1..SETUP_STEPS = assistant step. */
    var setupStep by mutableIntStateOf(0)
    var isDefault by mutableStateOf(false)
    var browsers by mutableStateOf(listOf<Browsers.App>())
    var systemDefault by mutableStateOf<String?>(null)
    var forward by mutableStateOf<String?>(null)
    var server by mutableStateOf("")
    var serverIsPreset by mutableStateOf(false)
    var serverTest by mutableStateOf<ServerTest>(ServerTest.Idle)
    var scope by mutableStateOf(Scope.URL)
    var pausedUntil by mutableLongStateOf(0L)
    var allowlist by mutableStateOf(listOf<String>())
    var history by mutableStateOf(listOf<Prefs.HistoryEntry>())
    var updateAuto by mutableStateOf(true)
    var update by mutableStateOf<UpdateInfo?>(null)
    var updateBusy by mutableStateOf<String?>(null)
    var updateMessage by mutableStateOf<String?>(null)
    var canInstall by mutableStateOf(false)
    var installId by mutableStateOf("")
    var version by mutableStateOf("")

    val paused get() = pausedUntil > System.currentTimeMillis()
}

const val SETUP_STEPS = 5

@Composable
private fun t(key: String, vararg p: Pair<String, Any?>): String = Texts.get(LocalContext.current, key, *p)

@Composable
fun MainScreen(m: HomeModel) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (m.setupStep > 0) SetupFlow(m) else Home(m)
    }
}

// ── Setup assistant ─────────────────────────────────────────────────────────────

@Composable
private fun SetupFlow(m: HomeModel) {
    val step = m.setupStep
    Column(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier
                .widthIn(max = 600.dp)
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BrandMark(40)
                Spacer(Modifier.size(12.dp))
                Column {
                    Text(t("setup.title"), style = MaterialTheme.typography.titleMedium)
                    Text(t("setup.step", "n" to step, "total" to SETUP_STEPS), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { step / SETUP_STEPS.toFloat() },
                modifier = Modifier.fillMaxWidth().height(4.dp),
                drawStopIndicator = {},
            )
            Spacer(Modifier.height(28.dp))
            when (step) {
                1 -> StepWelcome()
                2 -> StepServer(m)
                3 -> StepBrowser(m)
                4 -> StepDefault(m)
                else -> StepDone(m)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            Modifier.widthIn(max = 600.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (step > 1) TextButton(onClick = { m.setupStep = step - 1 }, modifier = Modifier.testTag("setup-back")) { Text(t("btn.back")) }
            Spacer(Modifier.weight(1f))
            val canNext = when (step) {
                2 -> m.server.isNotEmpty()
                3 -> m.forward != null
                else -> true
            }
            Button(
                onClick = { if (step >= SETUP_STEPS) m.host.finishSetup() else m.setupStep = step + 1 },
                enabled = canNext,
                modifier = Modifier.heightIn(min = 48.dp).testTag("setup-next"),
                contentPadding = PaddingValues(horizontal = 28.dp),
            ) { Text(if (step >= SETUP_STEPS) t("btn.finish") else t("btn.next")) }
        }
    }
}

@Composable
private fun StepTitle(h: String, p: String) {
    Text(h, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("setup-title"))
    Spacer(Modifier.height(10.dp))
    Text(p, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun StepWelcome() {
    StepTitle(t("setup.welcome.h"), t("setup.welcome.p"))
    val sig = LocalSignal.current
    SectionCard {
        LegendRow(sig.ok, t("lvl.gruen"), t("android.legend.gruen"))
        Spacer(Modifier.height(14.dp))
        LegendRow(sig.warn, t("lvl.gelb"), t("android.legend.gelb"))
        Spacer(Modifier.height(14.dp))
        LegendRow(sig.crit, t("lvl.rot"), t("android.legend.rot"))
        Spacer(Modifier.height(14.dp))
        LegendRow(sig.grey, t("lvl.offline"), t("android.legend.offline"))
    }
    Spacer(Modifier.height(16.dp))
    Text(t("warn.footer"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun LegendRow(c: Color, title: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(14.dp).background(c, CircleShape))
        Spacer(Modifier.size(14.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun StepServer(m: HomeModel) {
    StepTitle(t("setup.server.h"), t("setup.server.p"))
    ServerEditor(m)
    if (m.serverIsPreset) {
        Spacer(Modifier.height(12.dp))
        Text(t("android.setup.server.default"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ServerEditor(m: HomeModel) {
    var text by remember(m.server) { mutableStateOf(m.server) }
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            m.serverTest = HomeModel.ServerTest.Idle
        },
        label = { Text(t("setup.server.label")) },
        singleLine = true,
        placeholder = { Text("https://example.org") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth().testTag("server-field"),
    )
    Spacer(Modifier.height(10.dp))
    FilledTonalButton(onClick = {
        if (m.host.setServer(text)) m.host.testServer(text) else m.serverTest = HomeModel.ServerTest.Invalid
    }) { Text(t("setup.server.test")) }
    if (!m.serverIsPreset && m.server.isNotEmpty()) {
        TextButton(onClick = { m.host.resetServer() }, contentPadding = PaddingValues(horizontal = 4.dp)) { Text(t("android.set.server.reset")) }
    }
    val sig = LocalSignal.current
    when (val s = m.serverTest) {
        HomeModel.ServerTest.Idle -> {}
        HomeModel.ServerTest.Testing -> Note(t("setup.server.testing"), MaterialTheme.colorScheme.onSurfaceVariant)
        HomeModel.ServerTest.Invalid -> Note(t("setup.server.invalid"), sig.crit)
        HomeModel.ServerTest.Fail -> Note(t("setup.server.fail"), sig.crit)
        is HomeModel.ServerTest.Ok -> Note(t("setup.server.ok", "v" to s.version), sig.ok)
    }
}

@Composable
private fun Note(text: String, c: Color) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = c, modifier = Modifier.padding(top = 8.dp).testTag("note"))
}

@Composable
private fun StepBrowser(m: HomeModel) {
    StepTitle(t("setup.browser.h"), t("android.setup.browser.p"))
    BrowserList(m)
}

@Composable
private fun BrowserList(m: HomeModel) {
    if (m.browsers.isEmpty()) {
        Text(t("setup.browser.none"), color = LocalSignal.current.crit)
        return
    }
    SectionCard {
        m.browsers.forEachIndexed { i, app ->
            if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            BrowserRow(app, selected = app.pkg == m.forward, note = if (app.pkg == m.systemDefault) t("setup.browser.current") else null) {
                m.host.chooseBrowser(app.pkg)
            }
        }
    }
}

@Composable
private fun StepDefault(m: HomeModel) {
    StepTitle(t("setup.default.h"), t("android.setup.default.p"))
    DefaultStatus(m, big = true)
    Spacer(Modifier.height(16.dp))
    if (!m.isDefault) {
        Button(onClick = { m.host.requestDefault() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("btn-make-default")) {
            Text(t("setup.default.btn"))
        }
        Spacer(Modifier.height(16.dp))
        Text(t("android.setup.default.settings.p"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { m.host.openDefaultSettings() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(t("android.setup.default.settings"))
        }
        Spacer(Modifier.height(10.dp))
        Text(t("android.setup.default.check"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DefaultStatus(m: HomeModel, big: Boolean) {
    val sig = LocalSignal.current
    val (c, bg, text) = if (m.isDefault) Triple(sig.ok, sig.okBg, if (big) t("setup.default.ok") else t("set.default.yes"))
    else Triple(sig.warn, sig.warnBg, if (big) t("setup.default.fail") else t("set.default.no"))
    Row(
        Modifier.fillMaxWidth().background(bg, RoundedCornerShape(16.dp)).padding(16.dp).testTag(if (m.isDefault) "default-yes" else "default-no"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (m.isDefault) Icons.Filled.Check else Icons.Filled.Warning, null, tint = c)
        Spacer(Modifier.size(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun StepDone(m: HomeModel) {
    StepTitle(t("setup.done.h"), t("android.setup.done.p"))
    DefaultStatus(m, big = false)
    Spacer(Modifier.height(16.dp))
    FilledTonalButton(onClick = { m.host.tryTestLink() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
        Text(t("android.setup.test"))
    }
    Spacer(Modifier.height(20.dp))
    LimitsCard()
}

// ── Home ────────────────────────────────────────────────────────────────────────

@Composable
fun BrandMark(sizeDp: Int) {
    Box(
        Modifier.size(sizeDp.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape((sizeDp * 0.28f).dp)),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painterResource(R.drawable.ic_shield), null, Modifier.size((sizeDp * 0.62f).dp),
            colorFilter = ColorFilter.tint(MaterialTheme.colorScheme.onPrimary),
        )
    }
}

@Composable
private fun Home(m: HomeModel) {
    LazyColumn(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).testTag("home"),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val w = Modifier.widthIn(max = 640.dp).fillMaxWidth()
        item {
            Row(w.padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                BrandMark(48)
                Spacer(Modifier.size(14.dp))
                Column {
                    Text(t("app.name"), style = MaterialTheme.typography.headlineSmall)
                    Text(t("app.tagline"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        m.update?.let { u -> item { UpdateCard(m, u, w) } }
        item { StatusCard(m, w) }
        item { BrowserCard(m, w) }
        item { HistoryCard(m, w) }
        item { AllowCard(m, w) }
        item { PrivacyCard(m, w) }
        item { SectionCard(w) { CardTitle(t("setup.server.h")); ServerEditor(m) } }
        item { UpdatesCard(m, w) }
        item { LimitsCard(w) }
        item { AboutCard(m, w) }
        item { Spacer(Modifier.windowInsetsPadding(WindowInsets.navigationBars)) }
    }
}

@Composable
private fun CardTitle(s: String) {
    Text(s, style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun UpdateCard(m: HomeModel, u: UpdateInfo, modifier: Modifier) {
    Surface(modifier.testTag("update-card"), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.padding(20.dp)) {
            Text(t("android.upd.notice", "v" to u.version), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.height(4.dp))
            Text(t("set.upd.version", "v" to m.version), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            if (!m.canInstall) {
                Spacer(Modifier.height(8.dp))
                Text(t("android.upd.permission.p"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            m.updateBusy?.let {
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                Text(t(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            m.updateMessage?.let {
                Spacer(Modifier.height(8.dp))
                Text(t(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.testTag("update-message"))
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { m.host.installUpdate(u) }, enabled = m.updateBusy == null, modifier = Modifier.weight(1f, fill = false).testTag("btn-update")) {
                    Text(if (m.canInstall) t("android.upd.install") else t("android.upd.permission"), maxLines = 2)
                }
                Spacer(Modifier.size(8.dp))
                TextButton(onClick = { m.host.dismissUpdate() }) { Text(t("android.upd.later")) }
            }
        }
    }
}

@Composable
private fun StatusCard(m: HomeModel, modifier: Modifier) {
    SectionCard(modifier.testTag("status-card")) {
        CardTitle(t("android.home.title"))
        if (m.paused) {
            val sig = LocalSignal.current
            Row(Modifier.fillMaxWidth().background(sig.warnBg, RoundedCornerShape(16.dp)).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, null, tint = sig.warn)
                Spacer(Modifier.size(12.dp))
                Text(t("android.paused.banner"), style = MaterialTheme.typography.bodyLarge)
            }
        } else {
            DefaultStatus(m, big = false)
        }
        if (!m.isDefault) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = { m.host.requestDefault() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("btn-make-default")) {
                Text(t("setup.default.btn"))
            }
        }
        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(t("set.pause.h"), style = MaterialTheme.typography.titleSmall)
                val timeText = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(m.pausedUntil))
                Text(
                    if (m.paused) t("set.paused", "time" to timeText) else t("set.active"),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = !m.paused, onCheckedChange = { on -> m.host.setPaused(if (on) 0 else 15) }, modifier = Modifier.testTag("switch-active"))
        }
        Text(t("set.pause.p") + " " + t("tray.pause") + ".", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun BrowserCard(m: HomeModel, modifier: Modifier) {
    var choose by remember { mutableStateOf(false) }
    SectionCard(modifier) {
        CardTitle(t("set.forward"))
        val app = m.browsers.firstOrNull { it.pkg == m.forward }
        if (app != null) {
            BrowserRow(app, selected = true) { choose = true }
        } else {
            Text(t("toast.noforward"), color = LocalSignal.current.crit)
        }
        TextButton(onClick = { choose = true }) { Text(t("android.browser.choose")) }
    }
    if (choose) {
        AlertDialog(
            onDismissRequest = { choose = false },
            title = { Text(t("android.browser.choose")) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    for (b in m.browsers) BrowserRow(b, selected = b.pkg == m.forward, note = if (b.pkg == m.systemDefault) t("setup.browser.current") else null) {
                        m.host.chooseBrowser(b.pkg)
                        choose = false
                    }
                }
            },
            confirmButton = { TextButton(onClick = { choose = false }) { Text(t("btn.close")) } },
        )
    }
}

@Composable
private fun HistoryCard(m: HomeModel, modifier: Modifier) {
    val sig = LocalSignal.current
    SectionCard(modifier.testTag("history-card")) {
        CardTitle(t("android.home.history"))
        Text(t("set.hist.p"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        if (m.history.isEmpty()) {
            Text(t("set.hist.empty"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val fmt = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT) }
        for (h in m.history.take(8)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                val c = when (h.outcome) {
                    "gruen" -> sig.ok
                    "gelb" -> sig.warn
                    "rot" -> sig.crit
                    else -> sig.grey
                }
                Box(Modifier.size(10.dp).background(c, CircleShape))
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(h.domain, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(fmt.format(Date(h.time)) + " · " + t("act.${h.action}"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (m.history.isNotEmpty()) TextButton(onClick = { m.host.clearHistory() }) { Text(t("btn.clear")) }
    }
}

@Composable
private fun AllowCard(m: HomeModel, modifier: Modifier) {
    var text by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }
    SectionCard(modifier) {
        CardTitle(t("android.set.allow.h"))
        Text(t("set.allow.p"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = text, onValueChange = { text = it; bad = false }, singleLine = true,
                placeholder = { Text(t("set.allow.placeholder")) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.size(8.dp))
            FilledTonalButton(onClick = { if (m.host.addAllowed(text)) text = "" else bad = true }) { Text(t("btn.add")) }
        }
        if (bad) Note(t("set.allow.bad"), LocalSignal.current.crit)
        Spacer(Modifier.height(6.dp))
        if (m.allowlist.isEmpty()) Text(t("set.allow.empty"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        for (d in m.allowlist) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(d, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
                IconButton(onClick = { m.host.removeAllowed(d) }) { Icon(Icons.Filled.Close, t("btn.remove")) }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(t("set.allow.builtin"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PrivacyCard(m: HomeModel, modifier: Modifier) {
    SectionCard(modifier) {
        CardTitle(t("set.priv.scope"))
        ScopeOption(m, Scope.URL, t("set.priv.url"), t("set.priv.url.p"))
        ScopeOption(m, Scope.DOMAIN, t("set.priv.domain"), t("set.priv.domain.p"))
        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(12.dp))
        Text(t("set.priv.id"), style = MaterialTheme.typography.titleSmall)
        Text(t("set.priv.id.p"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(m.installId.chunked(8).joinToString(" "), style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.padding(vertical = 6.dp))
        TextButton(onClick = { m.host.resetInstallId() }) { Text(t("set.priv.reset")) }
        Text(t("android.set.lang.p"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ScopeOption(m: HomeModel, s: Scope, title: String, text: String) {
    Row(
        Modifier.fillMaxWidth().selectable(selected = m.scope == s, onClick = { m.host.setScope(s) }, role = Role.RadioButton).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = m.scope == s, onClick = null)
        Spacer(Modifier.size(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun UpdatesCard(m: HomeModel, modifier: Modifier) {
    SectionCard(modifier.testTag("updates-card")) {
        CardTitle(t("set.upd.version", "v" to m.version))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t("set.upd.auto"), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            Switch(checked = m.updateAuto, onCheckedChange = { m.host.setUpdateAuto(it) })
        }
        Text(t("android.upd.auto.p"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { m.host.checkUpdate(true) }, enabled = m.updateBusy == null) { Text(t("set.upd.now")) }
            Spacer(Modifier.size(12.dp))
            val msg = m.updateBusy ?: if (m.update == null) m.updateMessage else null
            msg?.let { Text(t(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f)) }
        }
    }
}

@Composable
fun LimitsCard(modifier: Modifier = Modifier) {
    SectionCard(modifier.testTag("limits-card")) {
        CardTitle(t("android.home.limits.h"))
        Text(t("android.home.limits.p"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AboutCard(m: HomeModel, modifier: Modifier) {
    SectionCard(modifier) {
        CardTitle(t("android.home.about"))
        Text("Linkwache ${m.version}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(t("warn.footer"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(6.dp))
        LinkRow(t("android.home.source")) { m.host.openUrl("https://github.com/${app.linkwache.android.BuildConfig.UPDATE_REPO}") }
        m.host.privacyUrl()?.let { url -> LinkRow(t("android.home.privacy")) { m.host.openUrl(url) } }
        LinkRow(t("set.setup")) { m.setupStep = 1 }
    }
}

@Composable
private fun LinkRow(text: String, onClick: () -> Unit) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp),
    )
}
