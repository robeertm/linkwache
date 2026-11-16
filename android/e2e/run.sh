#!/usr/bin/env bash
# Emulator end-to-end test and screenshots for Linkwache Android (runs in CI).
# Needs: a booted emulator (adb), APK_APP, APK_APP_NEXT (same app, version 99.0.0),
# APK_FB (test browser). Writes OUT/e2e.log, OUT/requests.log, OUT/shots/*.png.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=${OUT:-android/build/e2e}
mkdir -p "$OUT/shots" "$OUT/proof"
APP=app.linkwache.android
FB=app.linkwache.fakebrowser
FAILED=0
PORT=8787
SERVER=http://10.0.2.2:$PORT

log() { echo "[e2e] $*" | tee -a "$OUT/e2e.log"; }
ok() { log "PASS: $*"; }
fail() { log "FAIL: $*"; FAILED=1; }

start_mock() {
  python3 android/e2e/mock_server.py --port $PORT --log "$OUT/requests.log" \
    --apk "$APK_APP_NEXT" --foreign-apk "$APK_FB" >>"$OUT/mock.log" 2>&1 &
  MOCK=$!
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && return 0; sleep 0.3; done
  fail "mock server did not start"
}
stop_mock() { kill "$MOCK" 2>/dev/null; wait "$MOCK" 2>/dev/null; }

config() { adb shell am broadcast -n $APP/.DebugConfigReceiver "$@" >/dev/null; }

dump() {
  local i
  for i in 1 2 3 4 5; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml && return 0
    sleep 1
  done
  return 1
}

# wait_text "<text>" <seconds>: until a node with this text (substring) is on screen.
wait_text() {
  local end=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$end" ]; do
    dump > "$OUT/ui.xml" 2>/dev/null && grep -qF "$1" "$OUT/ui.xml" && return 0
    sleep 0.5
  done
  return 1
}

# tap "<exact text>": tap the centre of the first node whose text starts with it.
tap() {
  dump > "$OUT/ui.xml" 2>/dev/null
  local xy
  xy=$(python3 - "$OUT/ui.xml" "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for n in root.iter("node"):
    if n.get("text", "").startswith(sys.argv[2]) and n.get("enabled") == "true":
        a, b, c, d = map(int, re.findall(r"\d+", n.get("bounds")))
        print((a + c) // 2, (b + d) // 2); break
PY
)
  [ -n "$xy" ] || return 1
  adb shell input tap $xy
}

opened() { adb logcat -d -s FAKEBROWSER:I | grep -F "FAKEBROWSER_OPENED $1" >/dev/null; }

wait_opened() {
  local end=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$end" ]; do opened "$1" && return 0; sleep 0.25; done
  return 1
}

view() { adb shell am start -a android.intent.action.VIEW -d "'$1'" "${@:2}" >/dev/null; }

shot() { adb exec-out screencap -p > "$1"; }

# launch_shot <file> <am start args…>: (re)start the activity without killing the process,
# wait until it is drawn; an almost empty capture (cold start still running) is retried.
launch_shot() {
  local f=$1; shift
  local i
  for i in 1 2 3 4; do
    adb shell am start -W -f 0x10008000 "$@" >/dev/null
    sleep $((2 + i))
    shot "$f"
    [ "$(stat -c%s "$f")" -gt 60000 ] && return 0
  done
  log "WARN: screenshot looks empty: $f"
}

checkms() { adb logcat -d -s Linkwache:I | grep "check outcome" | tail -1 | sed 's/.*check //'; }

home() { adb shell input keyevent KEYCODE_HOME; sleep 0.5; }

# ── Setup ────────────────────────────────────────────────────────────────────
adb install -r -t "$APK_FB" >/dev/null && adb install -r -t "$APK_APP" >/dev/null || { fail "install"; exit 1; }
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1000 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
adb shell cmd locale set-app-locales $APP --locales en-US >/dev/null 2>&1 || true
start_mock
adb shell appops set $APP REQUEST_INSTALL_PACKAGES allow

# The role service of a freshly booted emulator sometimes times out (TimeoutException): try a few times.
for i in 1 2 3 4 5 6; do
  adb shell cmd role add-role-holder android.app.role.BROWSER $APP 0 >/dev/null 2>&1 || true
  adb shell cmd role get-role-holders android.app.role.BROWSER 2>/dev/null | grep -q $APP && break
  sleep 5
done
if adb shell cmd role get-role-holders android.app.role.BROWSER | grep -q $APP; then ok "Linkwache holds the browser role"; else fail "browser role"; fi
config --es server $SERVER --es forward $FB --ez setupDone true --ez clear true --ez updateAuto false
home

if [ "${SHOTS_ONLY:-0}" != 1 ]; then
# ── 1. Green: opens in the real browser; query never reaches the server ──────
adb logcat -c
U="https://gruen.example/start?token=secret123#frag"
T0=$(date +%s%3N)
view "$U"
if wait_opened "https://gruen.example/start?token=secret123#frag" 15; then
  T1=$(date +%s%3N); ok "green link opened in the test browser ($((T1 - T0)) ms incl. 700 ms display; $(checkms))"
else fail "green link not opened"; fi
if grep -q '"url": "https://gruen.example/start"' "$OUT/requests.log" && ! grep -q secret123 "$OUT/requests.log"; then
  ok "server received the link without query string and fragment"
else fail "privacy reduction"; fi
grep -q '"client": "android/' "$OUT/requests.log" && grep -q '"origin": null' "$OUT/requests.log" && ok "client header set, no Origin header" || fail "headers"
home

# ── 2. Red (local heuristics): blocked, nothing opens ────────────────────────
adb logcat -c
view "https://paypal.com.secure-login.example/konto"
if wait_text "Dangerous link – blocked" 10; then ok "red link blocked (local)"; shot "$OUT/proof/e2e-red-local.png"; else fail "red local sheet"; fi
sleep 2; opened "https://paypal.com.secure-login.example" && fail "red link was opened" || ok "red link not opened"
adb shell input keyevent KEYCODE_BACK; home

# ── 3. Red (server verdict) and the deliberate second step ──────────────────
adb logcat -c
view "https://rot.example/login"
if wait_text "Dangerous link – blocked" 10; then ok "red link blocked (server)"; else fail "red server sheet"; fi
tap "I know what I am doing" && wait_text "Open a dangerous link?" 5 && ok "second step shown" || fail "second step"
sleep 4; tap "Open dangerous link" && wait_opened "https://rot.example/login" 8 && ok "red opens only after the deliberate second step" || fail "red second step open"
home

# ── 4. Amber: warning, "Open anyway" only after 3 s ─────────────────────────
adb logcat -c
view "https://gelb.example/angebot"
if wait_text "Suspicious link" 10; then ok "amber warning shown"; shot "$OUT/proof/e2e-amber.png"; else fail "amber sheet"; fi
opened "https://gelb.example" && fail "amber opened without asking" || ok "amber waits for the user"
sleep 4
tap "Open anyway" && wait_opened "https://gelb.example/angebot" 8 && ok "amber opened after 'Open anyway'" || fail "amber open anyway"
home

# ── 5. Allowlist: no server call ────────────────────────────────────────────
adb logcat -c
before=$(wc -l < "$OUT/requests.log")
view "https://de.wikipedia.org/wiki/Phishing"
wait_opened "https://de.wikipedia.org/wiki/Phishing" 10 && ok "allowlisted site opened ($(checkms))" || fail "allowlist open"
[ "$(wc -l < "$OUT/requests.log")" = "$before" ] && ok "allowlisted site not sent to the server" || fail "allowlist server call"
home

# ── 6. Share → Linkwache ────────────────────────────────────────────────────
adb logcat -c
adb shell am start -n $APP/.CheckActivity -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'Your parcel: https://gruen.example/share today'" >/dev/null
wait_opened "https://gruen.example/share" 10 && ok "shared text checked and opened" || fail "share"
home

# ── 7. Custom Tab request is forwarded as a Custom Tab ──────────────────────
adb logcat -c
view "https://gruen.example/tab" --es android.support.customtabs.extra.SESSION x
if wait_opened "https://gruen.example/tab" 10 && adb logcat -d -s FAKEBROWSER:I | grep -q "gruen.example/tab customtab=true"; then
  ok "custom tab link checked and forwarded as custom tab"; else fail "custom tab"; fi
home

# ── 8. Server down: "Could not be checked", nothing opens ───────────────────
stop_mock
adb logcat -c
view "https://offline-test.example/"
if wait_text "Could not be checked" 12; then ok "offline: could not be checked"; shot "$OUT/proof/e2e-offline.png"; else fail "offline sheet"; fi
sleep 2; opened "https://offline-test.example" && fail "offline link opened silently" || ok "offline link not opened silently"
adb shell input keyevent KEYCODE_BACK; home

# ── 9. Updater: checksum, signer, then the system installer ─────────────────
start_mock
adb shell appops set $APP REQUEST_INSTALL_PACKAGES allow
update_case() {  # $1 mode, $2 expected text
  config --ez clear true --ez updateAuto true --es updateApi "$SERVER/release/$1"
  adb shell am force-stop $APP
  adb shell am start -n $APP/.MainActivity >/dev/null
  wait_text "Update 99.0.0 available" 15 || { fail "update notice ($1)"; return; }
  tap "Download and install" || { fail "update button ($1)"; return; }
  if wait_text "$2" 30; then ok "updater $1: $2"; else fail "updater $1"; fi
}
update_case badsha "checksum mismatch"
update_case signer "not signed with the Linkwache key"
config --ez clear true --ez updateAuto true --es updateApi "$SERVER/release/good"
adb shell am force-stop $APP
adb shell am start -n $APP/.MainActivity >/dev/null
if wait_text "Update 99.0.0 available" 15; then
  ok "update notice shown"
  tap "Download and install"
  sleep 8
  focus=$(adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | tr -d '\r')
  echo "$focus" >> "$OUT/e2e.log"
  if echo "$focus" | grep -qi "packageinstaller"; then ok "verified update handed to the system installer"; shot "$OUT/proof/e2e-update-confirm.png"; else fail "installer not reached"; fi
  adb shell input keyevent KEYCODE_BACK
else fail "update notice (good)"; fi
config --ez updateAuto false --ez clear true

fi

# ── Screenshots of every state ──────────────────────────────────────────────
# Real users have animations on: switch them back on so progress indicators are drawn.
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global $k 1; done
DEV=${DEVICE:-phone}
read -r W H < <(adb shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)
scroll() { adb shell input swipe $((W / 2)) $((H * 4 / 5)) $((W / 2)) $((H / 5)) 600; sleep 0.8; }
config --es server $SERVER --es forward $FB --ez setupDone true --ez demoHistory true --es allow "example.net" --ez updateAuto false
shots() {  # $1 = theme (light|dark), $2 = lang
  local d="$OUT/shots/$2"; mkdir -p "$d"
  for s in checking green gelb rot rot2 offline; do
    launch_shot "$d/$DEV-$1-sheet-$s.png" -n $APP/.DemoActivity --es state $s
  done
  for step in 1 2 3 4 5; do
    launch_shot "$d/$DEV-$1-setup-$step.png" -n $APP/.MainActivity --ei step $step
  done
  config --ez clear true --ez demoHistory true --ez updateAuto true --es updateApi "$SERVER/release/good"
  launch_shot "$d/$DEV-$1-home-update.png" -n $APP/.MainActivity
  sleep 3; shot "$d/$DEV-$1-home-update.png"
  config --ez updateAuto false
  launch_shot "$d/$DEV-$1-home-top.png" -n $APP/.MainActivity
  scroll; scroll
  shot "$d/$DEV-$1-home-settings.png"
  scroll; scroll; scroll
  shot "$d/$DEV-$1-home-bottom.png"
  config --ez clear true --ez demoHistory true --ez updateAuto false
}
for lang in en de; do
  adb shell cmd locale set-app-locales $APP --locales $lang >/dev/null 2>&1 || true
  for theme in light dark; do
    if [ $theme = dark ]; then adb shell cmd uimode night yes >/dev/null; else adb shell cmd uimode night no >/dev/null; fi
    shots $theme $lang
  done
done
adb shell cmd uimode night no >/dev/null


# ── Release build (minified) smoke test ─────────────────────────────────────
if [ "${SHOTS_ONLY:-0}" != 1 ] && [ -n "${APK_RELEASE:-}" ] && [ -f "$APK_RELEASE" ]; then
  adb uninstall $APP >/dev/null
  if adb install -r "$APK_RELEASE" >/dev/null; then
    adb shell cmd role add-role-holder android.app.role.BROWSER $APP 0
    adb logcat -c
    view "https://example.com/"
    if wait_text "Choose browser" 15; then
      ok "release build: sheet and texts render (asks for the real browser first)"
      tap "Test browser"
      end=$(( $(date +%s) + 15 )); res=""
      while [ "$(date +%s)" -lt "$end" ]; do
        if opened "https://example.com/"; then res="opened after a check against the preset server"; break; fi
        if dump > "$OUT/ui.xml" 2>/dev/null && grep -qE "Could not be checked|Suspicious link|Dangerous link" "$OUT/ui.xml"; then res="sheet: $(grep -oE 'Could not be checked|Suspicious link|Dangerous link' "$OUT/ui.xml" | head -1)"; break; fi
        sleep 0.5
      done
      [ -n "$res" ] && ok "release build: $res ($(checkms))" || fail "release build: no result"
      # The release build must use the preset from the repository variable (host never in the repository).
      if [ -n "${EXPECTED_SERVER:-}" ]; then
        want=$(printf '%s' "$EXPECTED_SERVER" | sed -E 's#^https?://##; s#[/:].*$##' | tr -d '\n' | sha256sum | cut -c1-12)
        line=$(adb logcat -d -s Linkwache:I | grep "check outcome" | tail -1)
        if printf '%s' "$line" | grep -q "server=$want" && printf '%s' "$line" | grep -q "outcome=GRUEN source=SERVER"; then
          ok "release build: green from the preset server (repository variable, tag $want)"
        else fail "release build: expected a green server check against the preset server ($want), got: ${line##*check }"; fi
      fi
    else fail "release build: no sheet"; fi
  else fail "release build: install"; fi
fi

stop_mock
adb logcat -d -s Linkwache:I FAKEBROWSER:I > "$OUT/logcat.txt" 2>/dev/null
log "screenshots: $(find "$OUT/shots" -name '*.png' | wc -l)"
if [ $FAILED -eq 0 ]; then log "E2E: ALL PASSED"; else log "E2E: FAILURES"; fi
exit $FAILED
