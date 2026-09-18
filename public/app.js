// Startseite: einfügen → /api/check → Karte anzeigen → Sandbox-Bild nachladen.
(function () {
  const LW = window.LW || { lang: "de", s: {} };
  const S = LW.s || {};
  const form = document.getElementById("form");
  const out = document.getElementById("out");
  const ta = document.getElementById("url");
  const go = document.getElementById("go");
  const pasteBtn = document.getElementById("pastebtn");
  let pollTimer = null;

  // Sprache merken: gewählte Sprache (?lang=) bleibt beim nächsten Besuch.
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("lang")) localStorage.setItem("lw_lang", q.get("lang"));
    else { const saved = localStorage.getItem("lw_lang"); if (saved && saved !== LW.lang && form) { q.set("lang", saved); location.replace(location.pathname + "?" + q.toString() + location.hash); return; } }
  } catch { /* egal */ }

  // Von „Teilen“ (Android) oder Kurzbefehl (iPhone): /?u=<link> prüft sofort.
  const u = new URLSearchParams(location.search).get("u");
  if (u && ta) { ta.value = u; history.replaceState(null, "", "/?lang=" + LW.lang); check(u); }

  if (pasteBtn) pasteBtn.addEventListener("click", async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { ta.value = t; check(t); } }
    catch { ta.focus(); showError(S.clip || "Clipboard blocked"); }
  });

  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); check(ta.value); });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const inp = document.querySelector(b.dataset.copy);
    if (!inp) return;
    navigator.clipboard.writeText(inp.value).then(() => { b.textContent = S.copied || "✓"; setTimeout(() => (b.textContent = S.copy || "Copy"), 1800); }).catch(() => { inp.select(); });
  });

  function showError(msg) {
    out.hidden = false;
    out.innerHTML = '<div class="error">' + esc(msg) + "</div>";
  }

  async function check(text) {
    if (!text || !text.trim()) { ta.focus(); return; }
    clearTimeout(pollTimer);
    go.disabled = true; go.textContent = S.checking || "…";
    out.hidden = false;
    out.innerHTML = '<div class="pending">' + esc(S.wait || "…") + "</div>";
    try {
      const r = await fetch("/api/check?lang=" + LW.lang, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: text, lang: LW.lang }) });
      const j = await r.json();
      if (!r.ok || j.error) { showError(j.error || S.fail || "Error"); return; }
      render(j);
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      showError(S.net || "Offline");
    } finally {
      go.disabled = false; go.textContent = S.check || "Check";
    }
  }

  function render(j) {
    out.innerHTML = j.html;
    if (j.scan && j.scan.status === "pending") poll(j.id, 0);
  }

  function poll(id, n) {
    if (n > 12) return;
    pollTimer = setTimeout(async () => {
      try {
        const r = await fetch("/api/result/" + id + "?lang=" + LW.lang);
        const j = await r.json();
        if (j.scan && j.scan.status === "pending") return poll(id, n + 1);
        out.innerHTML = j.html;
      } catch { poll(id, n + 1); }
    }, n < 3 ? 6000 : 10000);
  }

  // Ergebnisseite (/r/…) mit noch laufender Sandbox: ebenfalls nachladen.
  const pend = document.querySelector(".result .pending[data-poll]");
  if (pend && !form) {
    const id = pend.dataset.poll;
    const res = document.querySelector(".result");
    (function p2(n) {
      if (n > 12) return;
      setTimeout(async () => {
        try { const j = await (await fetch("/api/result/" + id + "?lang=" + LW.lang)).json(); if (j.scan && j.scan.status === "pending") return p2(n + 1); res.innerHTML = j.html; }
        catch { p2(n + 1); }
      }, n < 3 ? 6000 : 10000);
    })(0);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();
