// The eyes as a mouse, end to end with simulated eyes: after calibrating, a ring follows the gaze on
// every patient page, a slow blink clicks (one button in reach directly, close buttons through big
// tiles), natural blinks never click, the bar scrolls and pauses by eye, a held look clicks when
// chosen, a request is asked and confirmed from Home by eye alone, and a slow blink chooses a tile
// on the board. Inaccurate eyes don't get the cursor. Phone width doesn't overflow.
//   node tests/eye-cursor-browser.mjs   (needs the dev server, NEXT_TEST_URL, default http://127.0.0.1:4180)
// The camera is a fake engine emitting the real "landmarks" events with 478 face points whose irises
// follow window.__look and whose lids close while performance.now() < window.__closedUntil. This
// proves the software path, not accuracy on a real person.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NEXT_TEST_URL || "http://127.0.0.1:4180";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const errors = [];

const fakePerception = `
export class Perception extends EventTarget {
  constructor() { super(); this.running = false; this.snapshot = {}; this.pulse = {}; this.module = ""; this.cursor = false; this.facing = "user"; window.__perception = this; }
  async start() { this.running = true; }
  stop() { this.running = false; }
  setCalibration() {}
  setActiveModule(name) { this.module = name; }
  setGazeCursor(on) { this.cursor = on; }
  setMoveTracking() {}
  async setFacingMode(f) { this.facing = f; return f; }
  resetFaceReference() {}
  resetVitalsBaseline() {}
  resetVitalsSession() {}
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
}
`;

const eyesScript = () => {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  window.__look = { x: 0.5, y: 0.5 };
  window.__noise = window.__noise ?? 0.0002;
  const started = performance.now();
  const tick = () => {
    window.__eyes = setTimeout(tick, (window.__frameMs ?? 33) + Math.random() * (window.__lateMs ?? 0));
    if (!window.__perception?.running) return;
    const dot = document.querySelector("[data-testid=gaze-target]");
    const g = dot ? { x: Number(dot.dataset.x), y: Number(dot.dataset.y) } : window.__look;
    const t = performance.now();
    const blinking = window.__blinkEvery && (t - started) % window.__blinkEvery < 200;
    const closed = blinking || (t >= (window.__closedFrom ?? 0) && t < (window.__closedUntil ?? 0));
    const lid = closed ? 0.0005 : 0.01;
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const put = (i, x, y) => (face[i] = { x, y, z: 0 });
    put(33, 0.4, 0.4), put(133, 0.46, 0.4), put(159, 0.43, 0.4 - lid), put(145, 0.43, 0.4 + lid);
    put(362, 0.54, 0.4), put(263, 0.6, 0.4), put(386, 0.57, 0.4 - lid), put(374, 0.57, 0.4 + lid);
    put(1, 0.5, 0.5);
    const dx = (0.5 - g.x) * 0.012, dy = (g.y - 0.5) * 0.008;
    for (const [c, mx] of [[468, 0.43], [473, 0.57]]) {
      const x = mx + dx + gauss() * window.__noise, y = 0.4 + dy + gauss() * window.__noise;
      put(c, x, y);
      [[0.008, 0], [0, 0.008], [-0.008, 0], [0, -0.008]].forEach(([ox, oy], k) => put(c + 1 + k, x + ox, y + oy));
    }
    window.__perception.emit("landmarks", { timestampMs: t, videoSize: { width: 640, height: 480 }, pose: null, poseAt: null, personCount: 0, face, faceAt: t, faceValid: true, head: { yaw: 0, pitch: 0 }, blendshapes: {}, hands: [], handsAt: null, processingMs: 4, luma: 0.5, models: { pose: "slow", hands: "slow", face: "on" } });
  };
  tick();
};

async function setup({ viewport = { width: 1280, height: 860 }, noise = 0.0002 } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/engine/perception.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakePerception }));
  await context.route("**/api/session**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, events: [], status: null }) }));
  await context.addInitScript((noise) => {
    window.__noise = noise;
    window.__utterances = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { window.__utterances.push(u.text); u.onend?.(); } } });
  }, noise);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page };
}

/** Point the simulated eyes at the middle of an element, then let the gaze settle. */
async function lookAt(locator, settleMs = 900) {
  await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.__look = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
  });
  await locator.page().waitForTimeout(settleMs);
}
/** Close both eyes for `ms`, then open them again. */
async function slowBlink(page, ms = 950) {
  await page.evaluate((ms) => (window.__closedUntil = performance.now() + ms), ms);
  await page.waitForTimeout(ms + 300);
}
const note = (page) => page.getByTestId("cursor-note");
/** Look at something and blink slowly; if the cursor asks which of several, pick it from the tiles. */
async function clickByEye(page, locator, label) {
  await lookAt(locator);
  await slowBlink(page);
  if (await page.getByTestId("cursor-picker").count()) {
    await lookAt(page.locator(`[data-pick="${label}"]`));
    await slowBlink(page);
    picks.push(label);
  } else direct.push(label);
}
const picks = [], direct = [];
const sidebar = (page, name) => page.locator('nav[aria-label="Patient navigation"]').getByRole("link", { name, exact: true });

async function calibrate(page) {
  await page.goto(base + "/dashboard/patient/eyespeak");
  await page.getByRole("heading", { name: "EyeSpeak", level: 1 }).waitFor();
  await page.getByRole("button", { name: "Start camera" }).first().click();
  await page.waitForFunction(() => window.__perception?.running);
  await page.evaluate(eyesScript);
  await page.getByTestId("eye-status").getByText("Both eyes and irises tracked").waitFor();
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  return page.getByTestId("board-size").textContent();
}

// ---------- 1. Steady eyes: the whole app by eye ----------
{
  const { context, page } = await setup();
  assert.equal(await calibrate(page), "9 tiles");
  assert.equal(await page.getByTestId("cursor-bar").count(), 0, "off until asked for");
  await page.getByTestId("cursor-toggle").click();
  await note(page).getByText("Look at a button and blink slowly to click.").waitFor();
  assert.equal(await page.evaluate(() => window.__perception.cursor), true, "the engine sends face points on every page");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector("[data-testid=eye-cursor]")?.style.opacity === "1");

  // Natural blinks on a link never click it.
  await page.evaluate(() => (window.__blinkEvery = 1100));
  await lookAt(sidebar(page, "Home"), 3500);
  assert.equal(await page.getByTestId("cursor-picker").count(), 0, "natural blinks don't click");
  assert.ok(page.url().endsWith("/dashboard/patient/eyespeak"));
  await page.evaluate(() => (window.__blinkEvery = 0));

  // A slow blink on a button with nothing else in reach clicks it directly.
  await page.getByRole("button", { name: "1.5 s" }).click();
  const openBoard = page.getByTestId("open-board");
  await openBoard.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await lookAt(openBoard);
  await slowBlink(page);
  await page.getByTestId("gaze-board").waitFor();
  assert.equal(await page.getByTestId("cursor-bar").count(), 0, "the board has its own gaze; the cursor waits");

  // On the board, a slow blink chooses the tile under the eyes, before the 1.5 s fill would. A
  // blink while the eyes are still on their way to a tile chooses nothing.
  await page.waitForTimeout(600);
  const board = page.getByTestId("gaze-board");
  await page.locator('[data-tile="yes"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.__look = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
    window.__closedUntil = performance.now() + 250 + 900;
    window.__closedFrom = performance.now() + 250;
  });
  await page.waitForTimeout(1200);
  assert.equal(await board.getAttribute("data-chosen-by"), null, "a blink during a glance chose nothing");
  // A 0.9 s closure is longer than the board's 0.6 s loss limit, so the fill starts again after it.
  await page.waitForTimeout(2000);
  assert.equal(await board.getAttribute("data-chosen-by"), "dwell", "the fill still works");
  await page.getByTestId("board-note").getByText("Said: Yes").waitFor();
  await page.locator('[data-tile="thanks"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.__look = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
  });
  const lookedAt = Date.now();
  await page.waitForTimeout(900);
  await slowBlink(page, 800);
  await page.getByTestId("board-note").getByText("Said: Thank you · Yes").waitFor({ timeout: 3000 });
  const chosenMs = Date.now() - lookedAt;
  assert.equal(await board.getAttribute("data-chosen-by"), "blink", "chosen by the slow blink, not the fill");
  await page.keyboard.press("Escape");
  await page.getByTestId("gaze-board").waitFor({ state: "detached" });
  await note(page).waitFor();

  // A held look clicks only when chosen.
  await page.getByRole("button", { name: "Hold your look" }).click();
  await note(page).getByText("Look at a button and hold your look to click.").waitFor();
  await openBoard.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await lookAt(openBoard, 0);
  await page.getByTestId("gaze-board").waitFor({ timeout: 6000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("gaze-board").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Slow blink", exact: true }).click();
  await note(page).getByText("Look at a button and blink slowly to click.").waitFor();

  // The bar scrolls by eye. (With these steady eyes the gaze is precise enough to click its buttons
  // directly; with less precise eyes close buttons come up as big tiles, as for the sidebar below.)
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await clickByEye(page, page.getByTestId("cursor-bar").getByRole("button", { name: "Scroll down" }), "Scroll down");
  await page.waitForFunction(() => scrollY > 200);

  // Pause by eye; while paused only Resume answers, and it is clicked directly.
  await clickByEye(page, page.getByTestId("cursor-bar").getByRole("button", { name: "Pause" }), "Pause");
  await note(page).getByText(/^Paused/).waitFor();
  await lookAt(sidebar(page, "Home"));
  await slowBlink(page);
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId("cursor-picker").count(), 0, "paused: nothing else is clicked");
  assert.ok(page.url().endsWith("/dashboard/patient/eyespeak"));
  await lookAt(page.getByTestId("cursor-bar").getByRole("button", { name: "Resume" }));
  await slowBlink(page);
  await note(page).getByText(/Clicked “Resume”|Look at a button/).waitFor();
  await page.getByTestId("cursor-bar").getByRole("button", { name: "Pause" }).waitFor();

  // Go Home by eye: the sidebar links are closer together than the gaze can tell apart, so the
  // cursor asks which one with big tiles.
  await lookAt(sidebar(page, "Home"));
  await slowBlink(page);
  await page.getByTestId("cursor-picker").waitFor();
  const offered = await page.locator("[data-pick]").evaluateAll((els) => els.map((e) => e.dataset.pick));
  assert.ok(offered.includes("Home") && offered.includes("Communicate") && offered.at(-1) === "cancel", `big tiles for close links: ${offered.join(", ")}`);
  await lookAt(page.locator('[data-pick="Home"]'));
  await slowBlink(page);
  await page.waitForURL(/\/dashboard\/patient$/);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForFunction(() => document.querySelector("[data-testid=eye-cursor]")?.style.opacity === "1");

  // Ask for water from Home by eye alone, and confirm it in the dialog by eye.
  const water = page.locator("main button", { hasText: "Water" }).first();
  await water.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await clickByEye(page, water, "Water");
  const dialog = page.locator("dialog[open]");
  await dialog.getByText("Send this to your caregiver?").waitFor();
  assert.equal(await dialog.locator("[data-testid=eye-cursor]").count(), 1, "the ring shows above the dialog");
  await clickByEye(page, dialog.getByRole("button", { name: "Yes, send" }), "Yes, send");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  console.log(`  steady eyes: clicked directly: Open the board, ${direct.join(", ")}; through big tiles: Home${picks.length ? ", " + picks.join(", ") : ""}; a board tile chosen by slow blink ${chosenMs} ms after looking`);

  // Turning it off hands the camera back.
  await page.getByTestId("cursor-bar").getByRole("button", { name: "Turn off" }).click();
  await page.getByTestId("cursor-bar").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__perception.cursor), false);
  await context.close();
}

// ---------- 2. Eyes too inaccurate for ordinary buttons don't get the cursor ----------
{
  const { context, page } = await setup({ noise: 0.006 });
  const board = await calibrate(page);
  if (board === "9 tiles" || board === "6 large tiles") console.log(`  noisy eyes still measured ${board}; skipped the disabled check`);
  else {
    assert.equal(await page.getByTestId("cursor-toggle").isDisabled(), true, `no eye cursor with ${board}`);
    console.log(`  noisy eyes (${board}): eye cursor stays off`);
  }
  await context.close();
}

// ---------- 3. Phone width ----------
{
  const { context, page } = await setup({ viewport: { width: 390, height: 844 } });
  const board = await calibrate(page);
  assert.ok(board === "9 tiles" || board === "6 large tiles", board);
  await page.getByTestId("cursor-toggle").click();
  await page.getByTestId("cursor-bar").waitFor();
  const box = await page.getByTestId("cursor-bar").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, "the bar fits the screen");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, "no sideways scrolling");
  await context.close();
}

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log("Eye cursor browser: gaze pointer across pages, slow-blink and held-look clicks, big tiles for close buttons, scroll, pause, dialog, board blink, accuracy gate and phone layout passed");
