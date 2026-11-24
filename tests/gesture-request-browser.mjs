// Gesture to action: a practised hand pose proposes its request, and only a later, separate pose
// after the question has been spoken sends it to the caregiver.
//   node tests/gesture-request-browser.mjs   (needs the dev server, NEXT_TEST_URL, default http://127.0.0.1:4180)
// The camera is a fake engine that emits the engine's "hand" events (a pose held for 800 ms,
// public/engine/perception.js). How often the pose itself is read right on real hands is measured
// on public images in docs/validation; this checks what the app does with each pose.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = (process.env.NEXT_TEST_URL || "http://127.0.0.1:4180").replace(/\/$/, "");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const patientId = "gesture-test";
const errors = [];
const fakePerception = `
export class Perception extends EventTarget {
  constructor() { super(); this.running = false; this.snapshot = {}; this.pulse = {}; window.__perception = this; }
  async start() { this.running = true; }
  stop() { this.running = false; }
  setCalibration() {}
  setActiveModule() {}
  setGazeCursor() {}
  async setFacingMode(f) { return f; }
  resetFaceReference() {}
  resetVitalsBaseline() {}
  resetVitalsSession() {}
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
}
`;
const assessment = { leftHand: "reliable", rightHand: "reliable", wrist: "reliable", fingers: "reliable", eyes: "none", lips: "none", head: "none", speech: "limited", canSee: true, canHear: true };
const profile = { patientId, label: "Gesture test", assessment, voice: { name: "", rate: 0.9 }, supportContext: { categories: [], goals: [], note: "" }, recommendation: { primary: "fingerspeak", suggested: ["fingerspeak"] } };
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const events = [];
try {
  await context.route("**/engine/perception.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakePerception }));
  await context.route("**/api/session**", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "event") events.push(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body ? { ok: true, push: "not_enabled" } : { profile, role: "patient", events: [], status: null }) });
  });
  await context.route("**/api/asha", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Unexpected cloud call"}' }));
  await context.addInitScript((patientId) => {
    localStorage.setItem("asha_live_patient", JSON.stringify({ patientId, token: "test-patient-token" }));
    localStorage.setItem("asha_live_settings", JSON.stringify({ proactive: false, cloud: false }));
    localStorage.setItem("asha_live_calibration_" + patientId, JSON.stringify({ baseline: {}, enabled: [], savedAt: "2026-11-20" }));
    // Two fingers was practised three times in Quick gestures and means water.
    localStorage.setItem("asha_live_handmap_" + patientId, JSON.stringify({ "Two fingers extended": { kind: "water", trained: true } }));
    window.__utterances = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { window.__utterances.push(u); window.__output = u; } } });
  }, patientId);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/dashboard/patient");
  await page.getByRole("button", { name: /^Water/ }).waitFor();
  await page.getByText("Caregiver linked", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Start camera", exact: true }).first().click();
  await page.waitForFunction(() => window.__perception?.running);
  const hand = (pose) => page.evaluate((pose) => window.__perception.emit("hand", { id: "right", label: "Right", pose, t: performance.now() }), pose);
  const finishQuestion = () => page.evaluate(() => window.__output?.onend?.());
  const dialog = page.getByRole("dialog");

  // A pose that was never practised does nothing.
  await hand("Index extended");
  await page.waitForTimeout(300);
  assert.equal(await dialog.count(), 0, "an unmapped pose proposes nothing");

  // The practised pose proposes water and asks first; nothing is sent yet.
  await hand("Two fingers extended");
  await dialog.waitFor();
  await page.waitForFunction(() => window.__utterances.some((u) => /I need water/.test(u.text)));
  assert.equal(events.length, 0, "a proposal is not a request");

  // Showing it again while the question is still being spoken does not send.
  await hand("Other hand pose");
  await hand("Two fingers extended");
  await page.waitForTimeout(300);
  assert.equal(events.length, 0, "no confirmation before the question ends");

  // After the question, a separate showing of the pose sends it.
  await finishQuestion();
  await page.waitForTimeout(750);
  await hand("Other hand pose");
  await hand("Two fingers extended");
  for (let i = 0; i < 40 && events.length < 1; i++) await page.waitForTimeout(50);
  assert.equal(events.length, 1, "one request sent");
  assert.equal(events[0].kind, "water");
  assert.equal(events[0].source, "hand");
  assert.equal(events[0].confirmed, true);
  await dialog.waitFor({ state: "detached" });

  // Holding on right after a send does not start a second request.
  await hand("Other hand pose");
  await hand("Two fingers extended");
  await page.waitForTimeout(300);
  assert.equal(await dialog.count(), 0, "no repeat within 2.5 s of a send");
  assert.equal(events.length, 1);
  assert.deepEqual(errors, [], "no page errors");
  console.log("Gesture request browser: unmapped pose ignored; practised pose proposes water and asks first; no send while the question is spoken; a separate showing after it sends one confirmed request; no immediate repeat");
} finally {
  await context.close();
  await browser.close();
}
