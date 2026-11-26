import test from "node:test";
import assert from "node:assert/strict";
import { assessFrame, projectPoint, statusLabel, trackingModules, landmarkCounts, LANDMARK_MAX, requirements, relevantPoseIndices, poseRate, SLOW_POSE_FPS } from "../src/features/move/tracking.js";
import { createDetector, fingerOpenness, isTracked, isExperimental, detectorKind } from "../src/features/move/detectors.js";
import { EXERCISES } from "../src/features/move/catalog.js";
import { LESSONS, VIEWPOINTS, lessonFor } from "../src/features/move/lessons.js";
import { DEMOS, demoAt, keyPoses, loopMs, demoShapes } from "../src/features/move/demo.js";

// ---------- Synthetic landmark builders (no camera, no model) ----------
const pose = (pts = {}, base = 0.9) => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: base }));
  for (const [i, p] of Object.entries(pts)) lm[i] = { z: 0, visibility: base, ...p };
  return lm;
};
// Left side, standing side-on: shoulder 11, hip 23, knee 25, ankle 27, heel 29, foot 31.
const standingLeft = (over = {}) => pose({ 11: { x: 0.5, y: 0.25 }, 13: { x: 0.52, y: 0.4 }, 15: { x: 0.53, y: 0.52 }, 23: { x: 0.5, y: 0.52 }, 25: { x: 0.52, y: 0.7 }, 27: { x: 0.5, y: 0.88 }, 29: { x: 0.47, y: 0.9 }, 31: { x: 0.56, y: 0.9 }, ...over });
const frame = (extra = {}) => ({ timestampMs: 1000, videoSize: { width: 640, height: 480 }, pose: standingLeft(), poseAt: 1000, personCount: 1, face: null, hands: [], luma: 0.5, ...extra });

function hand(k, { dx = 0, handedness = "Right", out = false } = {}) {
  const wrist = { x: 0.5 + dx, y: 0.8 };
  const pts = [wrist];
  const xs = [0.44, 0.48, 0.52, 0.56];
  pts.push(...[1, 2, 3, 4].map((j) => ({ x: 0.42 + dx - j * 0.02, y: 0.75 - j * 0.02 })));
  for (const x of xs) {
    const mcp = { x: x + dx, y: 0.6 }, tipY = 0.66 - k * 0.26;
    pts.push(mcp, { x: x + dx, y: 0.6 + (tipY - 0.6) * 0.4 }, { x: x + dx, y: 0.6 + (tipY - 0.6) * 0.7 }, { x: x + dx, y: out ? -0.05 : tipY });
  }
  return { handedness, score: 0.95, landmarks: pts.map((p) => ({ ...p, z: 0 })) };
}

test("Mirroring and cover-crop: overlay points land exactly where the mirrored video shows them", () => {
  const view = { videoWidth: 640, videoHeight: 480, boxWidth: 400, boxHeight: 400 };
  const plain = projectPoint({ x: 0.25, y: 0.5 }, view);
  const mirrored = projectPoint({ x: 0.25, y: 0.5 }, { ...view, mirrored: true });
  assert.ok(Math.abs(plain.x - 66.67) < 0.01, "a 4:3 frame in a square box is cropped at the sides");
  assert.equal(plain.y, 200);
  assert.ok(Math.abs(mirrored.x - (400 - plain.x)) < 1e-9, "mirroring swaps left and right inside the box");
  const centre = projectPoint({ x: 0.5, y: 0.5 }, { ...view, mirrored: true });
  assert.deepEqual(centre, { x: 200, y: 200 });
  const wide = projectPoint({ x: 0, y: 0 }, { videoWidth: 640, videoHeight: 480, boxWidth: 1280, boxHeight: 720 });
  assert.equal(wide.x, 0);
  assert.equal(wide.y, -120, "a 4:3 frame in a 16:9 box is cropped top and bottom");
});

test("Left/right mirroring of the input never changes a count (angles don't depend on mirroring)", () => {
  const play = (mirror) => {
    const d = createDetector("chair_squat");
    let reps = 0, t = 0;
    const seq = [...Array(12).fill(0), ...Array.from({ length: 10 }, (_, i) => i / 9), ...Array(6).fill(1), ...Array.from({ length: 10 }, (_, i) => 1 - i / 9), ...Array(12).fill(0)];
    for (const k of seq) {
      const knee = { x: 0.52 + 0.08 * k, y: 0.7 }, hip = { x: 0.5 - 0.2 * k, y: 0.52 + 0.1 * k };
      let lm = standingLeft({ 23: hip, 25: knee });
      if (mirror) lm = lm.map((p) => ({ ...p, x: 1 - p.x }));
      reps += d.update({ landmarks: lm, personCount: 1, timestamp: (t += 50), width: 1, height: 1 }).counted ? 1 : 0;
    }
    return reps;
  };
  assert.equal(play(false), 1);
  assert.equal(play(true), 1);
});

test("Tracking status is truthful: ready, partial view, occlusion, no person, lost, off, multiple people", () => {
  const ready = assessFrame(frame(), "chair_squat", { now: 1000 });
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.points.map((p) => p.name), ["left_hip", "left_knee", "left_ankle"]);
  const feetOut = assessFrame(frame({ pose: standingLeft({ 27: { x: 0.5, y: 1.04 }, 28: { x: 0.5, y: 1.04, visibility: 0.1 } }) }), "chair_squat", { now: 1000 });
  assert.equal(feetOut.status, "PARTIAL_VIEW");
  assert.match(feetOut.hint.en, /Move farther back so I can see your hips and ankles/);
  assert.ok(feetOut.hint.bn.length > 5);
  const occluded = assessFrame(frame({ pose: standingLeft({ 25: { x: 0.52, y: 0.7, visibility: 0.2 }, 26: { x: 0.52, y: 0.7, visibility: 0.1 } }) }), "chair_squat", { now: 1000 });
  assert.equal(occluded.status, "LOW_CONFIDENCE");
  assert.equal(occluded.points.find((p) => p.name.endsWith("knee")).visible, false, "an occluded knee is reported, never filled in");
  assert.equal(assessFrame(frame({ pose: null }), "chair_squat", { now: 1000 }).status, "NO_PERSON");
  assert.equal(assessFrame(frame(), "chair_squat", { now: 2500 }).status, "TRACKING_LOST");
  assert.equal(assessFrame(frame(), "chair_squat", { now: 1000, cameraOn: false }).status, "OFF");
  assert.equal(assessFrame(frame({ personCount: 2 }), "chair_squat", { now: 1000 }).status, "LOW_CONFIDENCE");
  const dark = assessFrame(frame({ luma: 0.05 }), "chair_squat", { now: 1000 });
  assert.equal(dark.status, "LOW_CONFIDENCE");
  assert.match(dark.hint.en, /too dark/);
});

test("Face and hand prerequisites: head turn, partial face, hand out of frame, hand too far", () => {
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const f = (extra) => frame({ pose: null, face, faceValid: true, faceAt: 1000, blendshapes: { mouthSmileLeft: 0.1 }, head: { yaw: 0, pitch: 0 }, ...extra });
  assert.equal(assessFrame(f(), "smile", { now: 1000 }).status, "READY");
  assert.match(assessFrame(f({ head: { yaw: 35, pitch: 0 } }), "smile", { now: 1000 }).hint.en, /straight on/);
  const cut = face.map((p, i) => (i === 152 ? { ...p, y: 1.02 } : p));
  assert.equal(assessFrame(f({ face: cut }), "smile", { now: 1000 }).status, "PARTIAL_VIEW");
  assert.equal(assessFrame(f({ face: null }), "smile", { now: 1000 }).status, "NO_PERSON");
  const h = (hands) => frame({ pose: null, hands, handsAt: 1000 });
  assert.equal(assessFrame(h([hand(1)]), "finger_opening", { now: 1000 }).status, "READY");
  assert.equal(assessFrame(h([hand(1, { out: true })]), "finger_opening", { now: 1000 }).status, "PARTIAL_VIEW");
  assert.equal(assessFrame(h([]), "finger_opening", { now: 1000 }).status, "NO_PERSON");
});

test("Status labels: only a ready camera view is called live tracking", () => {
  assert.equal(statusLabel("READY").en, "Live on-device tracking");
  for (const s of ["NO_PERSON", "PARTIAL_VIEW", "LOW_CONFIDENCE", "TRACKING_LOST"]) assert.equal(statusLabel(s).en, "Tracking uncertain");
  assert.equal(statusLabel("READY", { cameraOn: false }).en, "Camera off");
  assert.equal(statusLabel("READY", { mode: "manual" }).en, "Manual mode");
  assert.equal(statusLabel("READY").bn, "ডিভাইসেই লাইভ ট্র্যাকিং");
});

test("Model router: pose for body work, hands for fingers, all three only when showing every landmark", () => {
  assert.deepEqual(trackingModules("squat"), { kind: "pose", pose: true, hands: false, face: true });
  assert.deepEqual(trackingModules("smile"), { kind: "face", pose: false, hands: false, face: true });
  assert.deepEqual(trackingModules("finger_opening"), { kind: "hands", pose: false, hands: true, face: true });
  assert.deepEqual(trackingModules("smile", true), { kind: "face", pose: true, hands: true, face: true });
  assert.equal(LANDMARK_MAX.total, 553);
  const all = landmarkCounts(frame({ face: Array(478).fill({ x: 0.5, y: 0.5 }), hands: [hand(1), hand(1, { handedness: "Left" })], handsAt: 1000 }));
  assert.deepEqual(all, { pose: 33, face: 478, hands: 42, total: 553 });
  assert.deepEqual(landmarkCounts(frame({ face: null, hands: [] })), { pose: 33, face: 0, hands: 0, total: 33 }, "never implies 553 when face or hands are out of view");
  assert.deepEqual(relevantPoseIndices("arm_raise").sort((a, b) => a - b), [11, 12, 13, 14, 23, 24]);
  assert.deepEqual(requirements("heel_raise").parts, ["knee", "ankle", "heel", "foot"]);
});

test("Finger opening: one full open-close counts exactly once; a half-open hand and cut-off fingertips never count", () => {
  assert.ok(fingerOpenness(hand(1).landmarks) > 1.7);
  assert.ok(fingerOpenness(hand(0).landmarks) < 1.2);
  const run = (seq, opts = {}) => {
    const d = createDetector("finger_opening");
    let t = 0, counted = 0, partial = 0;
    for (const k of seq) {
      const r = d.update({ hands: [hand(k, opts)], timestamp: (t += 50), width: 1, height: 1 });
      counted += r.counted ? 1 : 0;
      partial += r.event === "partial" ? 1 : 0;
    }
    return { counted, partial };
  };
  const cycle = [...Array(8).fill(0), ...Array.from({ length: 8 }, (_, i) => i / 7), ...Array(8).fill(1), ...Array.from({ length: 8 }, (_, i) => 1 - i / 7), ...Array(10).fill(0)];
  assert.deepEqual(run(cycle), { counted: 1, partial: 0 });
  const half = cycle.map((k) => k * 0.6);
  assert.deepEqual(run(half), { counted: 0, partial: 1 });
  assert.equal(run(cycle, { out: true }).counted, 0);
  // Two hands in view: the detector stays with one, so the second can't add a count.
  const d = createDetector("finger_opening");
  let t = 0, counted = 0;
  for (const k of cycle) counted += d.update({ hands: [hand(k), hand(k, { dx: 0.3, handedness: "Left" })], timestamp: (t += 50) }).counted ? 1 : 0;
  assert.equal(counted, 1);
});

test("Camera-timed plank: holding only while a straight, leaning body line is seen", () => {
  const d = createDetector("supported_plank");
  const plank = (over = {}) => ({ landmarks: pose({ 11: { x: 0.3, y: 0.4 }, 23: { x: 0.5, y: 0.55 }, 25: { x: 0.7, y: 0.7 }, ...over }), personCount: 1, width: 1, height: 1 });
  let r = d.update({ ...plank(), timestamp: 0 });
  assert.equal(r.holding, false, "settles before the timer starts");
  r = d.update({ ...plank(), timestamp: 400 });
  assert.equal(r.holding, true);
  r = d.update({ ...plank({ 23: { x: 0.5, y: 0.66 } }), timestamp: 500 });
  assert.equal(r.holding, false, "sagging hips stop the timer");
  assert.match(r.reason, /straight line/);
  const standing = d.update({ landmarks: standingLeft(), personCount: 1, timestamp: 600, width: 1, height: 1 });
  assert.equal(standing.holding, false, "standing upright is a straight line but not a plank");
  const hidden = d.update({ ...plank({ 25: { x: 0.7, y: 0.7, visibility: 0.1 }, 26: { x: 0.7, y: 0.7, visibility: 0.1 } }), timestamp: 700 });
  assert.equal(hidden.valid, false, "an occluded knee is never assumed to be in line");
});

test("Heel raise (experimental): learns flat feet first, counts one full raise, ignores hidden feet", () => {
  const d = createDetector("heel_raise");
  const at = (lift, vis = 0.9) => standingLeft({ 29: { x: 0.47, y: 0.9 - lift, visibility: vis }, 31: { x: 0.56, y: 0.9, visibility: vis }, 25: { x: 0.5, y: 0.6 }, 27: { x: 0.5, y: 0.85 } });
  let t = 0, counted = 0, calibrating = 0;
  const seq = [...Array(30).fill(0), ...Array.from({ length: 8 }, (_, i) => (0.04 * i) / 7), ...Array(8).fill(0.04), ...Array.from({ length: 8 }, (_, i) => 0.04 - (0.04 * i) / 7), ...Array(10).fill(0)];
  for (const lift of seq) {
    const r = d.update({ landmarks: at(lift), personCount: 1, timestamp: (t += 50), width: 1, height: 1 });
    counted += r.counted ? 1 : 0;
    calibrating += r.phase === "calibrating" ? 1 : 0;
  }
  assert.ok(calibrating >= 15, "the first ~0.8 s learns the person's own flat-foot value");
  assert.equal(counted, 1);
  const hidden = createDetector("heel_raise");
  t = 0;
  let any = 0;
  for (const lift of seq) any += hidden.update({ landmarks: at(lift, 0.2), personCount: 1, timestamp: (t += 50), width: 1, height: 1 }).counted ? 1 : 0;
  assert.equal(any, 0);
  assert.ok(isExperimental("heel_raise") && isExperimental("supported_plank") && isExperimental("finger_opening"));
  assert.equal(detectorKind("finger_opening"), "hands");
});

test("Every exercise has a bilingual lesson, a 5-15 s demonstration and captions in step with it", () => {
  for (const id of Object.keys(EXERCISES)) {
    const lesson = lessonFor(id);
    assert.ok(DEMOS[id], `${id} demo`);
    const ms = loopMs(id);
    assert.ok(ms >= 5000 && ms <= 15000, `${id} loop is ${ms} ms`);
    assert.equal(lesson.captions.en.length, lesson.captions.bn.length, `${id} captions in both languages`);
    const caps = new Set(DEMOS[id].segments.map((s) => s.cap));
    for (const c of caps) assert.ok(lesson.captions.en[c] && lesson.captions.bn[c], `${id} caption ${c}`);
    assert.equal(caps.size, lesson.captions.en.length, `${id}: every caption is shown during the loop`);
    for (const text of [lesson.goal, lesson.space, lesson.easier, lesson.keyTip, ...lesson.cautions]) {
      assert.ok(text.en.length > 3, id);
      assert.match(text.bn, /[ঀ-৿]/, `${id} Bangla text`);
    }
    for (const c of lesson.captions.bn) assert.match(c, /[ঀ-৿]/);
    assert.ok(VIEWPOINTS[lesson.viewpoint], `${id} viewpoint`);
    assert.ok(keyPoses(id).length >= 2, `${id} has still key poses for reduced motion`);
    if (isTracked(id)) assert.ok(lesson.practice >= 1, `${id} tracked exercises are practised first`);
    // Shapes are finite numbers: nothing renders NaN.
    for (const k of [0, 0.33, 0.66]) for (const s of demoShapes(demoAt(id, k * ms))) for (const v of Object.values(s)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${id} shape`);
  }
  assert.equal(demoAt("smile", 0).cap, 0);
  assert.equal(demoAt("smile", loopMs("smile") + 10).cap, 0, "the loop wraps");
});

test("Lessons make no promised body changes", () => {
  const all = JSON.stringify(LESSONS).toLowerCase();
  for (const banned of ["burn fat", "lose fat", "slim", "sculpt", "tone your", "calorie", "guarantee", "cure"]) assert.ok(!all.includes(banned), banned);
});

test("A phone reading the body too slowly gets a notice, but tracking stays ready", () => {
  const every = (ms, n) => Array.from({ length: n }, (_, i) => 10000 + i * ms);
  assert.equal(poseRate(every(50, 10), 10450), null, "under 2 s of readings: no judgement yet");
  assert.ok(Math.abs(poseRate(every(50, 60), 10000 + 59 * 50) - 20) < 0.01);
  assert.ok(poseRate(every(133, 23), 10000 + 22 * 133) < SLOW_POSE_FPS);
  const slow = assessFrame(frame(), "chair_squat", { now: 1000, poseFps: 7.5 });
  assert.equal(slow.status, "READY");
  assert.match(slow.notice.en, /slowly/);
  assert.ok(slow.notice.bn);
  assert.equal(assessFrame(frame(), "chair_squat", { now: 1000, poseFps: 20 }).notice, null);
  assert.equal(assessFrame(frame(), "chair_squat", { now: 1000 }).notice, null);
});
