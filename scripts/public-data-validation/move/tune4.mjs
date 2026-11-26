import { load, score, clips } from "./grid.mjs";
const REL = [["this.anchorHip = hip.y;", "this.anchorHip = ankle.y - hip.y;"], ["extra = rule.hipDrop ? hip.y - this.anchorHip >= rule.hipDrop * this.legLength : this.anchorHip - hip.y >= rule.hipRise * this.legLength;", "extra = rule.hipDrop ? this.anchorHip - (ankle.y - hip.y) >= rule.hipDrop * this.legLength : (ankle.y - hip.y) - this.anchorHip >= rule.hipRise * this.legLength;"]];
const cfg = { squat: [...REL, ['start: 160, target: 110, ret: 155, hipDrop: 0.15,', 'start: 145, target: 125, ret: 140, hipDrop: 0.05,'], ["const MIN_VISIBILITY = 0.6;", "const MIN_VISIBILITY = 0.5;"]], arm_raise: [['start: 40, target: 75, ret: 45, eitherArm', 'start: 40, target: 60, ret: 45, eitherArm'], ["const MIN_VISIBILITY = 0.6;", "const MIN_VISIBILITY = 0.5;"]], wall_pushup: [['start: 150, target: 115, ret: 145,', 'start: 135, target: 115, ret: 130,']] };
const cls = { squat: "squat", arm_raise: "front_raises", wall_pushup: "push_up" };
for (const ex of Object.keys(cfg)) for (const settle of [200, 100, 60]) for (const hold of [150, 60, 0]) for (const alpha of [0.45, 0.7]) {
  const m = await load([...cfg[ex], ["holdMs = 150, settleMs = 200,", `holdMs = 150, settleMs = ${settle},`], ["constructor(alpha = 0.45, gapMs = 700)", `constructor(alpha = ${alpha}, gapMs = 700)`]]);
  const tr = clips[cls[ex]].filter((c) => c.split === "train"), va = clips[cls[ex]].filter((c) => c.split === "val");
  const a = score(m, ex, tr, { holdMs: hold }), b = score(m, ex, va, { holdMs: hold });
  console.log(ex, settle, hold, alpha, "train mae", a.mae.toFixed(2), "ratio", a.ratio.toFixed(2), "over", a.over.toFixed(2), "| val mae", b.mae.toFixed(2), "ratio", b.ratio.toFixed(2), "over", b.over.toFixed(2));
}
