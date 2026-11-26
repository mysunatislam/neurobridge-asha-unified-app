// ASHA Move end to end, guided: goal wizard -> safety check -> warm-up -> learn (demo) -> camera set-up
// -> practice (not counted) -> counted reps -> tracking loss -> rest -> reload -> emergency stop and lockout.
// Also: a face routine with demo replay, voice only on request, the model router, "show all
// landmarks", the mirror toggle and the camera released at the end; a Bangla phone run where the
// camera permission is refused and the workout is logged by hand; and the mobile layout of every page.
// Camera hardware is replaced by a fake engine that emits the same "landmarks" events as the real one.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LESSONS } from "../src/features/move/lessons.js";
import { TRACKING_LOST_MESSAGE } from "../src/features/move/session.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NEXT_TEST_URL || "http://127.0.0.1:4180";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const errors = [];

const fakePerception = `
export class Perception extends EventTarget {
  constructor() { super(); this.running = false; this.snapshot = {}; this.pulse = {}; this.module = ""; this.moveTracking = null; this.facing = "user"; window.__perception = this; }
  async start() {
    if (window.__denyCamera) { const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; }
    this.running = true;
  }
  stop() { this.running = false; }
  setCalibration() {}
  setActiveModule(name) { this.module = name; }
  setMoveTracking(m) { this.moveTracking = { pose: !!m.pose, hands: !!m.hands }; }
  async setFacingMode(f) { this.facing = f; return f; }
  resetFaceReference() {}
  resetVitalsBaseline() {}
  resetVitalsSession() {}
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
}
`;

// Runs inside the page: plays knee angles (side view, left leg) as landmark frames at 20 fps.
const playLeg = async (page, segments, visibility = 0.95) =>
  page.evaluate(
    async ({ segments, visibility }) => {
      const frame = (deg) => {
        const lm = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, visibility: i % 2 ? 0.95 : 0.2 }));
        const r = (deg * Math.PI) / 180, knee = { x: 0.5, y: 0.65 };
        const hip = { x: knee.x + 0.25 * Math.sin(r), y: knee.y + 0.25 * Math.cos(r) };
        lm[27] = { x: 0.5, y: 0.9, visibility };
        lm[25] = { ...knee, visibility };
        lm[23] = { ...hip, visibility };
        lm[11] = { x: hip.x - 0.02, y: hip.y - 0.28, visibility };
        lm[29] = { x: 0.48, y: 0.92, visibility };
        lm[31] = { x: 0.56, y: 0.93, visibility };
        const t = performance.now();
        return { timestampMs: t, videoSize: { width: 1, height: 1 }, pose: lm, poseAt: t, personCount: 1, face: null, faceAt: t, faceValid: false, head: { yaw: 0, pitch: 0 }, blendshapes: {}, hands: [], handsAt: null, processingMs: 5, luma: 0.5, models: { pose: "fast", hands: "slow", face: "on" } };
      };
      for (const [from, to, ms] of segments) {
        const n = Math.max(1, Math.round(ms / 50));
        for (let i = 0; i < n; i++) {
          window.__perception.emit("landmarks", frame(from + ((to - from) * i) / Math.max(1, n - 1)));
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    },
    { segments, visibility },
  );

const playFace = async (page, segments) =>
  page.evaluate(async (segments) => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    for (const [from, to, ms] of segments) {
      const n = Math.max(1, Math.round(ms / 50));
      for (let i = 0; i < n; i++) {
        const v = from + ((to - from) * i) / Math.max(1, n - 1);
        const t = performance.now();
        window.__perception.emit("landmarks", { timestampMs: t, videoSize: { width: 640, height: 480 }, pose: null, poseAt: null, personCount: 0, face, faceAt: t, faceValid: true, head: { yaw: 0, pitch: 0 }, blendshapes: { mouthSmileLeft: v, mouthSmileRight: v }, hands: [], handsAt: null, processingMs: 4, luma: 0.5, models: { pose: "slow", hands: "slow", face: "on" } });
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }, segments);

async function setup(init = null, viewport = { width: 1280, height: 900 }, { denyCamera = false } = {}) {
  const context = await browser.newContext({ viewport });
  await context.route("**/engine/perception.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakePerception }));
  await context.route("**/api/session**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, events: [], status: null }) }));
  await context.addInitScript(
    ({ init, denyCamera }) => {
      window.__utterances = [];
      window.__denyCamera = denyCamera;
      // The Next.js dev badge (only in `next dev`) sits over the bottom-left of a phone screen and
      // swallows taps meant for the Start button. Hide it in the test; production builds have no badge.
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = "nextjs-portal{display:none!important}";
        document.head.appendChild(s);
      });
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { window.__utterances.push(u.text); u.onend?.(); } } });
      if (init && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("asha_live_move_v2", JSON.stringify(init));
        sessionStorage.setItem("seeded", "1");
      }
    },
    { init, denyCamera },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page };
}
async function answer(page, label = "No") {
  await page.getByRole("radiogroup").first().waitFor();
  for (const question of await page.getByRole("radiogroup").all()) await question.getByRole("button", { name: label, exact: true }).click();
}
const cameraOn = (page) => page.waitForFunction(() => window.__perception?.running);
const waitState = (page, value) => page.locator(`[data-testid=move-state][data-state=${value}]`).waitFor();
const stateIs = (page) => page.getByTestId("move-state").getAttribute("data-state");
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("asha_live_move_v2") || "{}"));
const spoken = (page) => page.evaluate(() => window.__utterances.join(" | "));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// The caption shown right after "Show me again" (the first one lasts over a second, so polling sees it).
const captionBecomes = (page, text) => page.waitForFunction((t) => document.querySelector("[data-testid=demo-caption]")?.textContent.trim() === t, text, { timeout: 1000 });
const seed = (plan, extra = {}) => ({ plan, cameraConsent: true, voice: true, language: "en", history: [], schedule: [1, 3, 5], clinicianPrograms: [], conditions: {}, painAreas: [], rememberConditions: false, consentAudit: [], ...extra });

// ---------- 1. Wizard, honest goals, learn, set-up, practice, camera reps, tracking loss, emergency stop ----------
{
  const { context, page } = await setup();
  await page.goto(base + "/dashboard/patient/move");
  await page.getByRole("heading", { name: "Move", level: 1 }).waitFor();
  await page.getByRole("link", { name: /Core and weight management/ }).click();
  await page.getByRole("button", { name: "Burn belly fat" }).click();
  await page.getByText("No exercise burns fat from one area").waitFor();
  await page.goto(base + "/dashboard/patient/move/start?category=lower_body");
  await page.getByRole("button", { name: "Stronger legs for daily life" }).click();
  await page.getByRole("button", { name: "Beginner" }).click();
  await page.getByRole("button", { name: "I can stand and move freely" }).click();
  await page.getByRole("button", { name: /Yes, a stable chair/ }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "No", exact: true }).click();
  await page.getByRole("button", { name: /Use my camera to count/ }).click();
  await page.getByText("Your recommended starter plan").waitFor();
  const reps = page.getByLabel("Reps").first();
  await reps.fill("2");
  await page.getByRole("button", { name: "Save and start" }).click();
  await page.waitForURL(/\/move\/session$/);
  // The wizard's answers carry over; nothing is asked twice within 15 minutes.
  await page.getByRole("button", { name: "Start workout" }).click();
  await waitState(page, "WARM_UP");
  assert.equal(await page.evaluate(() => window.__perception?.running ?? false), false, "the camera stays off until set-up");
  await page.getByRole("button", { name: "I'm warmed up" }).click();
  await waitState(page, "LEARN");
  await page.getByTestId("move-demo").waitFor();
  await page.getByTestId("move-viewpoint").waitFor();
  await page.getByRole("button", { name: "I'm ready: set up camera" }).click();
  await waitState(page, "CAMERA_SETUP");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await cameraOn(page);
  assert.equal(await page.evaluate(() => window.__perception.module), "move", "Move cadence on this page");
  await page.waitForFunction(() => window.__perception.moveTracking?.pose === true && window.__perception.moveTracking?.hands === false);
  assert.ok(await page.getByRole("button", { name: /Waiting for a clear view/ }).isDisabled(), "no practice before a usable view");
  await playLeg(page, [[178, 178, 1600]]);
  await page.getByTestId("move-visibility").getByText(/left knee: seen/).waitFor();
  assert.equal(await page.getByTestId("move-tracking-status").getAttribute("data-status"), "READY");
  await page.getByRole("button", { name: "Let's practise" }).click();
  await waitState(page, "PRACTICE");
  const rep = [[178, 178, 400], [178, 100, 900], [100, 100, 300], [100, 178, 900], [178, 178, 400]];
  const goal = Number((await page.getByTestId("move-practice").textContent()).split("/")[1]);
  for (let i = 0; i < goal; i++) await playLeg(page, rep);
  assert.equal((await page.getByTestId("move-practice").textContent()).trim(), `${goal} / ${goal}`);
  assert.equal(await page.getByTestId("move-reps").count(), 0, "practice has no rep counter");
  assert.ok((await spoken(page)).includes("It wasn't counted"), "practice is praised, not counted");
  await page.getByRole("button", { name: "Start counting" }).click();
  await waitState(page, "EXERCISE");
  assert.equal(await page.getByTestId("move-reps").textContent(), "0 / 2", "practice isn't counted");
  await playLeg(page, rep);
  assert.equal(await page.getByTestId("move-reps").textContent(), "1 / 2");
  // A shallow dip is not a repetition.
  await playLeg(page, [[178, 140, 700], [140, 178, 700], [178, 178, 300]]);
  assert.equal(await page.getByTestId("move-reps").textContent(), "1 / 2");
  // Hidden joints: tracking is lost, said out loud, and counting waits.
  await playLeg(page, [[95, 95, 1500]], 0.2);
  await waitState(page, "TRACKING_LOST");
  await page.getByTestId("move-cue").getByText(TRACKING_LOST_MESSAGE).waitFor();
  assert.ok((await spoken(page)).includes(TRACKING_LOST_MESSAGE), "tracking loss is spoken");
  assert.equal(await page.getByTestId("move-tracking-status").textContent(), "Tracking uncertain");
  await playLeg(page, [[178, 178, 600]]);
  await waitState(page, "EXERCISE");
  await playLeg(page, rep);
  await page.waitForFunction(() => ["REST", "COOL_DOWN"].includes(document.querySelector("[data-testid=move-state]")?.dataset.state));
  if ((await stateIs(page)) === "REST") {
    await page.getByTestId("move-rest").waitFor();
    await page.getByRole("button", { name: "Rest 30 s longer" }).click();
  }
  // Reload mid-workout: it comes back paused with progress kept.
  await page.reload();
  await waitState(page, "PAUSED");
  await page.getByTestId("move-toolbar").getByRole("button", { name: "Resume" }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid=move-state]")?.dataset.state !== "PAUSED");
  await page.getByRole("button", { name: "Stop for symptoms" }).click();
  await page.getByRole("button", { name: "Chest pain or pressure" }).click();
  await page.getByRole("alert").filter({ hasText: "Get urgent medical help now" }).first().waitFor();
  await page.getByRole("link", { name: "Call 999" }).first().waitFor();
  const saved = await store(page);
  assert.equal(saved.lockout.kind, "emergency");
  const last = saved.history.at(-1);
  assert.equal(last.endedBy, "safety_stop");
  assert.equal(last.exercises[0].reps, 2);
  assert.equal(last.exercises[0].cameraReps, 2, "camera estimates are kept apart");
  assert.equal(last.exercises[0].manualReps, 0);
  assert.equal(last.exercises[0].practiced, true);
  assert.ok(last.exercises[0].quality.trackingLost >= 1);
  assert.ok(last.eventsBySource.camera >= 2 && last.eventsBySource.system >= 1);
  assert.ok(!("calories" in last));
  assert.equal(await page.evaluate(() => window.__perception?.running ?? false), false, "the camera is released on a safety stop");
  // No way back in: the wizard and the session are both paused.
  await page.goto(base + "/dashboard/patient/move/session");
  await page.getByText("Workouts are paused for your safety.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Start workout" }).count(), 0);
  await page.goto(base + "/dashboard/patient/move/start?category=lower_body");
  await page.getByText("Move is paused for your safety.").waitFor();
  await page.goto(base + "/dashboard/patient/move/safety");
  await page.getByText("Please get medical help first").waitFor();
  await context.close();
}

// ---------- 2. Face routine: demo replay, voice on request, router, show-all, mirror, summary, camera off ----------
{
  const lesson = LESSONS.smile;
  const plan = { id: "face-1", name: "Face test", category: "face", userGoal: "expression", locale: "en", warmUpSeconds: 30, coolDownSeconds: 30, authoredBy: "user", version: "test", sequence: [{ exerciseId: "smile", sets: 1, targetReps: 1, holdSeconds: 1, restSeconds: 20 }] };
  const { context, page } = await setup(seed(plan));
  await page.goto(base + "/dashboard/patient/move/session");
  await answer(page);
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.getByRole("button", { name: "I'm warmed up" }).click();
  await waitState(page, "LEARN");
  await page.getByTestId("move-demo").waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Show me again from the start" }).click();
  await captionBecomes(page, lesson.captions.en[0]);
  assert.ok(!(await spoken(page)).includes(lesson.captions.en[1]), "narration never starts by itself");
  await page.getByRole("button", { name: "Play voice" }).click();
  await page.waitForFunction((caps) => caps.some((c) => window.__utterances.some((u) => u.includes(c))), lesson.captions.en);
  await page.getByRole("button", { name: "Voice on" }).click();
  await page.getByRole("button", { name: "I'm ready: set up camera" }).click();
  await waitState(page, "CAMERA_SETUP");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await cameraOn(page);
  // Router: a face exercise needs no fast body or hand model.
  await page.waitForFunction(() => window.__perception.moveTracking && !window.__perception.moveTracking.pose && !window.__perception.moveTracking.hands);
  await playFace(page, [[0.05, 0.05, 1600]]);
  await page.getByRole("button", { name: "Let's practise" }).click();
  await waitState(page, "PRACTICE");
  const smile = [[0.05, 0.05, 700], [0.05, 0.6, 300], [0.6, 0.6, 1400], [0.6, 0.05, 300], [0.05, 0.05, 500]];
  await playFace(page, smile);
  assert.equal((await page.getByTestId("move-practice").textContent()).trim(), "1 / 1");
  // Watching the demo again pauses counting, then returns.
  await page.getByRole("button", { name: "Show me again", exact: true }).click();
  await waitState(page, "PAUSED");
  await page.getByRole("button", { name: "Back to the exercise" }).click();
  await waitState(page, "PRACTICE");
  // After a pause the camera must see the person clearly again before counting can start.
  assert.ok(await page.getByRole("button", { name: "Start counting" }).isDisabled());
  await playFace(page, [[0.05, 0.05, 1200]]);
  await page.getByRole("button", { name: "Start counting" }).click();
  await waitState(page, "EXERCISE");
  // Overlay: mirrored by default, and the mirror toggle is display only.
  const overlay = page.getByTestId("move-overlay");
  assert.equal(await overlay.getAttribute("data-mirrored"), "true");
  await page.getByTestId("move-mirror").click();
  assert.equal(await overlay.getAttribute("data-mirrored"), "false");
  await page.getByTestId("move-mirror").click();
  assert.equal(await overlay.getAttribute("data-mirrored"), "true");
  // "Show all detected landmarks" draws every face point and asks the router for all models.
  await page.getByText("Advanced tracking details").click();
  await playFace(page, [[0.05, 0.05, 200]]);
  const relevant = Number(await overlay.getAttribute("data-points"));
  await page.getByTestId("move-show-all").check();
  await page.waitForFunction(() => window.__perception.moveTracking?.pose && window.__perception.moveTracking?.hands);
  await playFace(page, [[0.05, 0.05, 200]]);
  await page.waitForFunction(() => Number(document.querySelector("[data-testid=move-overlay]")?.dataset.points) >= 478);
  assert.ok(relevant > 0 && relevant < 478, `only the measured face points by default (${relevant})`);
  assert.match(await page.getByTestId("move-landmark-count").textContent(), /^478 \/ 553$/);
  assert.equal((await store(page)).showAllLandmarks, true);
  await page.getByTestId("move-show-all").uncheck();
  await playFace(page, smile);
  await waitState(page, "COOL_DOWN");
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByText("Workout complete").waitFor();
  assert.equal((await page.getByTestId("move-summary-sources").textContent()).trim(), "1 camera estimate · 0 your entry");
  assert.equal(await page.evaluate(() => window.__perception.running), false, "the camera turns off when the workout ends");
  await page.getByRole("radiogroup", { name: "Effort from 0 to 10" }).getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Save how it felt" }).click();
  await page.getByRole("link", { name: "View progress" }).click();
  await page.getByText("Face test").first().waitFor();
  const saved = await store(page);
  assert.equal(saved.history.at(-1).endedBy, "completed");
  assert.equal(saved.history.at(-1).effort, 4);
  assert.deepEqual(saved.history.at(-1).exercises[0].countedBy, ["camera"]);
  // Bangla free-text symptom during a manual workout stops it.
  await page.goto(base + "/dashboard/patient/move/session");
  await page.getByRole("button", { name: "Back to start" }).click().catch(() => {});
  await page.goto(base + "/dashboard/patient/move/session");
  await answer(page);
  await page.getByRole("button", { name: /Manual: I tap to count/ }).click();
  await page.getByRole("button", { name: "Start workout" }).click();
  await waitState(page, "WARM_UP");
  await page.getByRole("button", { name: "Stop for symptoms" }).click();
  await page.getByPlaceholder(/Or describe it/).fill("মাথা ঘুরছে");
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByText("Stop and rest.").first().waitFor();
  assert.equal((await store(page)).lockout.kind, "rest");
  await context.close();
}

// ---------- 3. Bangla on a phone, camera permission refused: manual logging still works ----------
{
  const lesson = LESSONS.arm_raise;
  const plan = { id: "arms-1", name: "Arms test", category: "upper_body", userGoal: "mobility", locale: "bn", warmUpSeconds: 30, coolDownSeconds: 30, authoredBy: "user", version: "test", sequence: [{ exerciseId: "arm_raise", sets: 1, targetReps: 3, restSeconds: 20 }] };
  const { context, page } = await setup(seed(plan, { language: "bn" }), { width: 390, height: 844 }, { denyCamera: true });
  await page.goto(base + "/dashboard/patient/move/session");
  await answer(page, "না");
  await page.getByRole("button", { name: "ব্যায়াম শুরু" }).click();
  await page.getByRole("button", { name: "ওয়ার্ম-আপ হয়েছে" }).click();
  await waitState(page, "LEARN");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "শুরু থেকে আবার দেখান" }).click();
  await captionBecomes(page, lesson.captions.bn[0]);
  assert.ok((await overflow(page)) <= 1, "Learn fits a 390 px screen");
  await page.getByRole("button", { name: "প্রস্তুত: ক্যামেরা ঠিক করি" }).click();
  await waitState(page, "CAMERA_SETUP");
  await page.getByRole("button", { name: "ক্যামেরা চালু করুন" }).click();
  await page.getByRole("alert").filter({ hasText: "ক্যামেরা পাওয়া যাচ্ছে না" }).waitFor();
  assert.ok((await overflow(page)) <= 1, "Set-up fits a 390 px screen");
  await page.getByRole("button", { name: "নিজে গুনব" }).click();
  await waitState(page, "EXERCISE");
  await page.getByRole("button", { name: "+১ বার" }).click();
  assert.equal(await page.getByTestId("move-reps").textContent(), "1 / 3");
  assert.ok((await overflow(page)) <= 1, "Do fits a 390 px screen");
  // The toolbar stays reachable: Pause, End and Stop for symptoms.
  const bar = page.getByTestId("move-toolbar");
  await bar.getByRole("button", { name: "উপসর্গের জন্য থামুন" }).waitFor();
  await bar.getByRole("button", { name: "শেষ করুন" }).click();
  await page.getByText("ব্যায়াম থামানো হয়েছে").waitFor();
  assert.equal((await page.getByTestId("move-summary-sources").textContent()).trim(), "0 ক্যামেরার আনুমানিক · 1 আপনার গোনা");
  const last = (await store(page)).history.at(-1);
  assert.equal(last.mode, "manual");
  assert.equal(last.exercises[0].manualReps, 1);
  await context.close();
}

// ---------- 4. Mobile layout: no page wider than the screen ----------
{
  const { context, page } = await setup(null, { width: 390, height: 844 });
  for (const path of ["", "/start?category=face", "/plan", "/session", "/progress", "/safety", "/clinician"]) {
    await page.goto(base + "/dashboard/patient/move" + path);
    await page.getByRole("heading", { level: 1 }).first().waitFor().catch(() => {});
    await page.waitForTimeout(300);
    const wide = await overflow(page);
    assert.ok(wide <= 1, `${path || "/"} overflows by ${wide}px`);
  }
  await page.goto(base + "/dashboard/patient/move/safety");
  await page.getByRole("button", { name: "বাংলা" }).click();
  await page.goto(base + "/dashboard/patient/move");
  await page.getByRole("heading", { name: "মুভ" }).waitFor();
  await context.close();
}

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log("Move browser: guided learn/set-up/practice/do, camera reps, tracking loss, reload, emergency lockout, face routine with demo, router, show-all and mirror, camera release, Bangla manual fallback and mobile layout passed");
