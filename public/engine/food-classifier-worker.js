// ASHA Nutrition classifier worker. Runs off the main thread, one image at a time.
//
// It answers three things about a still image (a sampled live frame, the frozen frame, or an
// uploaded photo, all through the same message):
//   - ASHA's food recogniser's top five labels for the centre square (EfficientNetV2-B0 with a head
//     trained on Open Images and Bangladeshi food photos, int8 ONNX, run with onnxruntime-web; 65 foods (31 Bangladeshi dishes) + "not food".
//     Labels and their order live in src/features/nutrition/catalog.js FOOD_VISION.classes),
//   - whether a face is in the picture (MediaPipe face landmarker, already shipped), so ASHA can
//     ask for a photo without people in it,
//   - basic picture quality (light, blur) of the centre square.
// Nothing is sent anywhere. Images arrive as ImageBitmaps and are closed after use.
// Same order as FOOD_VISION.classes in src/features/nutrition/catalog.js (the model's output order).
const CLASSES = ["achar", "apple", "bakarkhani", "banana", "beguni", "bell_pepper", "bhorta", "bread", "cabbage", "cake", "carrot", "cauliflower", "chicken_curry", "chili", "chomchom", "chop", "cucumber", "curry", "dal", "egg_curry", "fish_curry", "french_fries", "fried_chicken", "fried_fish", "fuchka", "grape", "grapefruit_pomelo", "haleem", "hamburger", "jalebi", "jhalmuri", "kabab", "kotkoti", "lemon_lime", "milk", "muglai_paratha", "mutton_roast", "noodles", "not_food", "omelette", "onion", "orange", "paratha", "peach", "pear", "peyaju", "pineapple", "pitha", "pizza", "polao", "pomegranate", "potato", "prawn_curry", "pumpkin", "rasmalai", "rice", "roast_chicken", "salad", "sandesh", "sandwich", "shawarma", "singara_samosa", "strawberry", "tea", "tomato", "watermelon"];
const SIZE = 224;
let classifier = null;
let ort = null;
let faces = null;
let quality = null;
let ready = null;

async function init(base) {
  const V = await import(new URL("../neuroface/vendor/vision_bundle.mjs", self.location.href).href);
  const { checkPhotoQuality } = await import(new URL("../app/everyday/foods.js", self.location.href).href);
  quality = checkPhotoQuality;
  const files = await V.FilesetResolver.forVisionTasks(new URL("../neuroface/vendor/wasm/", self.location.href).href);
  const t0 = performance.now();
  const opts = (path, extra) => ({ runningMode: "IMAGE", canvas: new OffscreenCanvas(1, 1), baseOptions: { delegate: "CPU", modelAssetPath: new URL(path, base || self.location.href).href }, ...extra });
  // A classic worker (the MediaPipe bundle needs one), so onnxruntime-web comes in by dynamic import.
  ort = await import(new URL("./ort.wasm.min.mjs", self.location.href).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
  classifier = await ort.InferenceSession.create(new URL("../models/asha-food-66-int8.onnx", base || self.location.href).href, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  try {
    faces = await V.FaceLandmarker.createFromOptions(files, opts("../neuroface/models/face_landmarker.task", { numFaces: 3, minFaceDetectionConfidence: 0.5 }));
  } catch {
    faces = null; // The face check is a courtesy; classification still works without it.
  }
  return { loadMs: Math.round(performance.now() - t0), faceCheck: !!faces };
}

function pixels(bitmap, size = null) {
  const w = size ?? bitmap.width, h = size ?? bitmap.height;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Top five {label, score} for a 224 × 224 RGBA pixel buffer. The model takes NHWC RGB in 0–255. */
async function recognise(rgba) {
  const n = SIZE * SIZE, input = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    input[i * 3] = rgba[i * 4];
    input[i * 3 + 1] = rgba[i * 4 + 1];
    input[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const out = await classifier.run({ [classifier.inputNames[0]]: new ort.Tensor("float32", input, [1, SIZE, SIZE, 3]) });
  const probs = out[classifier.outputNames[0]].data;
  return Array.from(probs, (score, i) => ({ label: CLASSES[i], score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

self.onmessage = async ({ data: d }) => {
  if (d.type === "init") {
    ready ??= init(d.base);
    try {
      self.postMessage({ type: "ready", ...(await ready) });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err).slice(0, 200) });
    }
    return;
  }
  if (d.type !== "classify") return;
  const { id, crop, frame } = d;
  try {
    await ready;
    const t0 = performance.now();
    const px = pixels(crop);
    const categories = await recognise(crop.width === SIZE && crop.height === SIZE ? px : pixels(crop, SIZE));
    const q = quality(px, crop.width, crop.height);
    let faceCount = null;
    if (faces && frame) faceCount = faces.detect(frame).faceLandmarks?.length ?? 0;
    self.postMessage({ type: "result", id, categories, quality: { warnings: q.warnings, brightness: Math.round(q.brightness), sharpness: Math.round(q.laplacianVariance) }, faceCount, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ type: "result", id, error: String(err?.message || err).slice(0, 200) });
  } finally {
    crop?.close?.();
    frame?.close?.();
  }
};
