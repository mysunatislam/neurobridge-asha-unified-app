// Robustness of the shipped Move counters (detectors 1.2.0) on the held-out Countix VAL clips:
// the same landmarks, changed the way a real ASHA session could change them.
//   mirror      front-camera selfie view (x flipped, left/right landmarks swapped)
//   slow x2/x3  the same movement at half / a third of the speed (timestamps stretched)
//   7.5 fps     a slower phone: every other frame dropped
//   jitter      landmark noise, Gaussian sd 0.5% / 1% of the frame
//   dropouts    10% of frames with no person found
// Truth stays the Countix count. Error = |counted - true| per clip, bootstrap 95% CI.
import fs from "node:fs";
import { clips, score } from "./grid.mjs";
const after = await import(process.env.DETECTORS || "/home/user/neurobridge-asha-unified-app/src/features/move/detectors.js");
const pairs = [["squat", "squat"], ["push_up", "wall_pushup"], ["front_raises", "arm_raise"]];
const SWAP = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const mapFrames = (c, f) => ({ ...c, d: { ...c.d, frames: f(c.d.frames) } });
const COND = {
  baseline: (c) => c,
  mirror: (c) => mapFrames(c, (F) => F.map(([t, p]) => { if (!p) return [t, p]; const q = p.map(([x, y, v, pr]) => [1 - x, y, v, pr]); for (const [a, b] of SWAP) [q[a], q[b]] = [q[b], q[a]]; return [t, q]; })),
  "slow x2": (c) => mapFrames(c, (F) => F.map(([t, p]) => [t * 2, p])),
  "slow x3": (c) => mapFrames(c, (F) => F.map(([t, p]) => [t * 3, p])),
  "7.5 fps": (c) => mapFrames(c, (F) => F.filter((_, i) => i % 2 === 0)),
  "jitter 0.5%": (c) => mapFrames(c, (F) => F.map(([t, p]) => [t, p && p.map(([x, y, v, pr]) => [x + 0.005 * gauss(), y + 0.005 * gauss(), v, pr])])),
  "jitter 1%": (c) => mapFrames(c, (F) => F.map(([t, p]) => [t, p && p.map(([x, y, v, pr]) => [x + 0.01 * gauss(), y + 0.01 * gauss(), v, pr])])),
  "10% dropouts": (c) => mapFrames(c, (F) => F.map(([t, p]) => [t, rnd() < 0.1 ? null : p])),
};
const quality = (ex, c) => { const d = after.createDetector(ex); for (const [t, p] of c.d.frames) d.update({ timestamp: t, landmarks: p?.map(([x, y, v, q]) => ({ x, y, visibility: v, presence: q })), personCount: p ? 1 : 0, width: c.d.w, height: c.d.h }); return d.quality(); };
function boot(per, B = 2000) { let x = 7; const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); const e = per.map((p) => Math.abs(p.reps - p.truth)); const m = []; for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < e.length; i++) t += e[Math.floor(r() * e.length)]; m.push(t / e.length); } m.sort((a, b) => a - b); return [+m[Math.floor(B * 0.025)].toFixed(2), +m[Math.floor(B * 0.975)].toFixed(2)]; }
const out = [];
for (const [cls, ex] of pairs) {
  const val = clips[cls].filter((c) => c.split === "val");
  const inView = val.filter((c) => quality(ex, c) >= 0.9);
  for (const [subset, list] of [["every clip", val], ["body in view", inView]]) {
    for (const [name, f] of Object.entries(COND)) {
      seed = 11;
      const r = score(after, ex, list.map(f));
      out.push({ cls, ex, subset, condition: name, N: r.N, mae: +r.mae.toFixed(2), maeCI: boot(r.per), within1: +r.ob1.toFixed(3), over: +r.over.toFixed(3), zero: +r.zero.toFixed(3), countedOverTrue: +r.ratio.toFixed(3) });
    }
  }
}
fs.writeFileSync(process.env.OUT || "/tmp/w/move/robust.json", JSON.stringify(out, null, 1));
for (const r of out) console.log(`${r.ex.padEnd(12)} ${r.subset.padEnd(13)} ${r.condition.padEnd(13)} N ${String(r.N).padStart(2)}  MAE ${r.mae.toFixed(2)} [${r.maeCI}]  ±1 ${(r.within1 * 100).toFixed(0)}%  over ${(r.over * 100).toFixed(0)}%  zero ${(r.zero * 100).toFixed(0)}%  ratio ${r.countedOverTrue}`);
