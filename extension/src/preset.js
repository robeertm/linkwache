// Built-in server address ("preset") and how installations follow it. Both the preset and the list of
// earlier presets come from the build (repository variables in CI), never from the source.
// `settings.serverPreset` records the preset the address was taken from: a string while the
// installation follows the preset, null once the user chose an address. Releases up to 0.5.1 stored the
// address without that field (and their extension packages had no preset at all, so the field was empty or
// typed by hand); an empty address and the build-time list of earlier presets move them.

/** "https://a.example/" -> "https://a.example"; anything else -> "". */
export function normServer(s) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.search || u.hash || u.username || u.password) return "";
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch { return ""; }
}

/** Earlier presets separated by commas, semicolons or whitespace; normalized, without the current preset. */
export function parsePresetList(s, preset = "") {
  const out = [];
  for (const item of String(s ?? "").split(/[\s,;]+/)) {
    const v = normServer(item);
    if (v && v !== preset && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Does the stored address still follow the built-in preset? An address the user entered never does. */
export function followsPreset(settings, preset, migrateFrom = []) {
  const cur = normServer(settings.server);
  if (typeof settings.serverPreset === "string" && normServer(settings.serverPreset) === cur) return true;
  // Empty: from 0.5.2 on only when the user emptied it (marker null). Up to 0.5.1 the packages had no preset, so an
  // unmarked empty address was never a choice.
  if (!cur) return settings.serverPreset === undefined;
  return (!!preset && cur === preset) || migrateFrom.includes(cur);
}

/**
 * Move settings that follow the preset to the current one (in place). Returns true when something changed.
 * Never stored yet -> the preset. Empty preset -> nothing changes.
 */
export function applyPreset(settings, preset, migrateFrom = []) {
  if (settings.server === undefined) {
    settings.server = preset;
    settings.serverPreset = preset;
    return false;
  }
  if (followsPreset(settings, preset, migrateFrom)) {
    if (!preset || (settings.server === preset && settings.serverPreset === preset)) return false;
    settings.server = preset;
    settings.serverPreset = preset;
    return true;
  }
  if (settings.serverPreset !== null) { settings.serverPreset = null; return true; }
  return false;
}

/** The address the user saved in the options: the current preset keeps following it, anything else is theirs. */
export function presetMarkFor(server, preset) {
  const v = normServer(server);
  return preset && v === preset ? preset : null;
}
