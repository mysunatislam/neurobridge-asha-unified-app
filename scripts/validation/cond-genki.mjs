import fs from "node:fs"; import { load, stretchActive, auc } from "./eval-genki.mjs"; import { wilson, pct, ci } from "./lib/stats.mjs";
const cond = JSON.parse(fs.readFileSync("genki-cond.json", "utf8"));
const F = load().filter((s) => s.face).map((s) => ({ ...s, c: cond[s.i] })).filter((s) => s.c);
const ita = (v) => (v > 55 ? "very light (ITA>55)" : v > 41 ? "light (41-55)" : v > 28 ? "intermediate (28-41)" : v > 10 ? "tan (10-28)" : "brown/dark (<10)");
const br = (v) => (v < 90 ? "dim face (<90)" : v < 140 ? "medium (90-140)" : "bright (>=140)");
for (const [name, key] of [["skin tone estimate (ITA)", (s) => ita(s.c.ita)], ["face brightness", (s) => br(s.c.bright)], ["head yaw", (s) => (Math.abs(s.yaw) < 10 ? "|yaw|<10°" : Math.abs(s.yaw) < 20 ? "10-20°" : ">=20°")]]) {
  console.log(`\n### by ${name}`);
  const groups = {}; for (const s of F) (groups[key(s)] ??= []).push(s);
  for (const [g, S] of Object.entries(groups).sort()) {
    const pos = S.filter((s) => s.smile), neg = S.filter((s) => !s.smile);
    const tp = pos.filter((s) => s.smileBs > 0.25).length, tn = neg.filter((s) => s.smileBs <= 0.25).length;
    const okNeg = neg.filter((s) => Math.abs(s.f.yaw) < 20 && Math.abs(s.f.roll) < 12);
    const fpOld = neg.filter((s) => stretchActive(s)).length, fpNew = neg.filter((s) => stretchActive(s, { yawComp: 0.352 })).length;
    const yawErr = S.reduce((a, s) => a + Math.abs(-s.f.yaw - s.yaw), 0) / S.length;
    console.log(`${g.padEnd(24)} n=${String(S.length).padStart(4)} smile AUC ${neg.length && pos.length ? auc(pos.map((s) => s.smileBs), neg.map((s) => s.smileBs)).toFixed(3) : "n/a"} sens@0.25 ${pct(tp / pos.length)} spec@0.25 ${pct(tn / neg.length)} | stretch FP before ${pct(fpOld / neg.length)} after ${pct(fpNew / neg.length)} [${ci(wilson(fpNew, neg.length))}] | yaw MAE ${yawErr.toFixed(1)}°`);
  }
}
