// Aus Befunden wird ein Urteil in einfachem Deutsch. Drei Stufen — und nie das
// Wort „sicher“: die Linkwache findet Warnzeichen, sie beweist keine Unschuld.
//
//   rot   = mindestens ein klares Warnzeichen → nicht öffnen
//   gelb  = auffällig → nur öffnen, wenn du den Absender wirklich kennst und
//           die Adresse erwartest
//   gruen = keine Warnzeichen gefunden (kein Freispruch)

const WEIGHT = { rot: 10, gelb: 3, info: 0, gruen: -2 };

// Bekannte Maschen: Kombinationen, die zusammen mehr sagen als jeder Befund allein.
const PATTERNS = [
  {
    key: "vote",
    when: (keys, ctx) => keys.has("age-fresh") && /vot|abstimm|poll|contest|wettbewerb|dance|tanz|ballet/i.test(ctx.url),
  },
  {
    key: "parcel",
    when: (keys, ctx) => (keys.has("brand-sub") || keys.has("brand-typo") || keys.has("age-fresh")) && /dhl|dpd|hermes|ups|fedex|paket|zustell|zoll|customs|post/i.test(ctx.url),
  },
  {
    key: "bank",
    when: (keys, ctx) => (keys.has("brand-sub") || keys.has("brand-typo")) && /bank|sparkasse|paypal|volksbank|postbank|dkb|n26|ing|comdirect|klarna|tan|login|konto/i.test(ctx.url),
  },
];

export function verdict(findings, ctx = {}) {
  const keys = new Set(findings.map((f) => f.key));
  const extra = [];
  for (const p of PATTERNS) {
    if (p.when(keys, ctx)) extra.push({ key: p.key, stufe: "rot", p: {}, muster: true });
  }
  const all = [...extra, ...findings];
  let score = 0;
  for (const f of all) score += WEIGHT[f.stufe] ?? 0;
  const rot = all.filter((f) => f.stufe === "rot").length;
  const gelb = all.filter((f) => f.stufe === "gelb").length;

  let stufe, kurzKey, ratKey;
  if (rot >= 1 || score >= 10) {
    stufe = "rot"; kurzKey = rot >= 2 ? "v.rot.multi" : "v.rot.one"; ratKey = "v.rot.rat";
  } else if (gelb >= 2 || score >= 5) {
    stufe = "gelb"; kurzKey = "v.gelb.multi"; ratKey = "v.gelb.multi.rat";
  } else if (gelb === 1 || score >= 2) {
    stufe = "gelb"; kurzKey = "v.gelb.one"; ratKey = "v.gelb.one.rat";
  } else {
    stufe = "gruen"; kurzKey = "v.gruen"; ratKey = "v.gruen.rat";
  }
  const order = { rot: 0, gelb: 1, info: 2, gruen: 3 };
  all.sort((a, b) => order[a.stufe] - order[b.stufe]);
  return { stufe, kurzKey, ratKey, score, findings: all };
}

export const STUFE_EMOJI = { rot: "🔴", gelb: "🟡", gruen: "🟢" };
