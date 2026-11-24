import { samplesSubhi, samplesRps, score } from "./eval-hands.mjs"; import { make } from "./tune-hands.mjs"; import { fingers } from "./lib/asha.mjs"; import { pct, ci } from "./lib/stats.mjs";
const before = make(75, 30), after = (lm) => fingers.classifyPose(lm).name;
for (const [n, s] of [["HandsDataset test (held out)", samplesSubhi("test")], ["Google RPS sample (held out)", samplesRps()], ["HandsDataset train (tuning set)", samplesSubhi("train")]]) {
  const b = score(s, before), a = score(s, after);
  console.log(`\n### ${n} — ${a.n} labelled hands, hand found ${a.detected} (${pct(a.detected / a.n)})`);
  console.log(`| | before | after |\n|---|---|---|`);
  console.log(`| right pose named | ${pct(b.accuracyAll)} (${ci(b.accAllCI)}) | ${pct(a.accuracyAll)} (${ci(a.accAllCI)}) |`);
  console.log(`| wrong pose named | ${pct(b.wrongRate)} (${ci(b.wrongCI)}) | ${pct(a.wrongRate)} (${ci(a.wrongCI)}) |`);
  console.log(`| precision when a pose is named | ${pct(b.precisionDecided)} | ${pct(a.precisionDecided)} |`);
  console.log(`| no pose named (unsure or no hand) | ${pct(1 - b.coverage)} | ${pct(1 - a.coverage)} |`);
  console.log("per class after: " + Object.entries(a.per).filter(([, v]) => v.support).map(([c, v]) => `${c}: P ${pct(v.precision)} R ${pct(v.recall)} F1 ${pct(v.f1)} n=${v.support}`).join("; "));
  console.log("per class before: " + Object.entries(b.per).filter(([, v]) => v.support).map(([c, v]) => `${c}: R ${pct(v.recall)} F1 ${pct(v.f1)}`).join("; "));
  console.log("confusion after (rows = truth): " + JSON.stringify(Object.fromEntries(Object.entries(a.cm).filter(([, v]) => Object.values(v).some(Boolean)).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x))]))));
}
