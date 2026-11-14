// Operator page: sign in with the access key (kept only in this tab), show update state, file the request.
(function () {
  let LW = { s: {} };
  try { LW = JSON.parse(document.getElementById("lw").textContent); } catch { /* defaults */ }
  const S = LW.adm || {};
  const $ = (id) => document.getElementById(id);
  const fill = (s, p) => Object.keys(p).reduce((a, k) => a.split("{" + k + "}").join(p[k]), s);
  let key = "";
  const call = (path, method) => fetch(path, { method, headers: { authorization: "Bearer " + key } });
  function err(m) { const e = $("adm-msg"); e.textContent = m || ""; e.hidden = !m; }
  function show(st) {
    $("adm-login").hidden = true; $("adm-box").hidden = false; err("");
    $("adm-ver").textContent = fill(S.version, { v: st.version });
    let line = S.uptodate;
    if (!st.checkEnabled) line = S.off;
    else if (st.latest) line = fill(S.avail, { v: st.latest });
    $("adm-state").textContent = line;
    $("adm-req").hidden = !st.latest || !!st.pending;
    $("adm-meta").textContent = st.pending ? fill(S.pending, { v: st.pending }) : (st.checkedAt ? fill(S.checked, { t: new Date(st.checkedAt).toLocaleString(LW.lang) }) : (st.checkEnabled ? S.never : ""));
  }
  $("adm-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    key = $("adm-token").value; $("adm-token").value = "";
    try { const r = await call("/api/admin/status", "GET"); if (!r.ok) throw 0; show(await r.json()); } catch { key = ""; err(S.bad); }
  });
  $("adm-req").addEventListener("click", async () => {
    try { const r = await call("/api/admin/update-request", "POST"); if (!r.ok) throw 0; show(await r.json()); err(""); $("adm-meta").textContent = S.requested; } catch { err(S.bad); }
  });
})();
