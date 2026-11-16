package app.linkwache.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Linkwache family design: violet accent on a deep ink ground (dark) or a lilac-white ground (light). */
@Immutable
data class Signal(val ok: Color, val warn: Color, val crit: Color, val grey: Color, val okBg: Color, val warnBg: Color, val critBg: Color, val greyBg: Color)

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFFA78BFA), onPrimary = Color(0xFF1C1038),
    primaryContainer = Color(0xFF3A2C6E), onPrimaryContainer = Color(0xFFE9E1FF),
    secondary = Color(0xFF60A5FA), onSecondary = Color(0xFF0B1B33),
    secondaryContainer = Color(0xFF2A2350), onSecondaryContainer = Color(0xFFE6E1FA),
    background = Color(0xFF15112B), onBackground = Color(0xFFEFEDFA),
    surface = Color(0xFF1B1636), onSurface = Color(0xFFEFEDFA),
    surfaceVariant = Color(0xFF272146), onSurfaceVariant = Color(0xFFA7A3C4),
    surfaceContainerLowest = Color(0xFF120E25), surfaceContainerLow = Color(0xFF1B1636),
    surfaceContainer = Color(0xFF211B3F), surfaceContainerHigh = Color(0xFF282149), surfaceContainerHighest = Color(0xFF302852),
    outline = Color(0xFF4A436E), outlineVariant = Color(0xFF332C55),
    error = Color(0xFFF87171), onError = Color(0xFF3A0A0A), errorContainer = Color(0xFF5A1D24), onErrorContainer = Color(0xFFFFDAD8),
)

private val LightScheme: ColorScheme = lightColorScheme(
    primary = Color(0xFF6D4FD6), onPrimary = Color.White,
    primaryContainer = Color(0xFFE6DEFF), onPrimaryContainer = Color(0xFF22125A),
    secondary = Color(0xFF2F7FE0), onSecondary = Color.White,
    secondaryContainer = Color(0xFFECE6FB), onSecondaryContainer = Color(0xFF1D1838),
    background = Color(0xFFF4F1FC), onBackground = Color(0xFF1D1838),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF1D1838),
    surfaceVariant = Color(0xFFEEEAF8), onSurfaceVariant = Color(0xFF5F5A80),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFFBFAFE),
    surfaceContainer = Color(0xFFF6F3FD), surfaceContainerHigh = Color(0xFFF0ECFA), surfaceContainerHighest = Color(0xFFE9E4F7),
    outline = Color(0xFFB9B2D6), outlineVariant = Color(0xFFDDD7EE),
    error = Color(0xFFD24A4A), onError = Color.White, errorContainer = Color(0xFFFDE3E3), onErrorContainer = Color(0xFF5A1414),
)

private val DarkSignal = Signal(
    ok = Color(0xFF34D399), warn = Color(0xFFFBBF24), crit = Color(0xFFF87171), grey = Color(0xFFA7A3C4),
    okBg = Color(0x2234D399), warnBg = Color(0x22FBBF24), critBg = Color(0x22F87171), greyBg = Color(0x22A7A3C4),
)
private val LightSignal = Signal(
    ok = Color(0xFF1F9E6A), warn = Color(0xFFB7791F), crit = Color(0xFFD24A4A), grey = Color(0xFF5F5A80),
    okBg = Color(0x1A1F9E6A), warnBg = Color(0x1FB7791F), critBg = Color(0x1AD24A4A), greyBg = Color(0x1A5F5A80),
)

val LocalSignal = staticCompositionLocalOf { DarkSignal }

private val Type = Typography().let { t ->
    t.copy(
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 27.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = t.labelLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    )
}

@Composable
fun LinkwacheTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalSignal provides if (dark) DarkSignal else LightSignal) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, typography = Type, content = content)
    }
}
