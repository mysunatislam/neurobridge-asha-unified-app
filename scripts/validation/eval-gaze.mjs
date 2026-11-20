// MPIIFaceGaze: per-person calibration of Asha's gaze model (public/app/everyday/gaze-engine.js),
// then accuracy on that person's other images. Targets are screen fractions, like the app.
import fs from "node:fs"; import { gaze } from "./lib/asha.mjs"; import { pct, ci, wilson, bootstrap, quantile } from "./lib/stats.mjs";
const { extractGazeFeatures, fitGazeModel, predictGaze, validateGazeModel, calibrationTargets, CHECK_TARGETS } = gaze;
const BOARD_LIMITS = [{ size: 9, p90: 0.09, mean: 0.06 }, { size: 6, p90: 0.16, mean: 0.11 }, { size: 2, p90: 0.26, mean: 0.18 }];
const boardFor = (v) => BOARD_LIMITS.find((l) => v.p90Error <= l.p90 && v.meanError <= l.mean)?.size ?? 0;
const LAYOUT = { 9: [3, 3], 6: [3, 2], 2: [2, 1] };
export function people() {
  const meta = JSON.parse(fs.readFileSync("gaze-meta.json", "utf8")); // {pid: [{id, x, y}]} x,y screen fractions
  const recs = new Map(fs.readFileSync("gaze.jsonl", "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const out = {};
  for (const [pid, rows] of Object.entries(meta)) {
    out[pid] = rows.map((m) => { const r = recs.get(m.id); if (!r?.face) return { ...m, ok: false, reason: "no face" };
      const f = extractGazeFeatures(r.lm.map(([x, y, z]) => ({ x, y, z })), r.w, r.h); return f.valid ? { ...m, ok: true, features: f.values } : { ...m, ok: false, reason: f.reason }; });
  }
  return out;
}
const near = (pool, [tx, ty], k, used) => pool.filter((s) => !used.has(s)).map((s) => [Math.hypot(s.x - tx, s.y - ty), s]).sort((a, b) => a[0] - b[0]).slice(0, k).filter(([d]) => d < 0.2).map(([, s]) => s);
export function simulate(rows, { ridge = 0.05, points = 9, perPoint = 8 } = {}) {
  const pool = rows.filter((s) => s.ok), used = new Set();
  const cal = []; for (const t of calibrationTargets(points)) for (const s of near(pool, t, perPoint, used)) { used.add(s); cal.push(s); }
  const chk = []; for (const t of CHECK_TARGETS) for (const s of near(pool, t, 6, used)) { used.add(s); chk.push(s); }
  let model; try { model = fitGazeModel(cal.map((s) => ({ features: s.features, x: s.x, y: s.y })), { ridge }); } catch (e) { return { failed: String(e.message) }; }
  let v; try { v = validateGazeModel(model, chk.map((s) => ({ features: s.features, x: s.x, y: s.y }))); } catch (e) { return { failed: String(e.message) }; }
  model.validation = { ...v, passed: true };
  const test = rows.filter((s) => !used.has(s));
  const errs = [], tiles = {}; let invalid = 0;
  for (const s of test) {
    const p = s.ok ? predictGaze(model, s.features) : { valid: false };
    if (!p.valid) { invalid++; continue; }
    errs.push(Math.hypot(p.x - s.x, p.y - s.y));
    for (const size of [9, 6, 2]) { const [c, r] = LAYOUT[size]; const T = tiles[size] ??= { right: 0, wrong: 0 };
      const tile = (x, y) => Math.min(c - 1, Math.floor(x * c)) + c * Math.min(r - 1, Math.floor(y * r));
      tile(p.x, p.y) === tile(s.x, s.y) ? T.right++ : T.wrong++; }
  }
  return { board: boardFor(v), check: v, test: test.length, invalid, errs, tiles, cal: cal.length };
}
if (process.argv[1].endsWith("eval-gaze.mjs")) {
  const P = people(), ridge = +(process.argv[2] || 0.05), points = +(process.argv[3] || 9);
  const all = [], boards = {}; const tileAll = {};
  for (const [pid, rows] of Object.entries(P)) {
    const usable = rows.filter((s) => s.ok).length, r = simulate(rows, { ridge, points });
    if (r.failed) { console.log(pid, `usable ${usable}/${rows.length}`, "calibration failed:", r.failed); boards[pid] = 0; continue; }
    boards[pid] = r.board; all.push(...r.errs);
    for (const [k, v] of Object.entries(r.tiles)) { const T = tileAll[k] ??= { right: 0, wrong: 0 }; T.right += v.right; T.wrong += v.wrong; }
    const m = r.errs.reduce((a, b) => a + b, 0) / r.errs.length;
    console.log(`${pid} usable ${usable}/${rows.length} check mean ${pct(r.check.meanError)} p90 ${pct(r.check.p90Error)} → board ${r.board} | test n=${r.errs.length} (+${r.invalid} refused) mean ${pct(m)} p90 ${pct(quantile(r.errs, 0.9))} | 9-tile ${pct(r.tiles[9].right / (r.tiles[9].right + r.tiles[9].wrong))} 6-tile ${pct(r.tiles[6].right / (r.tiles[6].right + r.tiles[6].wrong))} halves ${pct(r.tiles[2].right / (r.tiles[2].right + r.tiles[2].wrong))}`);
  }
  console.log(`\npooled test error mean ${pct(all.reduce((a, b) => a + b, 0) / all.length)} median ${pct(quantile(all, 0.5))} p90 ${pct(quantile(all, 0.9))}`);
  for (const [k, T] of Object.entries(tileAll)) console.log(`  ${k}-tile layout: right tile ${pct(T.right / (T.right + T.wrong))} [${ci(wilson(T.right, T.right + T.wrong))}] (single image, no dwell averaging)`);
  console.log("boards given:", JSON.stringify(boards));
}
