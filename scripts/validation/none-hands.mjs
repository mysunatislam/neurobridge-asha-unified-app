import { samplesRps } from "./eval-hands.mjs"; import { make } from "./tune-hands.mjs"; import { fingers, toLm } from "./lib/asha.mjs"; import { pct, ci, wilson } from "./lib/stats.mjs";
const none = samplesRps().filter((s) => s.truth === "none" && s.hands.length);
const LAB = ["Closed fingers", "Index extended", "Two fingers extended", "Three fingers extended", "Open palm"];
for (const [n, clf] of [["before 75/30", make(75, 30)], ["after (repo)", (lm) => fingers.classifyPose(lm).name]]) {
  const named = none.map((s) => clf(toLm(s.hands[0].lm))).filter((p) => LAB.includes(p));
  const by = {}; named.forEach((p) => (by[p] = (by[p] || 0) + 1));
  console.log(n, `named a pose on ${named.length}/${none.length} 'none' hands = ${pct(named.length / none.length)} [${ci(wilson(named.length, none.length))}]`, JSON.stringify(by));
}
