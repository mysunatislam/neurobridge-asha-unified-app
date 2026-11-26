import fs from "node:fs";
import { clips, score } from "./grid.mjs";
const before = await import("/tmp/w/move/detectors_before.js");
const after = await import("/home/user/neurobridge-asha-unified-app/src/features/move/detectors.js");
const pairs = [["squat", "squat"], ["push_up", "wall_pushup"], ["front_raises", "arm_raise"], ["lunge", "squat"]];
const s = (r) => ({ N: r.N, mae: +r.mae.toFixed(2), exact: +r.exact.toFixed(3), within1: +r.ob1.toFixed(3), zero: +r.zero.toFixed(3), over: +r.over.toFixed(3), countedOverTrue: +r.ratio.toFixed(3) });
function boot(per, B = 2000) { const rng = (() => { let x = 7; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })(); const e = per.map((p) => Math.abs(p.reps - p.truth)); const m = []; for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < e.length; i++) t += e[Math.floor(rng() * e.length)]; m.push(t / e.length); } m.sort((a, b) => a - b); return [+m[Math.floor(B * 0.025)].toFixed(2), +m[Math.floor(B * 0.975)].toFixed(2)]; }
const quality = (mod, ex, c) => { const d = mod.createDetector(ex); for (const [t, p] of c.d.frames) d.update({ timestamp: t, landmarks: p?.map(([x, y, v, q]) => ({ x, y, visibility: v, presence: q })), personCount: p ? 1 : 0, width: c.d.w, height: c.d.h }); return d.quality(); };
const out = { rep: [], cross: [] };
for (const [cls, ex] of pairs) {
  const all = clips[cls];
  for (const split of ["val", "all"]) {
    const L = split === "val" ? all.filter((c) => c.split === "val") : all;
    const inP = L.filter((c) => quality(before, ex, c) >= 0.9);
    for (const [name, list] of [["every clip", L], ["body in view ≥90% of frames", inP]]) {
      const b = score(before, ex, list), a = score(after, ex, list);
      out.rep.push({ cls, ex, split, subset: name, before: { ...s(b), maeCI: boot(b.per) }, after: { ...s(a), maeCI: boot(a.per) } });
    }
  }
}
// False counts: run a detector on clips of a different exercise (truth for that detector = 0 reps)
for (const [cls, ex] of [["front_raises", "squat"], ["push_up", "squat"], ["squat", "wall_pushup"], ["front_raises", "wall_pushup"], ["squat", "arm_raise"], ["lunge", "arm_raise"], ["situp", "squat"], ["jumping_jacks", "squat"]]) {
  const L = clips[cls];
  const f = (mod) => { let n = 0, any = 0; for (const c of L) { const d = mod.createDetector(ex); for (const [t, p] of c.d.frames) d.update({ timestamp: t, landmarks: p?.map(([x, y, v, q]) => ({ x, y, visibility: v, presence: q })), personCount: p ? 1 : 0, width: c.d.w, height: c.d.h }); n += d.reps; any += d.reps > 0; } return { clips: L.length, clipsWithFalseCount: any, falseReps: n, falseRepsPerMinute: +(n / (L.length * 10 / 60)).toFixed(2) }; };
  out.cross.push({ clips: cls, detector: ex, before: f(before), after: f(after) });
}
fs.writeFileSync("/tmp/w/move/final.json", JSON.stringify(out, null, 1));
for (const r of out.rep) console.log(r.cls, r.ex, r.split, r.subset, "| before", JSON.stringify(r.before), "| after", JSON.stringify(r.after));
for (const r of out.cross) console.log("FALSE", r.clips, "->", r.detector, JSON.stringify(r.before), JSON.stringify(r.after));
