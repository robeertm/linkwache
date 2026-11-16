// Check toast: "Linkwache is checking … <domain>", then "No warning signs – opening".
"use strict";
(async () => {
  await LW.boot();
  const LABELS = {
    checking: "dt.toast.checking", green: "dt.toast.green", allowlist: "dt.toast.allowlist",
    refused: "dt.toast.refused", noforward: "dt.toast.noforward",
  };
  let seq = -1;
  function render(s) {
    if (!s || s.seq < seq) return;
    seq = s.seq;
    if (s.lang) LW.setLang(s.lang);
    document.body.dataset.state = s.state;
    document.getElementById("label").textContent = LW.t(LABELS[s.state] || LABELS.checking);
    document.getElementById("domain").textContent = s.domain || "";
    const host = s.host && s.host !== s.domain ? s.host : "";
    document.getElementById("host").textContent = host;
  }
  LW.listen("toast", render);
  try { render(await LW.invoke("toast_state")); } catch { /* preview */ }
})();
