// FingerSpeak pose preview (classifyPose in public/neuroface/src/fingerspeak-signal.js) on labelled public hand images.
import fs from "node:fs"; import { fingers, toLm } from "./lib/asha.mjs"; import { wilson, prf, pct, ci, confusion } from "./lib/stats.mjs";
const read = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const LABELS = ["Closed fingers", "Index extended", "Two fingers extended", "Three fingers extended", "Open palm"];
export function classify(lm, th = { open: 75, closed: 30, lo: 0.48, span: 0.42 }) {
  if (!th.custom) return fingers.classifyPose(lm).name;
  return th.custom(lm);
}
export function samplesRps() {
  const map = { rock: "Closed fingers", paper: "Open palm", scissors: "Two fingers extended", none: "none" };
  return read("rps.jsonl").map((r) => ({ id: r.id, truth: map[r.id.split("/").at(-2)], hands: r.hands, set: "Google RPS" }));
}
export function samplesSubhi(split) {
  const map = { "0-hand": "Closed fingers", "1-hand": "Index extended", "2-hand": "Two fingers extended", "3-hand": "Three fingers extended", "4-hand": "Open palm", "5-hand": "Open palm" };
  const rows = fs.readFileSync(`${process.env.VALIDATION_DATA || "../../../validation-data"}/SubhiH_HandsDataset/data/${split}_labels.csv`, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const recs = new Map(read("hands.jsonl").map((r) => [r.id.split("/").at(-1), r]));
  const out = [];
  for (const [fn, w, h, cls, x0, y0, x1, y1] of rows) {
    const r = recs.get(fn); if (!r) continue;
    // Match the labelled box to a detected hand whose wrist/knuckle centre lies in it.
    const hand = r.hands.find((hd) => { const cx = hd.lm[9][0] * w, cy = hd.lm[9][1] * h; return cx >= +x0 && cx <= +x1 && cy >= +y0 && cy <= +y1; });
    out.push({ id: fn + ":" + x0, truth: map[cls], raw: cls, hands: hand ? [hand] : [], set: "HandsDataset " + split });
  }
  return out;
}
export function score(samples, clf = (lm) => fingers.classifyPose(lm).name) {
  const pairs = [], det = { yes: 0, n: 0 }; let abstain = 0;
  for (const s of samples) {
    if (s.truth === "none") continue;
    det.n++; if (!s.hands.length) { pairs.push([s.truth, "No hand found"]); continue; } det.yes++;
    const p = clf(toLm(s.hands[0].lm)); if (!LABELS.includes(p)) abstain++;
    pairs.push([s.truth, LABELS.includes(p) ? p : "Unsure"]);
  }
  const labels = [...LABELS, "Unsure", "No hand found"];
  const cm = confusion(pairs, labels);
  const per = Object.fromEntries(LABELS.map((c) => {
    const tp = cm[c]?.[c] || 0, fp = labels.reduce((s, t) => s + (t !== c ? cm[t]?.[c] || 0 : 0), 0), fn = Object.entries(cm[c] || {}).reduce((s, [p, v]) => s + (p !== c ? v : 0), 0);
    return [c, { ...prf(tp, fp, fn), support: tp + fn }];
  }));
  const decided = pairs.filter(([, p]) => LABELS.includes(p)), right = decided.filter(([t, p]) => t === p).length;
  const all = pairs.length, correct = pairs.filter(([t, p]) => t === p).length;
  // Wrong named pose = the dangerous case (a gesture shown, a different one read).
  const wrong = decided.length - right;
  return { n: all, detected: det.yes, cm, per, accuracyAll: correct / all, accAllCI: wilson(correct, all), precisionDecided: right / decided.length, precCI: wilson(right, decided.length), coverage: decided.length / all, wrongRate: wrong / all, wrongCI: wilson(wrong, all), abstain, labels };
}
if (process.argv[1].endsWith("eval-hands.mjs")) {
  for (const [name, s] of [["Google RPS (rock/paper/scissors)", samplesRps()], ["HandsDataset test", samplesSubhi("test")], ["HandsDataset train", samplesSubhi("train")]]) {
    const r = score(s);
    console.log(`\n## ${name}: n=${r.n}, hand found ${r.detected}`);
    console.log(`accuracy (all) ${pct(r.accuracyAll)} [${ci(r.accAllCI)}]; precision when it names a pose ${pct(r.precisionDecided)} [${ci(r.precCI)}]; coverage ${pct(r.coverage)}; wrong pose named ${pct(r.wrongRate)} [${ci(r.wrongCI)}]`);
    for (const [c, v] of Object.entries(r.per)) if (v.support) console.log(`  ${c.padEnd(24)} P ${pct(v.precision)} R ${pct(v.recall)} F1 ${pct(v.f1)} (n=${v.support})`);
    console.log("  confusion (rows truth):", JSON.stringify(Object.fromEntries(Object.entries(r.cm).filter(([, v]) => Object.values(v).some(Boolean)))));
  }
}
