// Tune detector thresholds on Countix TRAIN clips, report on Countix VAL clips (held out).
import fs from "node:fs";
const SRC = fs.readFileSync("/home/user/neurobridge-asha-unified-app/src/features/move/detectors.js", "utf8");
const LM = "/tmp/w/move/lm";
const truth = new Map();
for (const sp of ["train", "val"]) {
  const [, ...rows] = fs.readFileSync(`/tmp/w/kin/countix/countix_${sp}.csv`, "utf8").trim().split("\n");
  for (const r of rows) { const [id, cls, ks, ke, , , n] = r.split(","); truth.set(`${cls.replace(/ /g, "_")}__${id}_${String(ks).padStart(6, "0")}_${String(ke).padStart(6, "0")}`, { count: +n, split: sp }); }
}
const clips = {};
for (const f of fs.readdirSync(LM)) { const k = f.slice(0, -5), tr = truth.get(k); if (!tr) continue; const cls = k.split("__")[0]; (clips[cls] ??= []).push({ k, ...tr, d: JSON.parse(fs.readFileSync(`${LM}/${f}`, "utf8")) }); }
let n = 0;
export async function load(patch) {
  let s = SRC;
  for (const [a, b] of patch) { if (!s.includes(a)) throw new Error("patch miss " + a); s = s.replace(a, b); }
  const p = `/tmp/w/move/h/tmp_det_${n++}.mjs`; fs.writeFileSync(p, s); const m = await import(p); fs.unlinkSync(p); return m;
}
export function score(mod, exercise, list, opts = {}) {
  let ae = 0, exact = 0, ob1 = 0, zero = 0, over = 0, sumT = 0, sumP = 0; const per = [];
  for (const c of list) {
    const det = mod.createDetector(exercise, opts);
    for (const [t, pts] of c.d.frames) det.update({ timestamp: t, landmarks: pts?.map(([x, y, v, p]) => ({ x, y, visibility: v, presence: p })), personCount: pts ? 1 : 0, width: c.d.w, height: c.d.h });
    const e = det.reps - c.count; ae += Math.abs(e); exact += e === 0; ob1 += Math.abs(e) <= 1; zero += det.reps === 0; over += e > 0; sumT += c.count; sumP += det.reps; per.push({ k: c.k, truth: c.count, reps: det.reps });
  }
  const N = list.length; return { N, mae: ae / N, exact: exact / N, ob1: ob1 / N, zero: zero / N, over: over / N, ratio: sumP / sumT, per };
}
export { clips };
