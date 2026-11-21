import test from "node:test";
import assert from "node:assert/strict";
import { createDetector, PhaseCounter, jointAngle, isTracked, detectorKind, POSE_RULES, FACE_RULES } from "../src/features/move/detectors.js";
import { EXERCISES } from "../src/features/move/catalog.js";

const FPS = 20;
const DT = 1000 / FPS;

function blank(visible = "left") {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, visibility: i % 2 === (visible === "left" ? 1 : 0) ? 0.95 : 0.2 }));
}

/** Side view with the left leg visible: shin vertical, thigh rotated to give knee angle `deg`. */
function legFrame(deg, t, { visibility = 0.95, people = 1 } = {}) {
  const lm = blank();
  const knee = { x: 0.5, y: 0.65 }, r = (deg * Math.PI) / 180;
  const hip = { x: knee.x + 0.25 * Math.sin(r), y: knee.y + 0.25 * Math.cos(r) };
  const set = (i, p) => (lm[i] = { ...p, visibility });
  set(27, { x: 0.5, y: 0.9 });
  set(25, knee);
  set(23, hip);
  set(11, { x: hip.x - 0.02, y: hip.y - 0.28 });
  return { landmarks: lm, personCount: people, timestamp: t, width: 1, height: 1 };
}

/** Side view, left arm: elbow angle `deg` with the upper arm horizontal toward the wall. */
function elbowFrame(deg, t) {
  const lm = blank();
  const shoulder = { x: 0.4, y: 0.4 }, elbow = { x: 0.6, y: 0.4 }, r = (deg * Math.PI) / 180;
  const wrist = { x: elbow.x - 0.18 * Math.cos(r), y: elbow.y - 0.18 * Math.sin(r) };
  for (const [i, p] of [[11, shoulder], [13, elbow], [15, wrist], [23, { x: 0.4, y: 0.7 }]]) lm[i] = { ...p, visibility: 0.95 };
  return { landmarks: lm, personCount: 1, timestamp: t, width: 1, height: 1 };
}

/** Front view: the right arm raised `deg` from the side of the body; the left arm stays down. */
function armFrame(deg, t) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
  const r = (deg * Math.PI) / 180;
  const put = (side, a) => {
    const sx = side === "left" ? 0.6 : 0.4, dir = side === "left" ? 1 : -1;
    const s = { x: sx, y: 0.3 };
    lm[side === "left" ? 11 : 12] = { ...s, visibility: 0.95 };
    lm[side === "left" ? 23 : 24] = { x: sx, y: 0.65, visibility: 0.95 };
    lm[side === "left" ? 13 : 14] = { x: s.x + dir * 0.15 * Math.sin(a), y: s.y + 0.15 * Math.cos(a), visibility: 0.95 };
  };
  put("left", (8 * Math.PI) / 180);
  put("right", r);
  return { landmarks: lm, personCount: 1, timestamp: t, width: 1, height: 1 };
}

/** Run a list of [value, ms] segments through a frame builder; returns all detector results. */
function run(detector, build, segments, t0 = 0) {
  const out = [];
  let t = t0;
  for (const [from, to, ms] of segments) {
    const n = Math.max(1, Math.round(ms / DT));
    for (let i = 0; i < n; i++) {
      out.push(detector.update(build(from + ((to - from) * i) / Math.max(1, n - 1), t)));
      t += DT;
    }
  }
  return { out, t };
}

const squatRep = [[178, 178, 500], [178, 100, 900], [100, 100, 400], [100, 178, 900], [178, 178, 400]];

test("Every camera-tracked catalog exercise has a detector and every detector has a catalog entry", () => {
  for (const id of [...Object.keys(POSE_RULES), ...Object.keys(FACE_RULES)]) {
    assert.ok(EXERCISES[id], id);
    assert.equal(EXERCISES[id].trackingMethod, detectorKind(id) === "pose" ? "pose_landmarks" : "face_blendshape", id);
  }
  for (const e of Object.values(EXERCISES)) assert.equal(isTracked(e.id), e.trackingMethod !== "manual" && e.trackingMethod !== "clinician_record", e.id);
  assert.ok(Object.keys(POSE_RULES).length >= 3 && Object.keys(FACE_RULES).length >= 2);
  assert.equal(createDetector("walk_log"), null);
});

test("jointAngle restores aspect ratio and refuses degenerate input", () => {
  assert.equal(Math.round(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })), 90);
  assert.equal(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
  assert.equal(jointAngle(null, { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test("Squat: full repetitions count once each, starting from timestamp 0", () => {
  const d = createDetector("squat");
  const { out } = run(d, legFrame, [...squatRep, ...squatRep, ...squatRep]);
  assert.equal(out.filter((r) => r.counted).length, 3);
  assert.equal(d.reps, 3);
  assert.ok(out.every((r) => r.valid));
});

test("Squat: a shallow dip is not counted and is reported as partial", () => {
  const d = createDetector("squat");
  const { out } = run(d, legFrame, [[178, 178, 500], [178, 135, 800], [135, 178, 800], [178, 178, 400]]);
  assert.equal(d.reps, 0);
  assert.ok(out.some((r) => r.event === "partial"));
  assert.match(out.find((r) => r.event === "partial").reason, /Not counted/);
});

test("Squat: losing sight of the leg mid-rep drops the unfinished repetition", () => {
  const d = createDetector("squat");
  let { t } = run(d, legFrame, [[178, 178, 500], [178, 100, 900]]);
  const lost = [];
  for (let i = 0; i < 20; i++, t += DT) lost.push(d.update(legFrame(100, t, { visibility: 0.2 })));
  assert.ok(lost.every((r) => !r.valid && /in view/.test(r.reason)));
  run(d, legFrame, [[100, 178, 900], [178, 178, 400]], t);
  assert.equal(d.reps, 0, "standing up after an occlusion is not a complete observed rep");
});

test("Pose: two people, an empty frame or a gap in frames never count", () => {
  const d = createDetector("chair_squat");
  assert.match(d.update(legFrame(178, 0, { people: 2 })).reason, /one person/);
  assert.match(d.update({ landmarks: [], timestamp: 50 }).reason, /Can't see your body/);
  // Down at 1 fps (gaps over 700 ms) is never stitched together into a repetition.
  for (const [i, deg] of [178, 178, 110, 110, 178, 178].entries()) d.update(legFrame(deg, 100 + i * 1000));
  assert.equal(d.reps, 0);
});

test("Chair squat, sit to stand, wall push-up and arm raise each count full movements", () => {
  const chair = createDetector("chair_squat");
  run(chair, legFrame, [[178, 178, 400], [178, 110, 900], [110, 110, 300], [110, 178, 900], [178, 178, 400]]);
  assert.equal(chair.reps, 1);

  const sts = createDetector("sit_to_stand");
  run(sts, legFrame, [[95, 95, 500], [95, 175, 1000], [175, 175, 300], [175, 95, 1000], [95, 95, 400]]);
  assert.equal(sts.reps, 1);

  const push = createDetector("wall_pushup");
  run(push, elbowFrame, [[170, 170, 400], [170, 95, 800], [95, 95, 300], [95, 170, 800], [170, 170, 400]]);
  assert.equal(push.reps, 1);

  const arm = createDetector("arm_raise");
  run(arm, armFrame, [[10, 10, 400], [10, 90, 800], [90, 90, 300], [90, 10, 800], [10, 10, 400]]);
  assert.equal(arm.reps, 1, "the raised right arm counts even though the left stays down");
});

const face = (signal, t, extra = {}) => ({ timestamp: t, faceVisible: true, yaw: 0, pitch: 0, blendshapes: { mouthSmileLeft: signal, mouthSmileRight: signal, browInnerUp: signal, browOuterUpLeft: signal, browOuterUpRight: signal, cheekPuff: signal }, ...extra });

test("Face: calibrates to the person's neutral face before counting, and needs the hold", () => {
  const d = createDetector("smile", { holdMs: 1000 });
  const { out, t } = run(d, face, [[0.05, 0.05, 1600]]);
  assert.ok(out.slice(0, 10).every((r) => r.phase === "calibrating"));
  assert.ok(!d.calibrating);
  // A quick flash of a smile, shorter than the hold, is not counted.
  const quick = run(d, face, [[0.05, 0.05, 300], [0.05, 0.6, 200], [0.6, 0.6, 300], [0.6, 0.05, 200], [0.05, 0.05, 400]], t);
  assert.equal(d.reps, 0);
  assert.ok(quick.out.some((r) => r.event === "partial"));
  run(d, face, [[0.05, 0.05, 300], [0.05, 0.6, 300], [0.6, 0.6, 1300], [0.6, 0.05, 300], [0.05, 0.05, 400]], quick.t);
  assert.equal(d.reps, 1);
});

test("Face: turning away or losing the face pauses counting", () => {
  const d = createDetector("eyebrow_raise", { holdMs: 500 });
  const { t } = run(d, face, [[0.05, 0.05, 1600]]);
  assert.match(d.update(face(0.05, t, { yaw: 35 })).reason, /straight on/);
  assert.match(d.update(face(0.05, t + 50, { faceVisible: false })).reason, /Can't see your face/);
  run(d, face, [[0.05, 0.05, 300], [0.05, 0.6, 300], [0.6, 0.6, 700], [0.6, 0.05, 300], [0.05, 0.05, 400]], t + 100);
  assert.equal(d.reps, 1);
});

test("Face: someone already smiling at the start is asked to relax instead of being mis-calibrated", () => {
  const d = createDetector("smile");
  const { out } = run(d, face, [[0.9, 0.9, 1700]]);
  assert.equal(out.at(-1).reason, "Relax your face to start");
  assert.ok(d.calibrating);
});

test("Cheek puff (experimental) counts a held puff", () => {
  const d = createDetector("cheek_puff", { holdMs: 800 });
  const { t } = run(d, face, [[0.02, 0.02, 1600]]);
  run(d, face, [[0.02, 0.02, 300], [0.02, 0.5, 300], [0.5, 0.5, 1000], [0.5, 0.02, 300], [0.02, 0.02, 400]], t);
  assert.equal(d.reps, 1);
});

test("PhaseCounter: an extra condition that never holds (e.g. hips didn't move) never counts", () => {
  const c = new PhaseCounter({ direction: "decrease", start: 160, target: 110, ret: 155 });
  let t = 0;
  for (const v of [170, 170, 170, 170, 170, 100, 100, 100, 100, 100, 170, 170, 170, 170, 170]) c.update(v, (t += 50), false);
  assert.equal(c.reps, 0);
  assert.throws(() => new PhaseCounter({ direction: "decrease", start: 100, target: 110, ret: 105 }));
});

test("Clinician-set angles and side replace the defaults, and unsafe ranges are refused", () => {
  // Default knee extension needs 155°; this clinician set a gentler 140° target.
  const gentle = createDetector("knee_extension", { limits: { start: 100, target: 140, return: 105 }, side: "left" });
  run(gentle, legFrame, [[95, 95, 500], [95, 145, 800], [145, 145, 300], [145, 95, 800], [95, 95, 400]]);
  assert.equal(gentle.reps, 1);
  const standard = createDetector("knee_extension");
  run(standard, legFrame, [[95, 95, 500], [95, 145, 800], [145, 145, 300], [145, 95, 800], [95, 95, 400]]);
  assert.equal(standard.reps, 0, "the same movement doesn't reach the default range");
  assert.throws(() => createDetector("knee_extension", { limits: { start: 140, target: 145, return: 150 } }));
  const rightOnly = createDetector("knee_extension", { side: "right" });
  assert.equal(rightOnly.update(legFrame(100, 0)).valid, false, "a fixed side is never swapped for the other leg");
});

test("Squat: one missed frame mid-rep (pose not found) doesn't drop the repetition; a long gap still does", () => {
  const d = createDetector("squat");
  let { t } = run(d, legFrame, [[178, 178, 500], [178, 100, 900]]);
  assert.equal(d.update({ landmarks: [], timestamp: t }).valid, false);
  t += DT;
  run(d, legFrame, [[100, 100, 300], [100, 178, 900], [178, 178, 400]], t);
  assert.equal(d.reps, 1, "a single empty frame is bridged");
});
