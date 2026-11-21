import { load, score, clips } from "./grid.mjs";
import fs from "node:fs";
const REL = [["this.anchorHip = hip.y;", "this.anchorHip = ankle.y - hip.y;"], ["extra = rule.hipDrop ? hip.y - this.anchorHip >= rule.hipDrop * this.legLength : this.anchorHip - hip.y >= rule.hipRise * this.legLength;", "extra = rule.hipDrop ? this.anchorHip - (ankle.y - hip.y) >= rule.hipDrop * this.legLength : (ankle.y - hip.y) - this.anchorHip >= rule.hipRise * this.legLength;"]];
const RULES = {
  squat: { cls: "squat", re: /squat: \{ joint: \["hip", "knee", "ankle"\], direction: "decrease", start: 160, target: 110, ret: 155, hipDrop: 0.15,/, mk: (s, t, h) => `squat: { joint: ["hip", "knee", "ankle"], direction: "decrease", start: ${s}, target: ${t}, ret: ${s - 5}, hipDrop: ${h},`, starts: [140, 145, 150, 155, 160], targets: [100, 110, 120, 125, 130], dir: -1, hds: [0.05, 0.1, 0.15] },
  wall_pushup: { cls: "push_up", re: /wall_pushup: \{ joint: \["shoulder", "elbow", "wrist"\], direction: "decrease", start: 150, target: 115, ret: 145,/, mk: (s, t) => `wall_pushup: { joint: ["shoulder", "elbow", "wrist"], direction: "decrease", start: ${s}, target: ${t}, ret: ${s - 5},`, starts: [135, 140, 145, 150, 155], targets: [95, 105, 115, 120], dir: -1, hds: [null] },
  arm_raise: { cls: "front_raises", re: /arm_raise: \{ joint: \["hip", "shoulder", "elbow"\], direction: "increase", start: 40, target: 75, ret: 45,/, mk: (s, t) => `arm_raise: { joint: ["hip", "shoulder", "elbow"], direction: "increase", start: ${s}, target: ${t}, ret: ${s + 5},`, starts: [25, 30, 35, 40, 45], targets: [60, 65, 70, 75, 80], dir: 1, hds: [null] },
};
const ex = process.argv[2], R = RULES[ex];
const all = clips[R.cls], train = all.filter((c) => c.split === "train"), val = all.filter((c) => c.split === "val");
const base = await load([]);
// "in protocol" = the app's own view check accepts >= 90% of frames with today's detector
const vf = new Map();
for (const c of all) { const d = base.createDetector(ex); for (const [t, p] of c.d.frames) d.update({ timestamp: t, landmarks: p?.map(([x, y, v, q]) => ({ x, y, visibility: v, presence: q })), personCount: p ? 1 : 0, width: c.d.w, height: c.d.h }); vf.set(c.k, d.quality()); }
const res = [];
for (const rel of ex === "squat" ? [false, true] : [false]) for (const s of R.starts) for (const t of R.targets) for (const h of R.hds) for (const mv of [0.5, 0.6]) {
  if (R.dir < 0 ? t >= s - 15 : t <= s + 15) continue;
  const src = await load([...(rel ? REL : []), [R.re.source.replace(/\\/g, ""), R.mk(s, t, h)], ["const MIN_VISIBILITY = 0.6;", `const MIN_VISIBILITY = ${mv};`]]);
  res.push({ rel, s, t, h, mv, ...score(src, ex, train), per: undefined, _m: src });
}
res.sort((a, b) => a.mae - b.mae);
const best = res[0];
const summ = (r) => ({ N: r.N, mae: +r.mae.toFixed(2), exact: +r.exact.toFixed(2), ob1: +r.ob1.toFixed(2), zero: +r.zero.toFixed(2), over: +r.over.toFixed(2), ratio: +r.ratio.toFixed(2) });
const inP = (l) => l.filter((c) => vf.get(c.k) >= 0.9);
const out = { ex, cls: R.cls, best: { rel: best.rel, start: best.s, target: best.t, hipDrop: best.h, minVisibility: best.mv },
  baseline: { train: summ(score(base, ex, train)), val: summ(score(base, ex, val)), val_inProtocol: summ(score(base, ex, inP(val))), all_inProtocol: summ(score(base, ex, inP(all))) },
  tuned: { train: summ(score(best._m, ex, train)), val: summ(score(best._m, ex, val)), val_inProtocol: summ(score(best._m, ex, inP(val))), all_inProtocol: summ(score(best._m, ex, inP(all))) },
  inProtocolShare: inP(all).length / all.length,
  valPer: score(best._m, ex, val).per, valPerBase: score(base, ex, val).per };
fs.writeFileSync(`/tmp/w/move/tune_${ex}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, valPer: undefined, valPerBase: undefined }));
