// The eye cursor's decisions, without the page, so they can be tested on their own
// (tests/eye-cursor.test.mjs). Points and sizes are fractions of the screen, the same frame the
// calibration measured accuracy in.

/**
 * How open the eyes are: the lid gap over the eye's width, averaged over both eyes, in pixels of
 * the camera image. null when the face points are missing.
 */
export function eyeOpenness(face, width = 640, height = 480) {
  if (!Array.isArray(face) || face.length < 468) return null;
  const d = (a, b) => (face[a] && face[b] ? Math.hypot((face[a].x - face[b].x) * width, (face[a].y - face[b].y) * height) : NaN);
  const right = d(33, 133), left = d(362, 263);
  const open = (d(159, 145) / right + d(386, 374) / left) / 2;
  return right > 0 && left > 0 && Number.isFinite(open) ? open : null;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/**
 * A slow, deliberate blink is a click; a natural blink is not. Natural blinks close the eyes for
 * about 0.1 to 0.3 s, but in 42 minutes of public blink videos (Eyeblink8, TalkingFace) 1 natural
 * closure in 10 lasted 0.4 s or more: a 0.4 s minimum clicked about once a minute with nobody
 * trying, 0.7 s about once in 3.5 minutes (docs/validation/PUBLIC_DATA_VALIDATION.md). So a click
 * needs both eyes closed for minMs (0.7 s) to maxMs. Longer closures are
 * resting the eyes, not a click. The eyes must have been open for openMs first, and "closed" is
 * measured against this person's own open eyes over the last few seconds, not a fixed number.
 */
export const SLOW_BLINK_MIN_MS = 700;
export class LongBlink {
  constructor({ minMs = SLOW_BLINK_MIN_MS, maxMs = 1600, openMs = 300 } = {}) {
    this.opts = { minMs, maxMs, openMs };
    this.reset();
  }
  reset() {
    this.samples = [];
    this.ref = null;
    this.closedAt = null;
    this.openSince = null;
    this.lastT = null;
  }
  /** True while the eyes are closed in what may become a click. */
  get closing() {
    return this.closedAt !== null;
  }
  /**
   * openness from eyeOpenness (null when the face is lost). Returns null, or what just ended:
   * { kind: "click" | "short" | "long", ms, closedAt }.
   */
  update(openness, t) {
    const gap = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    if (openness === null || !Number.isFinite(openness) || gap > 1000 || gap < 0) {
      // No face, or a stall: nothing is measured across it.
      this.closedAt = null;
      this.openSince = null;
      return null;
    }
    const ref = this.ref;
    const isClosed = ref !== null && openness < ref * 0.5;
    const isOpen = ref === null || openness > ref * 0.7;
    if (this.closedAt === null) {
      if (isClosed) {
        if (this.openSince !== null && t - this.openSince >= this.opts.openMs) this.closedAt = t;
        else this.openSince = null;
        return null;
      }
      if (isOpen) {
        this.openSince ??= t;
        this.samples.push({ t, v: openness });
        this.samples = this.samples.filter((s) => t - s.t <= 3000);
        if (this.samples.length >= 5) this.ref = median(this.samples.map((s) => s.v));
      }
      return null;
    }
    if (!isOpen) return null;
    const ms = t - this.closedAt;
    const closedAt = this.closedAt;
    this.closedAt = null;
    this.openSince = t;
    return { kind: ms < this.opts.minMs ? "short" : ms > this.opts.maxMs ? "long" : "click", ms, closedAt };
  }
}

/**
 * Where the eyes are resting. A fixation goes on while the gaze stays within `radius` of where it
 * settled (estimates that stray for less than graceMs are ignored), and its point is the average
 * over the fixation, steadier than any single estimate. With hold-to-click, progress fills only
 * while something clickable is near, so resting the eyes on text never clicks. After a click the
 * fixation is held: nothing more happens until the eyes move somewhere else.
 */
export class Fixation {
  constructor({ dwellMs = 1200, radius = 0.08, graceMs = 400 } = {}) {
    this.opts = { dwellMs, radius, graceMs };
    this.reset();
  }
  reset() {
    // A click's hold outlasts losing the eyes (a slow blink is how the click was made).
    this.pendingHold = !!(this.held || this.pendingHold);
    this.point = null;
    this.n = 0;
    this.sx = this.sy = 0;
    this.since = 0;
    this.outSince = null;
    this.progress = 0;
    this.held = false;
  }
  hold() {
    this.held = true;
    this.progress = 0;
    if (!this.point) this.pendingHold = true;
  }
  start(p, t) {
    this.point = { x: p.x, y: p.y };
    this.n = 1;
    this.sx = p.x;
    this.sy = p.y;
    this.since = t;
    this.outSince = null;
    this.progress = 0;
    this.held = !!this.pendingHold;
    this.pendingHold = false;
  }
  /** Returns true once, when a held look completes. */
  update(p, t, hasTarget) {
    if (!this.point) {
      this.start(p, t);
      return false;
    }
    if (Math.hypot(p.x - this.point.x, p.y - this.point.y) > this.opts.radius) {
      this.outSince ??= t;
      if (t - this.outSince >= this.opts.graceMs) this.start(p, t);
      return false;
    }
    this.outSince = null;
    // A long fixation keeps averaging only its recent part, so it can follow a slow drift.
    if (this.n >= 30) {
      this.sx *= 29 / 30;
      this.sy *= 29 / 30;
      this.n = 29;
    }
    this.n++;
    this.sx += p.x;
    this.sy += p.y;
    this.point = { x: this.sx / this.n, y: this.sy / this.n };
    if (this.held || !hasTarget) {
      this.since = t;
      this.progress = 0;
      return false;
    }
    this.progress = Math.min(1, (t - this.since) / this.opts.dwellMs);
    if (this.progress < 1) return false;
    this.hold();
    return true;
  }
}

/**
 * Clickable things within `radius` of a point, nearest first. Distance is to the nearest edge of
 * each, so the point inside a button is distance 0. Several within reach means the gaze can't
 * tell them apart at this person's accuracy, and the cursor asks which one with big tiles.
 */
export function nearTargets(targets, point, radius) {
  if (!point) return [];
  return targets
    .map((t) => {
      const dx = Math.max(t.x - point.x, 0, point.x - (t.x + t.w));
      const dy = Math.max(t.y - point.y, 0, point.y - (t.y + t.h));
      return { target: t, d: Math.hypot(dx, dy) };
    })
    .filter((c) => c.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map((c) => c.target);
}

/**
 * Where the eyes were resting just before they began to close: the average over spanMs, leaving out
 * the last leadMs (lids coming down drag the estimate). null when the eyes were still moving then
 * (spread beyond `radius`), because a blink right after a glance would click the wrong thing.
 */
export function pointBefore(trail, t, { leadMs = 150, spanMs = 350, radius = 0.08 } = {}) {
  const end = t - leadMs;
  const span = trail.filter((p) => p.t <= end && p.t >= end - spanMs);
  if (!span.length) return null;
  const x = span.reduce((s, p) => s + p.x, 0) / span.length, y = span.reduce((s, p) => s + p.y, 0) / span.length;
  return span.every((p) => Math.hypot(p.x - x, p.y - y) <= radius) ? { x, y } : null;
}

/** The tile (screen-fraction rect) the eyes had settled on just before a blink, or null. */
export function tileBefore(trail, rects, t, opts) {
  const p = pointBefore(trail, t, opts);
  return p ? (rects.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.id ?? null) : null;
}

/** Plain words for where something is on the screen, to tell two "Start camera" buttons apart. */
export function placeOf(t) {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  const v = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : "middle";
  const h = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "";
  return v === "middle" && !h ? "middle" : `${v}${h ? " " + h : ""}`;
}
