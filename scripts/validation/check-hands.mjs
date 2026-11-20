import { samplesSubhi, samplesRps, score } from "./eval-hands.mjs"; import { make } from "./tune-hands.mjs"; import { pct, ci } from "./lib/stats.mjs";
const sets = { "HandsDataset test (held out)": samplesSubhi("test"), "Google RPS (held out)": samplesRps() };
for (const [n, s] of Object.entries(sets)) for (const [lab, clf] of [["current 75/30", undefined], ["three only", make(75, 30, { "0111": "Three fingers extended" })], ["proposed 80/60+0111", make(80, 60, { "0111": "Three fingers extended" })], ["80/69", make(80, 69, { "0111": "Three fingers extended" })]]) {
  const r = score(s, clf); console.log(n.padEnd(30), lab.padEnd(22), "acc", pct(r.accuracyAll), `[${ci(r.accAllCI)}]`, "wrong", pct(r.wrongRate), `[${ci(r.wrongCI)}]`, "prec", pct(r.precisionDecided));
}
