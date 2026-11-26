// What the camera can actually see, per exercise. The engine reports every landmark it detected
// (up to 33 body + 478 face + 21 per hand = 553 for one person); this module decides which of them
// matter for the current exercise, whether the view is good enough to count, and how to draw them
// over the mirrored, cropped video. It never fills in a point the models did not return.

import { POSE_RULES, FACE_RULES, HAND_RULES, HOLD_RULES } from "./detectors.js";

export const TRACKING_VERSION = "move-tracking/1.1.0";
export const STALE_MS = 1000;
export const MIN_VISIBILITY = 0.6;
export const MAX_HEAD_DEGREES = 20;
// Public-video checks (docs/MOVE_PUBLIC_VIDEO_VALIDATION.md) found counts start to be missed below
// about 12 body readings a second (7.5 a second lost reps). The app asks for 20 a second.
export const SLOW_POSE_FPS = 12;
export const SLOW_POSE_NOTICE = Object.freeze({
  en: "This phone is reading your movement slowly, so some reps may be missed. Close other apps or move slower.",
  bn: "এই ফোন আপনার নড়াচড়া ধীরে পড়ছে, তাই কিছু গণনা বাদ যেতে পারে। অন্য অ্যাপ বন্ধ করুন বা ধীরে করুন।",
});

/**
 * Body readings per second over the last `windowMs`, from the distinct pose timestamps seen.
 * Returns null until at least 2 seconds of readings exist, so a slow start is not reported.
 */
export function poseRate(times, now, windowMs = 3000) {
  const recent = (times ?? []).filter((t) => Number.isFinite(t) && t <= now && now - t <= windowMs);
  if (recent.length < 2) return null;
  const span = Math.max(...recent) - Math.min(...recent);
  if (span < 2000) return null;
  return (recent.length - 1) / (span / 1000);
}
export const LANDMARK_MAX = Object.freeze({ pose: 33, face: 478, hands: 42, total: 553 });

/** MediaPipe Pose Landmarker indices (BlazePose topology). */
export const POSE_NAMES = Object.freeze([
  "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
  "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
  "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle",
  "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]);
const POSE_INDEX = Object.fromEntries(POSE_NAMES.map((n, i) => [n, i]));
export const POSE_EDGES = Object.freeze([
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19],
  [17, 19], [16, 18], [16, 20], [18, 20], [0, 2], [0, 5], [2, 7], [5, 8], [9, 10],
]);
export const HAND_EDGES = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]);
/** Face mesh points that matter for expression practice: lips, brows, cheeks, jaw line. */
export const FACE_REGIONS = Object.freeze({
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  brows: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  cheeks: [50, 101, 118, 117, 123, 280, 330, 347, 346, 352],
  jaw: [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397],
});
/** A few outline points used to check that the whole face is inside the picture. */
const FACE_OUTLINE = [10, 152, 234, 454];

const BODY_WORDS = {
  shoulder: { en: "shoulders", bn: "কাঁধ" }, elbow: { en: "elbows", bn: "কনুই" }, wrist: { en: "wrists", bn: "কব্জি" },
  hip: { en: "hips", bn: "নিতম্ব" }, knee: { en: "knees", bn: "হাঁটু" }, ankle: { en: "ankles", bn: "গোড়ালির গাঁট" },
  heel: { en: "heels", bn: "গোড়ালি" }, foot: { en: "feet", bn: "পা" },
};
const LOWER = new Set(["knee", "ankle", "heel", "foot"]);

/** Which engine models an exercise needs. Face always runs: the shared camera keeps AAC blink requests alive. */
export function trackingModules(exerciseId, showAll = false) {
  const kind = exerciseId in HAND_RULES ? "hands" : exerciseId in FACE_RULES ? "face" : exerciseId in POSE_RULES || exerciseId in HOLD_RULES ? "pose" : null;
  return { kind, pose: showAll || kind === "pose", hands: showAll || kind === "hands", face: true };
}

/** Body parts an exercise is measured from. Side-view exercises need one complete side. */
export function requirements(exerciseId) {
  const rule = POSE_RULES[exerciseId] ?? HOLD_RULES[exerciseId];
  if (rule) {
    const parts = rule.points ?? [...new Set([...rule.joint, ...(rule.hipDrop || rule.hipRise ? ["hip", "knee", "ankle"] : [])])];
    return { module: "pose", parts, eitherSide: true, view: rule.view ?? "side" };
  }
  if (exerciseId in FACE_RULES) return { module: "face", parts: ["face"], view: "front" };
  if (exerciseId in HAND_RULES) return { module: "hands", parts: ["hand"], view: "front" };
  return null;
}

const PART_INDEX = (side, part) => POSE_INDEX[`${side}_${part === "foot" ? "foot_index" : part}`];
const vis = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? Math.min(p.visibility ?? 1, p.presence ?? 1) : 0);
const inFrame = (p, m = 0.01) => !!p && p.x > m && p.x < 1 - m && p.y > m && p.y < 1 - m;

function words(parts, lang) {
  const list = [...new Set(parts)].map((p) => BODY_WORDS[p]?.[lang] ?? p);
  if (list.length < 2) return list.join("");
  return lang === "bn" ? list.join(", ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/**
 * Judge one engine frame for one exercise.
 * @param {any} frame FrameLandmarks from the engine's "landmarks" event, or null when nothing has arrived.
 * @param {string} exerciseId
 * @param {{now?: number, cameraOn?: boolean, poseFps?: number|null}} [options] `now` is on the same clock as frame.timestampMs (performance.now()); `poseFps` from poseRate().
 * @returns {{status: "READY"|"NO_PERSON"|"PARTIAL_VIEW"|"LOW_CONFIDENCE"|"TRACKING_LOST"|"OFF", points: {name:string, side?:string, visible:boolean, inFrame:boolean, visibility:number}[], hint: {en:string, bn:string}|null, notice?: {en:string, bn:string}|null, lighting: "ok"|"dark"|"bright"|null, counts: {pose:number, face:number, hands:number, total:number}, side?: string}}
 */
export function assessFrame(frame, exerciseId, { now, cameraOn = true, poseFps = null } = {}) {
  const counts = landmarkCounts(frame);
  const req = requirements(exerciseId);
  const base = { points: [], counts, lighting: lightingOf(frame) };
  if (!cameraOn) return { ...base, status: "OFF", hint: null };
  if (!frame || !req) return { ...base, status: "TRACKING_LOST", hint: { en: "Waiting for the camera…", bn: "ক্যামেরার অপেক্ষা…" } };
  if (Number.isFinite(now) && now - frame.timestampMs > STALE_MS)
    return { ...base, status: "TRACKING_LOST", hint: { en: "Camera frames stopped. Check the camera is still on.", bn: "ক্যামেরার ছবি থেমে গেছে। ক্যামেরা চালু আছে কিনা দেখুন।" } };
  const dark = base.lighting === "dark" ? { en: "It's too dark. Turn on a light or face a window.", bn: "খুব অন্ধকার। আলো জ্বালান বা জানালার দিকে মুখ করুন।" } : base.lighting === "bright" ? { en: "Too much light behind you. Turn so the light falls on you.", bn: "পেছনে খুব বেশি আলো। এমনভাবে ঘুরুন যাতে আলো আপনার ওপর পড়ে।" } : null;

  if (req.module === "pose") {
    const fresh = frame.pose && (!Number.isFinite(frame.poseAt) || frame.timestampMs - frame.poseAt <= STALE_MS);
    if (!fresh || !frame.pose?.length) return { ...base, status: "NO_PERSON", hint: dark ?? { en: "Step into the camera view.", bn: "ক্যামেরার সামনে আসুন।" } };
    if ((frame.personCount ?? 1) > 1) return { ...base, status: "LOW_CONFIDENCE", hint: { en: "Keep only one person in view.", bn: "ছবিতে শুধু একজন থাকুন।" } };
    const lm = frame.pose;
    const sides = ["left", "right"].map((side) => {
      const points = req.parts.map((part) => {
        const p = lm[PART_INDEX(side, part)];
        return { name: `${side}_${part}`, part, side, visibility: vis(p), inFrame: inFrame(p), visible: vis(p) >= MIN_VISIBILITY && inFrame(p), y: p?.y ?? 0.5, x: p?.x ?? 0.5 };
      });
      return { side, points, score: points.reduce((n, p) => n + (p.visible ? 1 : 0) + p.visibility * 0.01, 0) };
    });
    const best = sides[0].score >= sides[1].score ? sides[0] : sides[1];
    const points = best.points.map(({ name, side, visible, inFrame, visibility }) => ({ name, side, visible, inFrame, visibility }));
    const out = best.points.filter((p) => !p.inFrame);
    if (out.length) {
      const parts = out.map((p) => p.part);
      const low = out.some((p) => LOWER.has(p.part) && p.y >= 0.5);
      const high = out.some((p) => !LOWER.has(p.part) && p.y < 0.5);
      const sideways = out.every((p) => p.x <= 0.01 || p.x >= 0.99);
      const hint = sideways
        ? { en: "Move toward the middle of the picture.", bn: "ছবির মাঝখানের দিকে সরুন।" }
        : low && !high
          ? { en: `Move farther back so I can see your ${words(["hip", ...parts.filter((p) => LOWER.has(p))], "en")}.`, bn: `আরও পেছনে সরুন যাতে আপনার ${words(["hip", ...parts.filter((p) => LOWER.has(p))], "bn")} দেখা যায়।` }
          : { en: `Step back or tilt the camera so your ${words(parts, "en")} ${parts.length > 1 ? "are" : "is"} in view.`, bn: `পেছনে সরুন বা ক্যামেরা ঘুরিয়ে আপনার ${words(parts, "bn")} দেখা যায় এমন করুন।` };
      return { ...base, status: "PARTIAL_VIEW", points, side: best.side, hint };
    }
    const unclear = best.points.filter((p) => !p.visible);
    if (unclear.length) return { ...base, status: "LOW_CONFIDENCE", points, side: best.side, hint: dark ?? { en: `I can't see your ${words(unclear.map((p) => p.part), "en")} clearly. Check nothing is blocking them and turn ${req.view === "front" ? "to face" : "side-on to"} the camera.`, bn: `আপনার ${words(unclear.map((p) => p.part), "bn")} পরিষ্কার দেখা যাচ্ছে না। সামনে কিছু আছে কিনা দেখুন।` } };
    if (dark) return { ...base, status: "LOW_CONFIDENCE", points, side: best.side, hint: dark };
    const notice = Number.isFinite(poseFps) && poseFps < SLOW_POSE_FPS ? SLOW_POSE_NOTICE : null;
    return { ...base, status: "READY", points, side: best.side, hint: null, notice };
  }

  if (req.module === "face") {
    const lm = frame.face;
    if (!lm?.length || !frame.faceValid) return { ...base, status: "NO_PERSON", hint: dark ?? { en: "Bring your face into the picture, in good light.", bn: "ভালো আলোয় মুখ ছবির ভেতরে আনুন।" } };
    const outline = FACE_OUTLINE.map((i) => lm[i]);
    const points = [{ name: "face", visible: outline.every((p) => inFrame(p)), inFrame: outline.every((p) => inFrame(p)), visibility: 1 }];
    if (!outline.every((p) => inFrame(p))) return { ...base, status: "PARTIAL_VIEW", points, hint: { en: "Move so your whole face is inside the picture.", bn: "পুরো মুখ ছবির ভেতরে আনুন।" } };
    const yaw = frame.head?.yaw ?? 0, pitch = frame.head?.pitch ?? 0;
    if (Math.abs(yaw) > MAX_HEAD_DEGREES || Math.abs(pitch) > MAX_HEAD_DEGREES) return { ...base, status: "LOW_CONFIDENCE", points, hint: { en: "Face the camera straight on.", bn: "সরাসরি ক্যামেরার দিকে তাকান।" } };
    if (!frame.blendshapes || !Object.keys(frame.blendshapes).length) return { ...base, status: "LOW_CONFIDENCE", points, hint: { en: "Expression signal unavailable. Try better light.", bn: "মুখভঙ্গির সংকেত পাওয়া যাচ্ছে না। আরও আলো দিন।" } };
    if (dark) return { ...base, status: "LOW_CONFIDENCE", points, hint: dark };
    return { ...base, status: "READY", points, hint: null };
  }

  // Hands
  const hands = (frame.hands ?? []).filter((h) => h?.landmarks?.length === 21);
  const freshHands = !Number.isFinite(frame.handsAt) || frame.timestampMs - frame.handsAt <= STALE_MS;
  if (!hands.length || !freshHands) return { ...base, status: "NO_PERSON", hint: dark ?? { en: "Hold your hand up to the camera, palm facing it.", bn: "হাতের তালু ক্যামেরার দিকে রেখে হাত তুলে ধরুন।" } };
  const best = hands.map((h) => ({ h, size: palmSize(h.landmarks, frame.videoSize) })).sort((a, b) => b.size - a.size)[0];
  const whole = best.h.landmarks.every((p) => inFrame(p));
  const points = [{ name: `${(best.h.handedness ?? "hand").toLowerCase()}_hand`, visible: whole, inFrame: whole, visibility: best.h.score ?? 1 }];
  if (!whole) return { ...base, status: "PARTIAL_VIEW", points, hint: { en: "Keep your whole hand, fingertips too, inside the picture.", bn: "আঙুলের ডগাসহ পুরো হাত ছবির ভেতরে রাখুন।" } };
  if (best.size < 0.06) return { ...base, status: "LOW_CONFIDENCE", points, hint: { en: "Bring your hand a little closer.", bn: "হাত একটু কাছে আনুন।" } };
  if (dark) return { ...base, status: "LOW_CONFIDENCE", points, hint: dark };
  return { ...base, status: "READY", points, hint: null };
}

/** Wrist to middle-finger knuckle, as a fraction of the larger frame side. */
export function palmSize(lm, size = { width: 1, height: 1 }) {
  const w = size?.width ?? 1, h = size?.height ?? 1, m = Math.max(w, h);
  return Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h) / m;
}

export function landmarkCounts(frame) {
  const fresh = (at) => !frame || !Number.isFinite(at) || frame.timestampMs - at <= STALE_MS;
  const pose = frame?.pose && fresh(frame.poseAt) ? frame.pose.length : 0;
  const face = frame?.face?.length ?? 0;
  const hands = fresh(frame?.handsAt) ? (frame?.hands ?? []).reduce((n, h) => n + (h?.landmarks?.length ?? 0), 0) : 0;
  return { pose, face, hands, total: pose + face + hands };
}

function lightingOf(frame) {
  const l = frame?.luma;
  if (!Number.isFinite(l)) return null;
  return l < 0.12 ? "dark" : l > 0.9 ? "bright" : "ok";
}

/** On-screen tracking label. Truthful: only READY in camera mode is "live tracking". */
export function statusLabel(status, { mode = "camera", cameraOn = true } = {}) {
  if (mode === "manual") return { key: "manual", en: "Manual mode", bn: "ম্যানুয়াল মোড" };
  if (!cameraOn || status === "OFF") return { key: "off", en: "Camera off", bn: "ক্যামেরা বন্ধ" };
  if (status === "READY") return { key: "live", en: "Live on-device tracking", bn: "ডিভাইসেই লাইভ ট্র্যাকিং" };
  return { key: "uncertain", en: "Tracking uncertain", bn: "ট্র্যাকিং অনিশ্চিত" };
}

/**
 * Map a normalized landmark (0..1 of the video frame) into the on-screen box that shows the video
 * with `object-fit: cover`, optionally mirrored. Returns CSS pixels inside the box.
 */
export function projectPoint(p, { videoWidth, videoHeight, boxWidth, boxHeight, mirrored = false, fit = "cover" }) {
  const scale = fit === "contain" ? Math.min(boxWidth / videoWidth, boxHeight / videoHeight) : Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const ox = (boxWidth - videoWidth * scale) / 2, oy = (boxHeight - videoHeight * scale) / 2;
  let x = p.x * videoWidth * scale + ox;
  const y = p.y * videoHeight * scale + oy;
  if (mirrored) x = boxWidth - x;
  return { x, y };
}

/** Pose indices drawn by default for an exercise: the measured joints on both sides. */
export function relevantPoseIndices(exerciseId) {
  const req = requirements(exerciseId);
  if (req?.module !== "pose") return [];
  return ["left", "right"].flatMap((side) => req.parts.map((part) => PART_INDEX(side, part))).filter((i) => i !== undefined);
}

// ---- Adapters from the engine frame to each detector's input ----
export const poseInput = (frame) => ({ landmarks: frame?.pose ?? null, personCount: frame?.personCount ?? (frame?.pose ? 1 : 0), timestamp: frame?.poseAt ?? frame?.timestampMs, width: frame?.videoSize?.width ?? 1, height: frame?.videoSize?.height ?? 1 });
export const faceInput = (frame) => ({ timestamp: frame?.faceAt ?? frame?.timestampMs, blendshapes: frame?.blendshapes, faceVisible: !!frame?.faceValid && !!frame?.face?.length, yaw: frame?.head?.yaw, pitch: frame?.head?.pitch });
export const handInput = (frame) => ({ hands: frame?.hands ?? [], timestamp: frame?.handsAt ?? frame?.timestampMs, width: frame?.videoSize?.width ?? 1, height: frame?.videoSize?.height ?? 1 });

/** The modality timestamp a detector should de-duplicate on, so one model result is used once. */
export function inputTimestamp(frame, kind) {
  if (kind === "pose") return frame?.poseAt;
  if (kind === "hands") return frame?.handsAt;
  return frame?.faceAt ?? frame?.timestampMs;
}

