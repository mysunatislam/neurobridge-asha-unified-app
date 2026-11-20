// GENKI-4K (UCSD MPLab): 4000 faces labelled smile / non-smile and head yaw/pitch/roll.
import fs from "node:fs"; import { features, newExtractor, M, toLm } from "./lib/asha.mjs"; import { wilson, pct, ci, bootstrap } from "./lib/stats.mjs";
const G = (process.env.VALIDATION_DATA || "../../../validation-data") + "/genki/GENKI-R2009a/Subsets/GENKI-4K/";
const labels = fs.readFileSync(G + "GENKI-4K_Labels.txt", "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
export function load() {
  const recs = fs.readFileSync("genki.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return recs.map((r, i) => {
    const [smile, yaw, pitch, roll] = labels[i];
    const s = { i, smile, yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI, roll: (roll * 180) / Math.PI, face: !!r.face, w: r.w, h: r.h };
    if (!r.face) return s;
    const f = features(r, 1000, newExtractor()), lm = toLm(r.lm);
    Object.assign(s, { f, lm, smileBs: Math.max(f.mouthSmileLeft, f.mouthSmileRight), lateral: M.lipDeviation(lm, 0), corner: M.lipAsymmetry(lm, null), intensity: M.smileIntensity(lm, null), faceW: r.w });
    return s;
  });
}
export function auc(pos, neg) { let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0; return s / (pos.length * neg.length); }
// Engine rule from public/engine/face-analysis.js (no resting reference yet: absolute thresholds).
export function stretchActive(s, rule = {}) {
  const { lat = 0.035, cor = 0.04, yawGate = 20, rollGate = 12, yawComp = 0 } = rule;
  const yaw = s.f.yaw, roll = s.f.roll;
  const lateral = s.lateral - yawComp * Math.sin((yaw * Math.PI) / 180);
  const useCorner = Math.abs(s.corner) / cor > Math.abs(lateral) / lat;
  const dev = useCorner ? s.corner : lateral, th = useCorner ? cor : lat;
  return Math.abs(yaw) < yawGate && Math.abs(roll) < rollGate && s.intensity < 0.4 && Math.abs(dev) >= th;
}
if (process.argv[1].endsWith("eval-genki.mjs")) {
  const all = load(), F = all.filter((s) => s.face);
  console.log(`faces found ${F.length}/${all.length} = ${pct(F.length / all.length)} [${ci(wilson(F.length, all.length))}]`);
  // Head pose agreement (GENKI labels vs Asha's yaw/pitch/roll from the face transform). Sign convention fitted.
  for (const k of ["yaw", "pitch", "roll"]) {
    const sgn = F.reduce((a, s) => a + s[k] * s.f[k], 0) >= 0 ? 1 : -1;
    const errs = F.map((s) => Math.abs(sgn * s.f[k] - s[k]));
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(`${k}: sign ${sgn}, MAE ${mae.toFixed(1)}° [${bootstrap(errs, (a) => a.reduce((x, y) => x + y, 0) / a.length, 500).map((x) => x.toFixed(1)).join("–")}]`);
  }
  const pos = F.filter((s) => s.smile === 1), neg = F.filter((s) => s.smile === 0);
  console.log(`smile blendshape AUC ${auc(pos.map((s) => s.smileBs), neg.map((s) => s.smileBs)).toFixed(3)} (n+=${pos.length}, n-=${neg.length})`);
  for (const t of [0.18, 0.25, 0.3, 0.4, 0.5]) {
    const tp = pos.filter((s) => s.smileBs > t).length, fp = neg.filter((s) => s.smileBs > t).length;
    console.log(`  thr ${t}: sensitivity ${pct(tp / pos.length)} specificity ${pct(1 - fp / neg.length)}`);
  }
  // Neutral-reference gate: a smiling face must not be learnt as the resting face.
  const relaxed = (s) => s.smileBs < 0.25 && Math.max(s.f.eyeBlinkLeft, s.f.eyeBlinkRight) < 0.25 && s.f.jawOpen < 0.25;
  const leak = pos.filter(relaxed).length;
  console.log(`smiling faces that pass the 'relaxed' gate: ${pct(leak / pos.length)} [${ci(wilson(leak, pos.length))}]`);
  // Abnormal stretch on (presumed healthy) faces: per-image false activations, by head yaw.
  const rest = neg.filter((s) => Math.abs(s.f.yaw) < 20 && Math.abs(s.f.roll) < 12);
  const act = neg.filter((s) => stretchActive(s));
  console.log(`stretch 'active' on non-smiling faces: ${act.length}/${neg.length} = ${pct(act.length / neg.length)} [${ci(wilson(act.length, neg.length))}]`);
  for (const [a, b] of [[0, 5], [5, 10], [10, 15], [15, 20]]) {
    const bin = neg.filter((s) => Math.abs(s.f.yaw) >= a && Math.abs(s.f.yaw) < b), k = bin.filter((s) => stretchActive(s)).length;
    console.log(`   |yaw| ${a}-${b}°: ${k}/${bin.length} = ${pct(k / bin.length)} [${ci(wilson(k, bin.length))}]`);
  }
  // Does the lateral shift follow head yaw? (nose tip protrudes, so turning moves it relative to the mouth)
  const xs = neg.map((s) => Math.sin((s.f.yaw * Math.PI) / 180)), ys = neg.map((s) => s.lateral);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const r = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0));
  console.log(`lateral shift vs sin(yaw): slope ${slope.toFixed(3)}, r=${r.toFixed(2)}`);
}
