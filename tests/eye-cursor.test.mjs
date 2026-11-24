// The eye cursor's decisions: a slow blink clicks and a natural one doesn't, a held look fills only
// near something clickable and never twice in one place, and close buttons are all "in reach".
import assert from "node:assert/strict";
import test from "node:test";
import { Fixation, LongBlink, eyeOpenness, nearTargets, placeOf, pointBefore, tileBefore } from "../src/features/eyespeak/cursor-logic.js";

// Eyes open for `openMs`, then closed for `closedMs`, sampled every `frameMs`.
function run(detector, steps, frameMs = 33) {
  const events = [];
  let t = 0;
  for (const [state, ms] of steps) {
    for (const end = t + ms; t < end; t += frameMs) {
      const e = detector.update(state === "open" ? 0.3 + (Math.sin(t) * 0.01) : 0.04, t);
      if (e) events.push(e);
    }
  }
  return events;
}

test("eye openness is the lid gap over the eye width, from the face points", () => {
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const put = (i, x, y) => (face[i] = { x, y });
  put(33, 0.4, 0.4), put(133, 0.46, 0.4), put(159, 0.43, 0.39), put(145, 0.43, 0.41);
  put(362, 0.54, 0.4), put(263, 0.6, 0.4), put(386, 0.57, 0.39), put(374, 0.57, 0.41);
  const open = eyeOpenness(face, 640, 480);
  assert.ok(Math.abs(open - (0.02 * 480) / (0.06 * 640)) < 1e-9);
  assert.equal(eyeOpenness(null), null);
  assert.equal(eyeOpenness(face.slice(0, 400)), null);
});

test("a slow blink clicks; natural blinks and resting the eyes do not", () => {
  const b = new LongBlink();
  const events = run(b, [["open", 1500], ["closed", 150], ["open", 800], ["closed", 250], ["open", 800], ["closed", 900], ["open", 800], ["closed", 3000], ["open", 500]]);
  assert.deepEqual(events.map((e) => e.kind), ["short", "short", "click", "long"]);
  const click = events.find((e) => e.kind === "click");
  assert.ok(click.ms >= 860 && click.ms <= 940, `measured ${click.ms} ms`);
});

test("a long natural blink (0.4 to 0.7 s) is not a click (public-data validation)", () => {
  const b = new LongBlink();
  const events = run(b, [["open", 1500], ["closed", 450], ["open", 800], ["closed", 600], ["open", 800]]);
  assert.deepEqual(events.map((e) => e.kind), ["short", "short"]);
});

test("a slow blink is still seen on a slow device (5 face results per second)", () => {
  const b = new LongBlink();
  const events = run(b, [["open", 2000], ["closed", 200], ["open", 1000], ["closed", 1000], ["open", 600]], 200);
  assert.deepEqual(events.map((e) => e.kind), ["short", "click"]);
});

test("no click before the eyes have been seen open, or across a gap in tracking", () => {
  const b = new LongBlink();
  assert.deepEqual(run(b, [["closed", 600], ["open", 300]]), [], "no reference for open eyes yet");
  const c = new LongBlink();
  run(c, [["open", 1500]]);
  c.update(0.04, 1500);
  assert.equal(c.closing, true);
  assert.equal(c.update(null, 1600), null, "face lost");
  assert.equal(c.closing, false);
  assert.equal(c.update(0.3, 2100), null, "reopening after a lost face is not a click");
});

test("a held look fills only near something clickable and clicks once per place", () => {
  const f = new Fixation({ dwellMs: 1000, radius: 0.06, graceMs: 300 });
  let t = 0;
  const hold = (p, ms, hasTarget) => {
    let fired = 0;
    for (const end = t + ms; t < end; t += 33) fired += f.update({ x: p.x + (Math.random() - 0.5) * 0.02, y: p.y + (Math.random() - 0.5) * 0.02 }, t, hasTarget) ? 1 : 0;
    return fired;
  };
  assert.equal(hold({ x: 0.3, y: 0.3 }, 3000, false), 0, "reading text never clicks");
  assert.equal(hold({ x: 0.3, y: 0.3 }, 1200, true), 1, "a button in reach is clicked after the selection time");
  assert.equal(hold({ x: 0.3, y: 0.3 }, 3000, true), 0, "staying on it doesn't click again");
  assert.equal(hold({ x: 0.7, y: 0.3 }, 1500, true), 1, "a new place clicks again (after the move settles)");
});

test("one stray estimate doesn't restart a held look, but moving away does", () => {
  const f = new Fixation({ dwellMs: 1000, radius: 0.06, graceMs: 300 });
  for (let t = 0; t < 600; t += 33) f.update({ x: 0.5, y: 0.5 }, t, true);
  f.update({ x: 0.9, y: 0.9 }, 633, true);
  let fired = false;
  for (let t = 666; t < 1100; t += 33) fired ||= f.update({ x: 0.5, y: 0.5 }, t, true);
  assert.ok(fired, "the fill carried on through the stray estimate");
  const g = new Fixation({ dwellMs: 1000, radius: 0.06, graceMs: 300 });
  for (let t = 0; t < 600; t += 33) g.update({ x: 0.5, y: 0.5 }, t, true);
  for (let t = 600; t < 1000; t += 33) g.update({ x: 0.8, y: 0.5 }, t, true);
  assert.ok(Math.abs(g.point.x - 0.8) < 0.02 && g.progress < 0.2, "a new fixation started where the eyes went");
});

test("a click's hold outlasts losing the eyes, so a slow blink doesn't click twice", () => {
  const f = new Fixation({ dwellMs: 800, radius: 0.06, graceMs: 300 });
  f.update({ x: 0.5, y: 0.5 }, 0, true);
  f.hold();
  f.reset();
  let fired = false;
  for (let t = 1000; t < 3000; t += 33) fired ||= f.update({ x: 0.5, y: 0.5 }, t, true);
  assert.equal(fired, false);
});

test("buttons within reach are listed nearest first; inside a button is distance 0", () => {
  const targets = [
    { id: "a", x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
    { id: "b", x: 0.1, y: 0.17, w: 0.1, h: 0.05 },
    { id: "c", x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
  ];
  assert.deepEqual(nearTargets(targets, { x: 0.15, y: 0.12 }, 0.09).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(nearTargets(targets, { x: 0.7, y: 0.7 }, 0.09).map((t) => t.id), ["c"]);
  assert.deepEqual(nearTargets(targets, { x: 0.4, y: 0.4 }, 0.09), []);
});

test("the point before a blink skips the moment the lids came down", () => {
  const trail = [];
  for (let t = 0; t <= 1000; t += 50) trail.push({ x: 0.5, y: t > 850 ? 0.9 : 0.3, t });
  const p = pointBefore(trail, 1000);
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.3) < 1e-9);
  assert.equal(pointBefore([], 1000), null);
});

test("a blink right after a glance clicks nothing: the eyes hadn't settled", () => {
  const trail = [];
  for (let t = 0; t <= 1000; t += 33) trail.push({ x: t < 700 ? 0.2 : 0.7, y: 0.5, t });
  assert.equal(pointBefore(trail, 900), null, "moving from 0.2 to 0.7 just before the blink");
  assert.ok(pointBefore(trail, 1300), "settled for long enough");
  const rects = [{ id: "water", x: 0, y: 0, w: 0.4, h: 1 }, { id: "yes", x: 0.6, y: 0, w: 0.4, h: 1 }];
  assert.equal(tileBefore(trail, rects, 900), null, "between Water and Yes: no choice");
  assert.equal(tileBefore(trail, rects, 1300), "yes");
  assert.equal(tileBefore(trail, rects, 600), "water");
  assert.equal(tileBefore([{ t: 0, x: 0.5, y: 0.5 }], rects, 300), null, "in the gap between tiles");
});

test("places are said in plain words", () => {
  assert.equal(placeOf({ x: 0, y: 0, w: 0.2, h: 0.05 }), "top left");
  assert.equal(placeOf({ x: 0.4, y: 0.45, w: 0.2, h: 0.1 }), "middle");
  assert.equal(placeOf({ x: 0.8, y: 0.9, w: 0.1, h: 0.05 }), "bottom right");
});
