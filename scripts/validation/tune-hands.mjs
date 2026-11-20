import { samplesSubhi, samplesRps, score } from "./eval-hands.mjs"; import { fingers, toLm } from "./lib/asha.mjs"; import { pct } from "./lib/stats.mjs";
const base = { "1111": "Open palm", "0000": "Closed fingers", "1000": "Index extended", "1100": "Two fingers extended", "1110": "Three fingers extended" };
export const make = (open, closed, extra = {}) => (lm) => {
  const o = fingers.classifyPose(lm).openness; const k = o.slice(1).map((v) => (v >= open ? 1 : v <= closed ? 0 : -1)).join("");
  return { ...base, ...extra }[k] || "Other hand pose";
};
const train = samplesSubhi("train"), test = samplesSubhi("test"), rps = samplesRps();
const rows = [];
for (const open of [70, 75, 80, 85]) for (const closed of [30, 40, 50, 55, 60, 65, 69]) for (const ex of [{}, { "0111": "Three fingers extended" }]) {
  if (closed >= open) continue; const r = score(train, make(open, closed, ex));
  rows.push({ open, closed, ex: Object.keys(ex).length, acc: r.accuracyAll, wrong: r.wrongRate, prec: r.precisionDecided });
}
rows.sort((a, b) => b.acc - a.acc);
for (const r of rows.slice(0, 12)) console.log(JSON.stringify(r));
console.log("current", JSON.stringify((({ accuracyAll, wrongRate }) => ({ accuracyAll, wrongRate }))(score(train))));
