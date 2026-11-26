// Feed MediaPipe pose landmarks from public videos into ASHA's real rep detectors.
import fs from "node:fs";
const REPO = process.env.REPO ?? "/home/user/neurobridge-asha-unified-app";
const { createDetector } = await import(`${REPO}/src/features/move/detectors.js`);
const LM = "/tmp/w/move/lm";
const MAP = { squat: ["squat", "chair_squat"], lunge: ["squat", "chair_squat"], push_up: ["wall_pushup"], front_raises: ["arm_raise", "shoulder_flexion"], exercising_arm: ["elbow_flexion"], situp: [], jumping_jacks: ["arm_raise"] };
const truth = new Map();
for (const sp of ["train", "val"]) {
  const [h, ...rows] = fs.readFileSync(`/tmp/w/kin/countix/countix_${sp}.csv`, "utf8").trim().split("\n");
  for (const r of rows) {
    const [id, cls, ks, ke, rs, re, n] = r.split(",");
    truth.set(`${cls.replace(/ /g, "_")}__${id}_${String(ks).padStart(6, "0")}_${String(ke).padStart(6, "0")}`, { cls, count: +n, split: sp, rs: +rs - +ks, re: +re - +ks });
  }
}
export function runClip(file, exercise, opts = {}) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const det = createDetector(exercise, opts);
  let valid = 0, last;
  for (const [t, pts] of d.frames) {
    const landmarks = pts ? pts.map(([x, y, v, p]) => ({ x, y, z: 0, visibility: v, presence: p })) : null;
    last = det.update({ timestamp: t, landmarks, personCount: landmarks ? 1 : 0, width: d.w, height: d.h });
    if (last.valid) valid++;
  }
  return { reps: det.reps, partials: last?.partials ?? 0, validFrac: valid / Math.max(1, d.frames.length), frames: d.frames.length };
}
const out = [];
for (const f of fs.readdirSync(LM)) {
  const key = f.replace(/\.json$/, "");
  const tr = truth.get(key);
  if (!tr) continue;
  const cls = key.split("__")[0];
  for (const ex of MAP[cls] ?? []) out.push({ key, cls, split: tr.split, exercise: ex, truth: tr.count, ...runClip(`${LM}/${f}`, ex) });
}
fs.writeFileSync(process.env.OUT ?? "/tmp/w/move/results.json", JSON.stringify(out));
// summary
const groups = {};
for (const r of out) (groups[`${r.cls} -> ${r.exercise}`] ??= []).push(r);
for (const [g, rs] of Object.entries(groups)) {
  const mae = rs.reduce((s, r) => s + Math.abs(r.reps - r.truth), 0) / rs.length;
  const exact = rs.filter((r) => r.reps === r.truth).length / rs.length;
  const ob1 = rs.filter((r) => Math.abs(r.reps - r.truth) <= 1).length / rs.length;
  const zero = rs.filter((r) => r.reps === 0).length / rs.length;
  const vf = rs.reduce((s, r) => s + r.validFrac, 0) / rs.length;
  console.log(g.padEnd(34), `n=${rs.length}`, `MAE=${mae.toFixed(2)}`, `exact=${(exact * 100).toFixed(0)}%`, `±1=${(ob1 * 100).toFixed(0)}%`, `zero=${(zero * 100).toFixed(0)}%`, `validFrames=${(vf * 100).toFixed(0)}%`, `meanTruth=${(rs.reduce((s, r) => s + r.truth, 0) / rs.length).toFixed(1)}`);
}
