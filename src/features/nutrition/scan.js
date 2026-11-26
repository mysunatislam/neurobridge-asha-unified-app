// Live scan steadiness check. The food recogniser looks at sampled frames (a few per second, in a
// worker); this decides when the same food has been seen clearly enough to freeze a still for the
// person to confirm. Rule: the same best guess in 4 of the last 6 good frames, and the newest frame
// must itself agree. Only the model's single best guess counts, and only above FOOD_VISION.minScore
// (on public photos, best guesses at 0.5 or more were right 84% of the time).
import { FOOD_VISION, autoFillFor, suggestionFor } from "./catalog.js";

export const SCAN_RULE = Object.freeze({ window: 6, need: 4, minScore: FOOD_VISION.minScore, tentativeNeed: 2 });

/** The model's best guess, if it is a food and confident enough. Lower guesses are never promoted. */
function topFood(categories, rule) {
  let top = null;
  for (const c of categories ?? []) if (!top || c.score > top.score) top = c;
  if (!top || top.label === "not_food" || !(top.score >= rule.minScore)) return null;
  return { label: top.label, dishId: suggestionFor(top.label), score: top.score };
}

/**
 * One sampled frame: {categories:[{label, score}], quality:{warnings:[]}, faceInView:boolean}.
 * Returns the frame's best food (label, and the ASHA dish if there is one) and whether the frame is usable.
 */
export function readSample(sample, rule = SCAN_RULE) {
  const warnings = sample?.quality?.warnings ?? [];
  const usable = warnings.length === 0 && !sample?.faceInView;
  return { usable, best: topFood(sample?.categories, rule), warnings, faceInView: !!sample?.faceInView };
}

export class StabilityTracker {
  constructor(rule = SCAN_RULE) {
    this.rule = rule;
    this.reset();
  }

  /** Start over (Retake / Continue scanning). The tracker can fire again after this. */
  reset() {
    this.recent = [];
    this.fired = false;
    this.samples = 0;
  }

  /**
   * Add a sampled frame. Returns:
   *   state: "QUALITY_WAIT" (frame not usable), "SCANNING" (usable, nothing steady yet),
   *          "CANDIDATE_STABLE" (freeze now; returned once), or "FROZEN" (already fired).
   *   tentative: the recogniser label seen in at least 2 of the last 6 frames, for a small "Possible: …" label.
   */
  push(sample) {
    if (this.fired) return { state: "FROZEN", candidate: null, tentative: null };
    this.samples += 1;
    const read = readSample(sample, this.rule);
    this.recent.push(read.usable ? read.best?.label ?? null : null);
    if (this.recent.length > this.rule.window) this.recent.shift();
    const counts = {};
    for (const id of this.recent) if (id) counts[id] = (counts[id] ?? 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const tentative = n >= this.rule.tentativeNeed ? top : null;
    if (!read.usable) return { state: "QUALITY_WAIT", candidate: null, tentative, warnings: read.warnings, faceInView: read.faceInView };
    if (top && n >= this.rule.need && read.best?.label === top) {
      this.fired = true;
      return { state: "CANDIDATE_STABLE", candidate: { label: top, dishId: read.best.dishId, matches: n, of: this.recent.length, score: read.best.score }, tentative };
    }
    return { state: "SCANNING", candidate: null, tentative };
  }
}

/**
 * Suggestions from one still image (upload, manual shutter, or the frozen live frame: the same
 * function for all three). At most one: the model's best guess, when it is a food ASHA has a
 * nutrition record for AND its score reaches that food's fill-in threshold (FOOD_VISION.fillMin).
 * Otherwise (no record, or a food the camera confuses too often, such as orange vs pomelo) there is
 * no suggestion; `recognisedFrom` names it instead so the person can pick it themselves.
 */
export function suggestionsFrom(categories, rule = SCAN_RULE) {
  const best = topFood(categories, rule);
  if (!best?.dishId || !autoFillFor(best.label, best.score)) return [];
  return [{ dishId: best.dishId, label: best.label, score: Math.round(best.score * 100) / 100, modelId: FOOD_VISION.modelId, modelVersion: FOOD_VISION.modelVersion, experimental: true }];
}

/** Up to three food guesses with their scores, best first, for display only ("Looks like …"). */
export function recognisedFrom(categories, max = 3) {
  return [...(categories ?? [])]
    .filter((c) => c.label !== "not_food")
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((c) => ({ label: c.label, score: Math.round(c.score * 100) / 100, dishId: suggestionFor(c.label) }));
}

/** Centre square of a frame (the viewfinder box). The classifier only ever sees this part. */
export function centreSquare(width, height, fraction = 0.8) {
  const side = Math.round(Math.min(width, height) * fraction);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}
