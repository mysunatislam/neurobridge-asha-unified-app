// Runs Asha's blink detectors over one video's per-frame face records.
import { features, newExtractor, BlinkCounter, toLm, blinkIntent } from "./asha.mjs";
import { eyeOpenness, LongBlink } from "../../../src/features/eyespeak/cursor-logic.js";
const KEEP = ["facePresent", "faceQuality", "earLeft", "earRight", "poseSpeed", "eyeBlinkLeft", "eyeBlinkRight"];
/** Per-frame inputs of the blink detectors, computed one frame at a time, so face meshes need not stay in memory. */
export function frameStepper(fps) {
  const ex = newExtractor(), frames = [];
  return { frames, push(r) { const f = features(r, (frames.length * 1000) / fps, ex);
    frames.push({ f: Object.fromEntries(KEEP.map((k) => [k, f[k]])), o: r.face ? eyeOpenness(toLm(r.lm), r.w, r.h) : null }); } };
}
/** Same as runVideo, on precomputed frames. */
export function runFrames(pre, fps, opts = {}) {
  const bc = new (opts.Counter || BlinkCounter)(opts.counterOpts), lb = new LongBlink(), out = { blinks: [], long: [], frames: pre.length, valid: 0 };
  let last = 0;
  pre.forEach(({ f, o }, i) => {
    const t = (i * 1000) / fps, snap = bc.update(f, t);
    if (f.facePresent) out.valid++;
    if (bc.total > last) { last = bc.total; out.blinks.push({ ...snap.last, startFrame: Math.round((snap.last.start * fps) / 1000), endFrame: i }); }
    const e = lb.update(o, t);
    if (e) out.long.push({ ...e, startFrame: Math.round((e.closedAt * fps) / 1000), endFrame: i });
  });
  out.triples = 0;
  for (let i = 2; i < out.blinks.length; i++) if (blinkIntent.rapidTriple(out.blinks.slice(i - 2, i + 1))) out.triples++;
  return out;
}
export function runVideo(recs, fps, opts = {}) {
  const ex = newExtractor(), bc = new (opts.Counter || BlinkCounter)(opts.counterOpts), lb = new LongBlink(), out = { blinks: [], long: [], frames: recs.length, valid: 0 };
  let last = 0;
  recs.forEach((r, i) => {
    const t = (i * 1000) / fps;
    const f = features(r, t, ex);
    const snap = bc.update(f, t);
    if (f.facePresent) out.valid++;
    if (bc.total > last) { last = bc.total; out.blinks.push({ ...snap.last, startFrame: Math.round((snap.last.start * fps) / 1000), endFrame: i }); }
    const o = r.face ? eyeOpenness(toLm(r.lm), r.w, r.h) : null;
    const e = lb.update(o, t);
    if (e) out.long.push({ ...e, startFrame: Math.round((e.closedAt * fps) / 1000), endFrame: i });
  });
  out.triples = 0;
  for (let i = 2; i < out.blinks.length; i++) if (blinkIntent.rapidTriple(out.blinks.slice(i - 2, i + 1))) out.triples++;
  return out;
}
/** Greedy one-to-one matching of detections to annotated blinks (frame intervals), with a small tolerance. */
export function match(det, gt, tol = 3) {
  const used = new Set(); let tp = 0;
  for (const d of det) {
    const k = gt.findIndex((g, j) => !used.has(j) && d.startFrame <= g.end + tol && d.endFrame >= g.start - tol);
    if (k >= 0) { used.add(k); tp++; }
  }
  return { tp, fp: det.length - tp, fn: gt.length - tp };
}
