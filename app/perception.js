import {
  poseFeatures,
  pulseEstimate,
  RestTracker,
  SustainedCue,
} from "./signals.js";
import { HandTracks } from "./hand-tracks.js";
export class Perception extends EventTarget {
  constructor(video, canvas) {
    super();
    this.video = video;
    this.canvas = canvas;
    this.running = false;
    this.extractor = new NF_vision.Extractor();
    this.engine = new NF_engine.Engine();
    this.handTracker = new NF_fingerspeakSignal.PoseTracker(800);
    this.rest = new RestTracker();
    this.postureCue = new SustainedCue();
    this.lipCue = new SustainedCue();
    this.rgb = [];
    this.pulse = { bpm: null, reason: "Collecting signal" };
    this.snapshot = {};
    this.enabled = [];
    this.handStates = {};
    this.blinks = 0;
    this.yoloEnabled = false;
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  setCalibration(b, enabled = []) {
    this.engine = new NF_engine.Engine({ baseline: b });
    this.enabled = enabled;
  }
  async start() {
    if (this.running) return;
    this.emit("status", "Loading face, two-hand and pose models…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    try {
      await this.initWorker();
    } catch (e) {
      this.worker?.terminate();
      this.worker = null;
      this.emit("status", "Using compatible camera mode…");
      await this.initMain();
    }
    this.running = true;
    this.emit("status", "Camera active · all sensing shares one stream");
    this.loop();
  }
  async initWorker() {
    await new Promise((resolve, reject) => {
      this.worker = new Worker(new URL("./vision-worker.js", import.meta.url));
      const timeout = setTimeout(
        () => reject(Error("Worker startup timeout")),
        25000,
      );
      this.worker.onerror = () => {
        clearTimeout(timeout);
        reject(Error("Worker unavailable"));
      };
      this.worker.onmessage = ({ data: d }) => {
        if (d.type === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (d.type === "error") {
          clearTimeout(timeout);
          reject(Error(d.message));
        } else if (d.type === "result") {
          this.busy = false;
          this.result(d);
        } else if (d.type === "frameError") {
          this.busy = false;
          this.emit("status", "Tracking interrupted. Reposition the camera.");
        }
      };
      this.worker.postMessage({ type: "init" });
    });
  }
  async initMain() {
    const V = await import("../neuroface/vendor/vision_bundle.mjs");
    const files = await V.FilesetResolver.forVisionTasks(
      new URL("../neuroface/vendor/wasm/", import.meta.url).href,
    );
    const opts = (model) => ({
      baseOptions: {
        modelAssetPath: new URL(model, import.meta.url).href,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
    });
    try {
      this.face = await V.FaceLandmarker.createFromOptions(files, {
        ...opts("../neuroface/models/face_landmarker.task"),
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    } catch {
      const o = opts("../neuroface/models/face_landmarker.task");
      o.baseOptions.delegate = "CPU";
      this.face = await V.FaceLandmarker.createFromOptions(files, {
        ...o,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    }
    this.hand = await V.HandLandmarker.createFromOptions(files, {
      ...opts("../neuroface/models/hand_landmarker.task"),
      numHands: 2,
    });
    this.pose = await V.PoseLandmarker.createFromOptions(files, {
      ...opts("../models/pose_landmarker_lite.task"),
      numPoses: 1,
    });
    this.lastHand = 0;
    this.lastPose = 0;
  }
  async loop() {
    if (!this.running) return;
    const t = performance.now();
    if (
      !document.hidden &&
      !this.busy &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastTime &&
      t - (this.lastFrame || 0) > 45
    ) {
      this.busy = true;
      this.lastTime = this.video.currentTime;
      this.lastFrame = t;
      try {
        if (this.worker) {
          const bitmap = await createImageBitmap(this.video);
          this.worker.postMessage({ type: "frame", bitmap, t }, [bitmap]);
        } else {
          const start = performance.now(),
            face = this.face.detectForVideo(this.video, t);
          let hand = null,
            pose = null;
          if (t - this.lastHand > 200) {
            hand = this.hand.detectForVideo(this.video, t);
            this.lastHand = t;
          }
          if (t - this.lastPose > 250) {
            pose = this.pose.detectForVideo(this.video, t);
            this.lastPose = t;
          }
          this.busy = false;
          this.result({ face, hand, pose, t, ms: performance.now() - start });
        }
      } catch (e) {
        this.busy = false;
        this.emit(
          "status",
          "Camera frame unavailable. Try restarting monitoring.",
        );
      }
      if (
        this.yoloEnabled &&
        this.yoloWorker &&
        !this.yoloBusy &&
        t - (this.lastYolo || 0) > 1800
      ) {
        this.lastYolo = t;
        this.yoloBusy = true;
        createImageBitmap(this.video)
          .then((bitmap) =>
            this.yoloWorker.postMessage({ type: "frame", bitmap }, [bitmap]),
          )
          .catch(() => (this.yoloBusy = false));
      }
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }
  result(d) {
    if (!this.running) return;
    const f = this.extractor.extract(d.face, this.video, d.t),
      r = this.engine.process({ ...f, commandsEnabled: false });
    this.faceResult = d.face;
    if (d.pose) {
      this.poseResult = d.pose;
      this.posture = poseFeatures(d.pose.landmarks?.[0], this.posture);
      this.poseAt = d.t;
    }
    if (d.hand) {
      this.handResult = d.hand;
      this.handTracks ??= new HandTracks();
      const hands = this.handTracks.update(
        NF_fingerspeakSignal.orderedHands(d.hand),
        d.t,
      );
      this.hands = this.handTracker.update(hands, d.t);
      const seen = new Set();
      for (const h of this.hands) {
        seen.add(h.id);
        if (this.handStates[h.id] !== h.pose && h.pose !== "Observing…")
          this.emit("hand", { ...h, t: d.t });
        this.handStates[h.id] = h.pose;
      }
      for (const k of Object.keys(this.handStates))
        if (!seen.has(k)) delete this.handStates[k];
    }
    for (const e of r.events) {
      if (e.type === "BLINK_COMPLETED") this.blinks++;
      this.emit("gesture", e);
    }
    const poseValid = this.posture?.valid && d.t - this.poseAt < 1200;
    const rest = this.rest.update({
      t: d.t,
      valid: r.accepted && !!poseValid,
      closed: f.eyeBlinkLeft > 0.65 && f.eyeBlinkRight > 0.65,
      motion: this.posture?.motion || 0,
    });
    if (rest) this.emit("cue", rest);
    if (this.postureCue.update(this.posture?.sideways, !!poseValid, d.t))
      this.emit("cue", "posture");
    const lipAsym =
      r.accepted &&
      Math.abs(f.yaw - this.engine.baseline.neutralYaw) < 15 &&
      Math.max(f.mouthSmileLeft, f.mouthSmileRight) < 0.18 &&
      Math.abs(
        f.mouthCornerLeftY -
          this.engine.baseline.cornerLeftY -
          (f.mouthCornerRightY - this.engine.baseline.cornerRightY),
      ) > 0.035;
    if (
      this.lipCue.update(
        lipAsym,
        r.accepted && this.engine.baseline.calibrated,
        d.t,
      )
    )
      this.emit("cue", "face_change");
    this.samplePulse(d.face, f, d.t);
    this.snapshot = {
      raw: f,
      face: r,
      posture: this.posture,
      hands: this.hands || [],
      pulse: this.pulse,
      latency: Math.round(d.ms),
      blinks: this.blinks,
      activity: this.rest.resting ? "Rest-like pattern" : "Observing",
      t: d.t,
      yolo: this.yoloResult,
    };
    this.emit("frame", this.snapshot);
    this.draw();
  }
  samplePulse(result, f, t) {
    const lm = result.faceLandmarks?.[0];
    if (!lm || !f.facePresent || f.faceQuality < 0.65) {
      this.rgb = [];
      this.pulse = {
        bpm: null,
        quality: 0,
        reason: "Face not reliably visible",
      };
      return;
    }
    this.roi ??= Object.assign(document.createElement("canvas"), {
      width: 16,
      height: 16,
    });
    const c = this.roi.getContext("2d", { willReadFrequently: true });
    const W = this.video.videoWidth,
      H = this.video.videoHeight;
    const x = (lm[70].x + lm[300].x) / 2,
      y = (lm[10].y + lm[151].y) / 2,
      w = Math.abs(lm[300].x - lm[70].x) * 0.48,
      h = Math.abs(lm[151].y - lm[10].y) * 0.7;
    if (w < 0.01 || h < 0.005) return;
    c.drawImage(
      this.video,
      (x - w / 2) * W,
      (y - h / 2) * H,
      w * W,
      h * H,
      0,
      0,
      16,
      16,
    );
    const px = c.getImageData(0, 0, 16, 16).data,
      rgb = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4)
      for (let k = 0; k < 3; k++) rgb[k] += px[i + k] / 256;
    this.rgb.push({ t, rgb, motion: (f.poseSpeed || 0) / 1000 });
    this.rgb = this.rgb.filter((x) => x.t > t - 22000);
    if (t - (this.lastPulse || 0) > 1500) {
      this.lastPulse = t;
      this.pulse = pulseEstimate(this.rgb);
    }
  }
  draw() {
    if (!this.canvas.offsetParent) return;
    const c = this.canvas.getContext("2d"),
      W = (this.canvas.width = this.video.videoWidth || 640),
      H = (this.canvas.height = this.video.videoHeight || 480);
    c.clearRect(0, 0, W, H);
    const lines = (lm, edges, color) => {
      if (!lm) return;
      c.strokeStyle = color;
      c.lineWidth = 2;
      for (const [a, b] of edges) {
        if (!lm[a] || !lm[b]) continue;
        c.beginPath();
        c.moveTo(lm[a].x * W, lm[a].y * H);
        c.lineTo(lm[b].x * W, lm[b].y * H);
        c.stroke();
      }
    };
    for (const lm of this.handResult?.landmarks || [])
      lines(
        lm,
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [0, 5],
          [5, 6],
          [6, 7],
          [7, 8],
          [5, 9],
          [9, 10],
          [10, 11],
          [11, 12],
          [9, 13],
          [13, 14],
          [14, 15],
          [15, 16],
          [13, 17],
          [17, 18],
          [18, 19],
          [19, 20],
          [0, 17],
        ],
        "#ffcb74",
      );
    lines(
      this.poseResult?.landmarks?.[0],
      [
        [11, 12],
        [11, 13],
        [13, 15],
        [12, 14],
        [14, 16],
        [11, 23],
        [12, 24],
        [23, 24],
        [23, 25],
        [25, 27],
        [24, 26],
        [26, 28],
      ],
      "#63e5c4",
    );
    lines(
      this.faceResult?.faceLandmarks?.[0],
      [
        [33, 160],
        [160, 158],
        [158, 133],
        [133, 153],
        [153, 144],
        [144, 33],
        [362, 385],
        [385, 387],
        [387, 263],
        [263, 373],
        [373, 380],
        [380, 362],
        [61, 13],
        [13, 291],
        [291, 14],
        [14, 61],
      ],
      "#b1a0ff",
    );
  }
  async enableYolo() {
    if (this.yoloWorker) {
      this.yoloEnabled = !this.yoloEnabled;
      return this.yoloEnabled;
    }
    this.emit("status", "Loading YOLO posture cross-check…");
    this.yoloWorker = new Worker(new URL("./yolo-worker.js", import.meta.url), {
      type: "module",
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("YOLO initialization timed out")),
        45000,
      );
      this.yoloWorker.onmessage = ({ data: d }) => {
        if (d.type === "ready") {
          clearTimeout(timer);
          resolve();
        }
        if (d.type === "error") {
          clearTimeout(timer);
          this.yoloBusy = false;
          reject(Error(d.message));
          this.emit(
            "status",
            "YOLO unavailable · lightweight pose remains active",
          );
        }
        if (d.type === "result") {
          this.yoloBusy = false;
          this.yoloResult = d;
        }
      };
      this.yoloWorker.onerror = () => {
        clearTimeout(timer);
        reject(Error("YOLO worker failed"));
      };
      this.yoloWorker.postMessage({ type: "init" });
    });
    this.yoloEnabled = true;
    return true;
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.worker?.terminate();
    this.worker = null;
    for (const m of [this.face, this.hand, this.pose]) m?.close();
    this.face = this.hand = this.pose = null;
    this.yoloWorker?.terminate();
    this.yoloWorker = null;
    this.yoloEnabled = false;
    this.busy = false;
    this.rest.reset();
    this.rgb = [];
    this.emit("status", "Monitoring paused");
  }
}
