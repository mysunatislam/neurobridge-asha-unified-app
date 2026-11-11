// EyeSpeak in the app, end to end with simulated eyes: the camera view shows the irises, the raw
// eye dot follows where the eyes look, a 12-dot calibration measures accuracy and picks a board,
// looking at "Water" proposes a request and looking at "Yes, send" confirms it. Accuracy for two
// halves reaches every word in steps; blink scanning needs no calibration. Noisy eyes get a
// smaller board or none. Typing with the eyes: "apple" letter by letter (a look opens A–E, the next
// look or a slow blink picks the letter), word suggestions, Speak it, and a sentence sent and
// confirmed by gaze; the same by halves and by blink scanning. Also: the spelling keyboard and Care
// journal open inside the app.
//   node tests/eyespeak-browser.mjs   (needs the dev server, NEXT_TEST_URL, default http://127.0.0.1:4180)
// The camera is replaced by a fake engine that emits the same "landmarks" events as the real one,
// with 478 face points whose irises move with a simulated point of gaze. This proves the software
// path; it says nothing about accuracy on a real person, which the page measures for each person.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NEXT_TEST_URL || "http://127.0.0.1:4180";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const errors = [];

const fakePerception = `
export class Perception extends EventTarget {
  constructor() { super(); this.running = false; this.snapshot = {}; this.pulse = {}; this.module = ""; this.facing = "user"; window.__perception = this; }
  async start() { this.running = true; }
  stop() { this.running = false; }
  setCalibration() {}
  setActiveModule(name) { this.module = name; }
  setMoveTracking() {}
  async setFacingMode(f) { this.facing = f; return f; }
  resetFaceReference() {}
  resetVitalsBaseline() {}
  resetVitalsSession() {}
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
}
`;

// Runs in the page: a face whose irises turn toward window.__look (screen fractions), or toward the
// calibration dot on screen. Gaussian noise of window.__noise (image fractions) on each iris.
// Real-world options: window.__frameMs (time between face results) with window.__lateMs extra random
// delay, window.__blinkEvery (ms) for a 200 ms blink with the eyes closed, window.__closedFrom/Until
// (performance.now times) for a slow blink, and window.__checkBias, an error added to where the eyes
// look only while calibration checks accuracy, to get a measured accuracy that fits 2 halves.
const eyesScript = () => {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  window.__look = { x: 0.5, y: 0.5 };
  window.__noise = window.__noise ?? 0.0002;
  const started = performance.now();
  const tick = () => {
    window.__eyes = setTimeout(tick, (window.__frameMs ?? 33) + Math.random() * (window.__lateMs ?? 0));
    if (!window.__perception?.running) return;
    const dot = document.querySelector("[data-testid=gaze-target]");
    const checking = !!dot && document.querySelector("[data-testid=calibration] p")?.textContent.startsWith("Checking");
    const g = dot ? { x: Number(dot.dataset.x) + (checking ? window.__checkBias ?? 0 : 0), y: Number(dot.dataset.y) } : window.__look;
    const t = performance.now();
    const blinking = window.__blinkEvery && (t - started) % window.__blinkEvery < 200;
    const closed = blinking || (t >= (window.__closedFrom ?? 0) && t < (window.__closedUntil ?? 0));
    const lid = closed ? 0.0005 : 0.01;
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const put = (i, x, y) => (face[i] = { x, y, z: 0 });
    put(33, 0.4, 0.4), put(133, 0.46, 0.4), put(159, 0.43, 0.4 - lid), put(145, 0.43, 0.4 + lid);
    put(362, 0.54, 0.4), put(263, 0.6, 0.4), put(386, 0.57, 0.4 - lid), put(374, 0.57, 0.4 + lid);
    put(1, 0.5, 0.5);
    // Looking toward the left of the screen moves the irises toward the right of the camera image.
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

async function setup({ viewport = { width: 1280, height: 860 }, noise = 0.0002, eyes = {} } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/engine/perception.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakePerception }));
  await context.route("**/api/session**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, events: [], status: null }) }));
  await context.addInitScript(({ noise, eyes }) => {
    window.__noise = noise;
    Object.assign(window, eyes);
    window.__utterances = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { window.__utterances.push(u.text); u.onend?.(); } } });
  }, { noise, eyes });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page };
}
const look = (page, x, y) => page.evaluate(([x, y]) => (window.__look = { x, y }), [x, y]);
const lookAtTile = (page, id) =>
  page.evaluate((id) => {
    const r = document.querySelector(`[data-tile="${id}"]`).getBoundingClientRect();
    window.__look = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
  }, id);
/** Close both eyes for `ms`, then open them again. */
async function slowBlink(page, ms = 650) {
  await page.evaluate((ms) => Object.assign(window, { __closedFrom: performance.now(), __closedUntil: performance.now() + ms }), ms);
  await page.waitForTimeout(ms + 300);
}
const tileIds = (page) => page.locator("[data-tile]").evaluateAll((els) => els.map((el) => el.dataset.tile));
const rawDotX = (page) => page.getByTestId("raw-eye-dot").evaluate((el) => parseFloat(el.style.left));

async function startEyes(page) {
  await page.goto(base + "/dashboard/patient/eyespeak");
  await page.getByRole("heading", { name: "EyeSpeak", level: 1 }).waitFor();
  assert.equal(await page.locator('nav[aria-label="Patient navigation"] [aria-current=page]').textContent(), "Communicate");
  await page.getByTestId("eye-status").getByText("Camera off").waitFor();
  await page.getByRole("button", { name: "Start camera" }).first().click();
  await page.waitForFunction(() => window.__perception?.running);
  assert.equal(await page.evaluate(() => window.__perception.module), "eyespeak", "the engine sends face points to EyeSpeak");
  await page.evaluate(eyesScript);
  await page.getByTestId("eye-status").getByText("Both eyes and irises tracked").waitFor();
}

// ---------- 1. Tracking is visible, calibration measures accuracy, gaze chooses and confirms ----------
{
  const { context, page } = await setup();
  await startEyes(page);
  await page.waitForFunction(() => document.querySelector("[data-testid=eye-overlay]")?.dataset.irises === "2");
  await look(page, 0.1, 0.5);
  await page.waitForFunction(() => parseFloat(document.querySelector("[data-testid=raw-eye-dot]")?.style.left) < 40);
  const left = await rawDotX(page);
  await look(page, 0.9, 0.5);
  await page.waitForFunction(() => parseFloat(document.querySelector("[data-testid=raw-eye-dot]")?.style.left) > 60);
  assert.ok((await rawDotX(page)) > left, "the raw eye dot follows the eyes");
  assert.equal(await page.getByTestId("open-board").isDisabled(), true, "no board before calibration");

  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("calibration").waitFor();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  const mean = parseFloat(await page.getByTestId("mean-error").textContent());
  assert.ok(mean <= 6, `steady simulated eyes are accurate (mean ${mean}%)`);
  assert.equal(await page.getByTestId("board-size").textContent(), "9 tiles");
  console.log(`  steady eyes: mean ${mean}% -> 9 tiles`);

  await page.getByTestId("open-board").click();
  await page.locator("[data-testid=gaze-board][data-size='9']").waitFor();
  await lookAtTile(page, "water");
  await page.getByTestId("gaze-dot").evaluate((el) => new Promise((ok) => { const t = setInterval(() => el.style.opacity === "1" && (clearInterval(t), ok()), 30); }));
  await page.getByTestId("board-note").getByText("Send to your caregiver: “I need water”?").waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0, "the board asks by gaze, not with the small dialog");
  await page.locator("[data-testid=gaze-board][data-size='2']").waitFor();
  // The eyes are still where Water was, now the "No" half: nothing is chosen until they move.
  await page.waitForTimeout(2000);
  assert.equal(await page.locator("[data-testid=gaze-board][data-size='2']").count(), 1, "a still gaze does not answer No");
  await lookAtTile(page, "confirm-yes");
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor();
  // Back on the 9 tiles the eyes rest on Toilet: it must not start filling on its own.
  await page.waitForTimeout(1600);
  const filling = await page.evaluate(() => [...document.querySelectorAll("[data-tile]")].filter((el) => parseFloat(el.style.getPropertyValue("--dwell")) > 0).map((el) => el.dataset.tile));
  assert.deepEqual(filling, [], "no tile fills under a still gaze after the board changes");
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor();
  // Touch still works on the board.
  await look(page, 0.5, 0.02);
  await page.waitForTimeout(2600); // the request cooldown
  await page.locator('[data-tile="yes"]').click();
  await page.getByTestId("board-note").getByText("Said: Yes").waitFor();
  assert.ok((await page.evaluate(() => window.__utterances.join("|"))).includes("Yes"));
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("gaze-board").waitFor({ state: "detached" });

  // Remembered only on request, and then it must pass the quick check again.
  await page.getByRole("switch", { name: /Remember this calibration/ }).check({ force: true });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("asha_live_eyespeak_v1")));
  assert.ok(saved.model && saved.screen && !("video" in saved), "saves numbers and screen size only");
  await page.reload();
  await page.getByText("A calibration from an earlier visit is saved on this device").waitFor();
  assert.equal(await page.getByTestId("open-board").isDisabled(), true, "a saved calibration needs the check first");
  await context.close();
}

// ---------- 1b. Real-world eyes on the board: slow and late face results, blinks, jitter ----------
// A slower computer delivers a face result every 120-450 ms; eyes blink and the estimate wobbles.
// Looking at Water must still fill it, and looking at "Yes, send" must still confirm.
{
  const { context, page } = await setup({ noise: 0.0005 });
  await startEyes(page);
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  const board = await page.getByTestId("board-size").textContent();
  assert.ok(["9 tiles", "6 large tiles"].includes(board), `a board with Water (${board})`);
  await page.evaluate(() => Object.assign(window, { __noise: 0.0009, __frameMs: 120, __lateMs: 330, __blinkEvery: 2000 }));
  await page.getByTestId("open-board").click();
  await page.getByTestId("gaze-board").waitFor();
  await page.waitForTimeout(800);
  const started = Date.now();
  await lookAtTile(page, "water");
  await page.getByTestId("board-note").getByText("Send to your caregiver: “I need water”?").waitFor({ timeout: 10000 });
  const waterMs = Date.now() - started;
  await page.locator("[data-testid=gaze-board][data-size='2']").waitFor();
  const yesAt = Date.now();
  await lookAtTile(page, "confirm-yes");
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor({ timeout: 10000 });
  console.log(`  slow, blinking, jittery eyes (${board}): Water chosen after ${(waterMs / 1000).toFixed(1)} s, confirmed after ${((Date.now() - yesAt) / 1000).toFixed(1)} s`);
  await context.close();
}

// ---------- 1c. Accuracy for only two halves: every word is reached in steps of two halves ----------
{
  const { context, page } = await setup({ eyes: { __checkBias: 0.14 } });
  await startEyes(page);
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  assert.equal(await page.getByTestId("board-size").textContent(), "2 halves of the screen, chosen in steps");
  assert.equal(await page.getByTestId("cursor-toggle").isDisabled(), true, "the eye cursor needs more accuracy than halves");
  await page.getByTestId("open-board").click();
  await page.locator("[data-testid=gaze-board][data-size='steps']").waitFor();
  assert.deepEqual(await tileIds(page), ["g-yesno", "g-more"]);
  assert.match(await page.locator('[data-tile="g-more"]').textContent(), /Water · Food · Toilet/, "More words lists what it holds");
  // Look right: More words opens two more halves.
  await lookAtTile(page, "g-more");
  await page.getByTestId("board-note").getByText("More words. Close your eyes for 2 seconds to go back.").waitFor();
  assert.deepEqual(await tileIds(page), ["g-wft", "g-rest"]);
  // The eyes are still on the right, now "Pain and more": nothing is chosen until they move.
  await page.waitForTimeout(2000);
  assert.deepEqual(await tileIds(page), ["g-wft", "g-rest"], "a still gaze does not choose the new half under it");
  await lookAtTile(page, "g-wft");
  await page.getByTestId("board-note").getByText("More words › Water, food or toilet.", { exact: false }).waitFor();
  assert.deepEqual(await tileIds(page), ["water", "g-ft"]);
  // Water is now under the eyes. A slow blink chooses it at once.
  await page.waitForTimeout(500);
  await slowBlink(page);
  await page.getByTestId("board-note").getByText("Send to your caregiver: “I need water”?").waitFor();
  assert.equal(await page.getByTestId("gaze-board").getAttribute("data-chosen-by"), "blink");
  await lookAtTile(page, "confirm-yes");
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor();
  assert.deepEqual(await tileIds(page), ["g-yesno", "g-more"], "after a word, the board starts from the top");
  // Closing the eyes for two seconds goes back a step; so does Back.
  // To choose the side the eyes are already on, they glance away (here, to the top left corner) and back.
  await look(page, 0.02, 0.02);
  await page.waitForTimeout(1200);
  await lookAtTile(page, "g-more");
  await page.getByTestId("board-note").getByText("More words.", { exact: false }).waitFor();
  await slowBlink(page, 2200);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-tile]")].map((el) => el.dataset.tile).join() === "g-yesno,g-more");
  assert.equal(await page.getByTestId("board-back").count(), 0);
  await page.locator('[data-tile="g-more"]').click();
  await page.locator('[data-tile="g-rest"]').click();
  assert.deepEqual(await tileIds(page), ["g-ph", "g-ct"]);
  await page.getByTestId("board-back").click();
  assert.deepEqual(await tileIds(page), ["g-wft", "g-rest"]);
  console.log("  2-halves accuracy: More words, then Water, food or toilet, then Water by slow blink, confirmed by looking; eyes closed 2 s went back");
  // Typing at this accuracy: two halves at a time, A is a few looks.
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("open-spell").click();
  await page.locator("[data-testid=gaze-board][data-spell][data-size='steps']").waitFor();
  assert.deepEqual(await tileIds(page), ["g-am", "g-nz"]);
  for (let i = 0; i < 6 && !(await page.locator('[data-tile="k-a"]').count()); i++) await page.locator("[data-tile]").first().click();
  await page.locator('[data-tile="k-a"]').click();
  assert.equal(await page.getByTestId("spell-text").getAttribute("data-text"), "a");
  assert.deepEqual(await tileIds(page), ["g-am", "g-nz"], "after a letter, the halves start from the top");
  await context.close();
}

// ---------- 1e. Typing with the eyes: any word letter by letter, a suggestion, then speak and send ----------
// "apple": A–E then A (by slow blink, the eyes still where A–E was), P–T then P, P–T then P, K–O
// then L, A–E then E. Between looks the eyes glance at the message, as a person reads what they wrote.
{
  const { context, page } = await setup();
  await startEyes(page);
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  assert.equal(await page.getByTestId("board-size").textContent(), "9 tiles");
  await page.getByTestId("open-spell").click();
  const board = page.locator("[data-testid=gaze-board][data-spell][data-size='9']");
  await board.waitFor();
  const typed = () => page.getByTestId("spell-text").getAttribute("data-text");
  assert.deepEqual(await tileIds(page), ["g-ae", "g-fj", "g-ko", "g-pt", "g-uz", "g-words", "k-space", "k-delete", "g-done"]);
  assert.equal(await typed(), "");
  const readMessage = async () => {
    await page.getByTestId("spell-text").evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.__look = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
    });
    // Long enough for a tile still under the eyes after the layout changed to be released.
    await page.waitForTimeout(1300);
  };
  const lookUntil = async (id, done) => {
    await readMessage();
    await lookAtTile(page, id);
    await page.waitForFunction(done, null, { timeout: 10000 });
  };
  const opened = (first) => `document.querySelector('[data-tile="${first}"]') !== null`;
  const text = (t) => `document.querySelector('[data-testid=spell-text]')?.dataset.text === ${JSON.stringify(t)}`;
  const started = Date.now();
  await lookUntil("g-ae", opened("k-a"));
  assert.deepEqual(await tileIds(page), ["k-a", "k-b", "k-c", "k-d", "k-e", "k-back"]);
  await page.waitForTimeout(500);
  await slowBlink(page);
  await page.waitForFunction(text("a"));
  assert.equal(await board.getAttribute("data-chosen-by"), "blink", "the slow blink typed A");
  for (const [grp, key, after] of [["g-pt", "k-p", "ap"], ["g-pt", "k-p", "app"], ["g-ko", "k-l", "appl"], ["g-ae", "k-e", "apple"]]) {
    await lookUntil(grp, opened(key));
    await lookUntil(key, text(after));
  }
  assert.equal(await page.getByTestId("spell-text").textContent(), "APPLE");
  console.log(`  typed "apple" with the eyes in ${((Date.now() - started) / 1000).toFixed(1)} s (10 looks, one slow blink)`);
  // Words finish what is typed; Space ends the word.
  await lookUntil("g-words", opened("w-apples"));
  await lookUntil("k-back", opened("g-ae"));
  await lookUntil("k-space", text("apple "));
  // Speak it aloud.
  await lookUntil("g-done", opened("k-speak"));
  await lookUntil("k-speak", "window.__utterances.includes('Apple')");
  await page.getByTestId("board-note").getByText("Said: Apple").waitFor();
  // A whole sentence from suggestions: Words, then I; Words, then need; Words, then water.
  await lookUntil("g-done", opened("k-clear"));
  await lookUntil("k-clear", text(""));
  for (const [w, after] of [["w-i", "i "], ["w-need", "i need "], ["w-water", "i need water "]]) {
    await lookUntil("g-words", opened(w));
    await lookUntil(w, text(after));
  }
  // Send it: the same confirmation as any request, answered by looking at Yes, send.
  await page.waitForTimeout(2600); // the request cooldown after speaking
  await lookUntil("g-done", opened("k-send"));
  await lookUntil("k-send", opened("confirm-yes"));
  await page.getByTestId("board-note").getByText("Send to your caregiver: “I need water”?").waitFor();
  await page.waitForTimeout(800);
  await lookAtTile(page, "confirm-yes");
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor();
  await page.waitForFunction(text(""));
  assert.equal(await page.locator('[data-tile="g-ae"]').count(), 1, "back to the letters, ready for the next message");
  // Closing the eyes for two seconds leaves a group of letters, like Back.
  await lookUntil("g-uz", opened("k-z"));
  await page.waitForTimeout(500);
  await slowBlink(page, 2200);
  await page.waitForFunction(opened("g-ae"));
  // Touch types too.
  await page.locator('[data-tile="g-fj"]').click();
  await page.locator('[data-tile="k-h"]').click();
  await page.locator('[data-tile="g-fj"]').click();
  await page.locator('[data-tile="k-i"]').click();
  assert.equal(await typed(), "hi");
  console.log("  then a suggestion, Space, Speak it, a 3-word sentence from suggestions, sent and confirmed by gaze");
  await context.close();
}

// ---------- 1d. Blink scanning: no calibration, a light moves and a slow blink chooses ----------
{
  const { context, page } = await setup();
  await startEyes(page);
  assert.equal(await page.getByTestId("open-board").isDisabled(), true, "no gaze board without calibration");
  await page.getByTestId("open-scan").click();
  const board = page.locator("[data-testid=gaze-board][data-mode='scan']");
  await board.waitFor();
  assert.equal(await page.getByTestId("gaze-dot").count(), 0, "no gaze ring when scanning");
  assert.equal((await tileIds(page)).length, 9, "all 9 words");
  // Blink slowly once Water is lit.
  await page.locator('[data-tile="water"][data-scan]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
  await slowBlink(page);
  await page.getByTestId("board-note").getByText("Send to your caregiver: “I need water”? Blink slowly when your answer is lit.").waitFor();
  assert.equal(await board.getAttribute("data-chosen-by"), "scan");
  // The answers start with No, then Yes, send.
  await page.locator('[data-tile="confirm-no"][data-scan]').waitFor();
  await page.locator('[data-tile="confirm-yes"][data-scan]').waitFor();
  await page.waitForTimeout(350);
  await slowBlink(page);
  await page.getByTestId("board-note").getByText("Recognised on this device").waitFor();
  // A blink that begins just as the light moves could be meant for either word: nothing is chosen.
  const spoken = await page.evaluate(() => window.__utterances.length);
  await page.evaluate(
    () =>
      new Promise((done) => {
        const food = document.querySelector('[data-tile="food"]');
        new MutationObserver((_, obs) => {
          if (!food.dataset.scan) return;
          obs.disconnect();
          Object.assign(window, { __closedFrom: performance.now(), __closedUntil: performance.now() + 650 });
          done();
        }).observe(food, { attributes: true });
      }),
  );
  await page.getByTestId("board-status").getByText("That blink began just as the light moved").waitFor();
  assert.equal(await page.getByTestId("board-note").textContent(), "Recognised on this device. Connect a caregiver to deliver requests.", "the ambiguous blink chose nothing");
  // Ordinary quick blinks don't choose either.
  await page.evaluate(() => (window.__blinkEvery = 1500));
  await page.waitForTimeout(6000);
  assert.equal(await page.evaluate(() => window.__utterances.length), spoken, "natural blinks say nothing");
  assert.equal(await page.getByTestId("board-note").textContent(), "Recognised on this device. Connect a caregiver to deliver requests.");
  console.log("  blink scanning without calibration: Water and Yes, send chosen by slow blinks; a blink as the light moved and natural blinks chose nothing");
  // Typing by blink scanning: A–E is lit first, then A.
  await page.evaluate(() => (window.__blinkEvery = 0));
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("open-spell-scan").click();
  await page.locator("[data-testid=gaze-board][data-spell][data-mode='scan']").waitFor();
  await page.locator('[data-tile="g-ae"][data-scan]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
  await slowBlink(page);
  await page.locator('[data-tile="k-a"][data-scan]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
  await slowBlink(page);
  await page.waitForFunction(() => document.querySelector("[data-testid=spell-text]")?.dataset.text === "a");
  console.log("  typing by blink scanning: A–E, then A");
  await context.close();
}

// ---------- 2. Noisy eyes: a smaller board or none, never a board the accuracy can't support ----------
{
  const { context, page } = await setup({ noise: 0.0035 });
  await startEyes(page);
  await page.getByRole("button", { name: "Start calibration" }).click();
  await page.getByTestId("accuracy").waitFor({ timeout: 60000 });
  const mean = parseFloat(await page.getByTestId("mean-error").textContent()) / 100;
  const p90 = parseFloat(await page.getByTestId("p90-error").textContent()) / 100;
  const board = await page.getByTestId("board-size").textContent();
  const expected = p90 <= 0.09 && mean <= 0.06 ? "9 tiles" : p90 <= 0.16 && mean <= 0.11 ? "6 large tiles" : p90 <= 0.26 && mean <= 0.18 ? "2 halves of the screen, chosen in steps" : "Not reliable enough yet";
  assert.equal(board, expected, `board follows the measured accuracy (mean ${mean}, p90 ${p90})`);
  assert.notEqual(board, "9 tiles", "noisy eyes don't get the small tiles");
  assert.equal(await page.getByTestId("open-board").isDisabled(), board === "Not reliable enough yet");
  console.log(`  noisy eyes: mean ${(mean * 100).toFixed(1)}%, p90 ${(p90 * 100).toFixed(1)}% -> ${board}`);
  await context.close();
}

// ---------- 3. Spelling keyboard and Care journal open inside the app, without the old menus ----------
{
  const { context, page } = await setup();
  await page.goto(base + "/dashboard/patient/communicate");
  await page.getByRole("link", { name: /^EyeSpeak/ }).click();
  await page.waitForURL("**/dashboard/patient/eyespeak");
  await page.getByRole("link", { name: /Full keyboard, phrases and Bangla/ }).click();
  await page.waitForURL("**/dashboard/patient/eyespeak/keyboard");
  const kb = page.frameLocator('iframe[title="Spell a message"]');
  await kb.locator("[data-tiles] button").first().waitFor();
  assert.equal(await kb.locator(".sidebar").isVisible(), false, "no second menu");
  assert.equal(await kb.locator("[data-calibrate]").isVisible(), false, "gaze lives on the EyeSpeak page");
  assert.equal(await page.locator('nav[aria-label="Patient navigation"] [aria-current=page]').textContent(), "Communicate");

  await page.goto(base + "/dashboard/patient/wellbeing");
  await page.getByRole("link", { name: /^Care journal/ }).click();
  await page.waitForURL("**/dashboard/patient/care");
  const care = page.frameLocator('iframe[title="Care journal"]');
  await care.getByText("Your journal").waitFor();
  assert.equal(await care.locator(".topbar .brand").isVisible(), false);
  const h = await page.locator('iframe[title="Care journal"]').evaluate((f) => f.getBoundingClientRect().height);
  assert.ok(h > 900, `the journal frame grows to its content (${h}px)`);
  assert.equal(await page.locator('nav[aria-label="Patient navigation"] [aria-current=page]').textContent(), "Wellbeing");
  await context.close();
}

// ---------- 4. Phone width ----------
{
  const { context, page } = await setup({ viewport: { width: 390, height: 844 } });
  for (const path of ["/dashboard/patient/eyespeak", "/dashboard/patient/eyespeak/keyboard", "/dashboard/patient/care"]) {
    await page.goto(base + path);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForTimeout(500);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 1, `${path} overflows by ${wide}px`);
  }
  await context.close();
}

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log("EyeSpeak browser: visible eye tracking, calibration with measured accuracy, adaptive board, steps of two halves, blink scanning without calibration, typing with the eyes, gaze request and confirmation, noisy-eye fallback, keyboard and Care in the app, phone layout passed");
