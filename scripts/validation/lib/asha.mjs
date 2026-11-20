// Loads Asha's own detection code (unchanged files from the repo) into Node.
import fs from "node:fs"; import vm from "node:vm"; import { createRequire } from "node:module";
export const REPO = process.env.ASHA_REPO || new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(import.meta.url);
const ctx = { console, Math, Number, Array, Object, JSON, isFinite, Set, Map, Date };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ["neuroface/utils/landmarks.js", "neuroface/utils/metrics.js", "neuroface/src/vision.js", "neuroface/src/lip-watch.js", "neuroface/src/fingerspeak-signal.js"])
  vm.runInContext(fs.readFileSync(`${REPO}/public/${f}`, "utf8"), ctx, { filename: f });
export const NF = ctx;
export const M = ctx.NF_metrics, LM = ctx.NF_LM;
export const fingers = ctx.NF_fingerspeakSignal;
export const gaze = await import(`${REPO}/public/app/everyday/gaze-engine.js`);
export const { BlinkCounter } = await import(`${REPO}/public/engine/blink-counter.js`);
export const blinkIntent = await import(`${REPO}/public/engine/blink-intent.js`);
export const toLm = (a) => a.map(([x, y, z]) => ({ x, y, z }));
/** Asha's per-frame face features (public/neuroface/src/vision.js Extractor), from a harness record. */
export function features(rec, t, extractor) {
  const ex = extractor || new ctx.NF_vision.Extractor();
  if (!rec.face) return ex.extract({ faceLandmarks: [] }, { videoWidth: rec.w, videoHeight: rec.h, readyState: 0 }, t);
  const res = { faceLandmarks: [toLm(rec.lm)], faceBlendshapes: [{ categories: Object.entries(rec.bs).map(([categoryName, score]) => ({ categoryName, score })) }],
    facialTransformationMatrixes: rec.mx ? [{ rows: 4, columns: 4, data: rec.mx }] : [] };
  return ex.extract(res, { videoWidth: rec.w, videoHeight: rec.h, readyState: 0 }, t);
}
export const newExtractor = () => new ctx.NF_vision.Extractor();
