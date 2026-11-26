// ASHA Nutrition V5 end to end in headless Chromium against the dev server.
//
// The camera is a canvas stream and the food classifier worker is a stand-in that answers with
// scripted labels (set from the test through a BroadcastChannel), so the flow can be checked
// exactly: freeze once, inference paused after the freeze, Retake, manual shutter, upload with
// rotation, errors for bad files, a three-food Bangladeshi plate, permission refused in Bangla on a
// 390 px phone, one log write only, and the camera released. The real classifier is checked
// separately (docs/NUTRITION_V5.md) because its test photos can't be shipped with the repo.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NEXT_TEST_URL || "http://127.0.0.1:4180";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const errors = [];
const URL_ = `${base}/dashboard/patient/nutrition`;

const fakePerception = `
export class Perception extends EventTarget {
  constructor() { super(); this.running = false; this.snapshot = {}; this.pulse = {}; window.__perception = this; }
  async start() { this.running = true; }
  stop() { this.running = false; }
  setCalibration() {} setActiveModule() {} setMoveTracking() {} async setFacingMode(f) { return f; }
  resetFaceReference() {} resetVitalsBaseline() {} resetVitalsSession() {}
}`;

const fakeWorker = `
let script = { categories: [{ label: "banana", score: 0.8 }], faceCount: 0, warnings: [], delay: 10 };
const bc = new BroadcastChannel("fake-food");
bc.onmessage = (e) => { script = { ...script, ...e.data }; };
bc.postMessage({ hello: true }); // ask the page for the script set before this worker started
let n = 0;
self.onmessage = ({ data: d }) => {
  if (d.type === "init") return self.postMessage({ type: "ready", loadMs: 1, faceCheck: true });
  if (d.type !== "classify") return;
  n += 1;
  bc.postMessage({ classified: n, size: [d.crop?.width, d.crop?.height] });
  d.crop?.close?.(); d.frame?.close?.();
  const s = script;
  setTimeout(() => self.postMessage({ type: "result", id: d.id, categories: s.categories, quality: { warnings: s.warnings, brightness: 120, sharpness: 300 }, faceCount: s.faceCount, ms: 5 }), s.delay);
};`;

async function setup({ viewport = { width: 1280, height: 900 }, denyCamera = false, store = null } = {}) {
  const context = await browser.newContext({ viewport });
  await context.route("**/engine/perception.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakePerception }));
  await context.route("**/engine/food-classifier-worker.js", (r) => r.fulfill({ contentType: "text/javascript", body: fakeWorker }));
  await context.route("**/api/session**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, events: [], status: null }) }));
  await context.addInitScript(
    ({ denyCamera, store }) => {
      if (store && !sessionStorage.getItem("seeded")) {
        localStorage.setItem("asha_live_nutrition_v5", JSON.stringify(store));
        sessionStorage.setItem("seeded", "1");
      }
      window.__classified = 0;
      window.__streams = [];
      const bc = new BroadcastChannel("fake-food");
      let last = {};
      bc.onmessage = (e) => {
        if (e.data.hello) bc.postMessage(last);
        if (e.data.classified) window.__classified = e.data.classified;
        if (e.data.size) window.__cropSize = e.data.size;
      };
      window.__script = (s) => {
        last = { ...last, ...s };
        bc.postMessage(s);
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { u.onend?.(); } } });
      const gum = async () => {
        if (denyCamera) throw new DOMException("Permission denied", "NotAllowedError");
        const c = Object.assign(document.createElement("canvas"), { width: 640, height: 480 });
        const ctx = c.getContext("2d");
        const draw = () => {
          ctx.fillStyle = "#d9b44a";
          ctx.fillRect(0, 0, 640, 480);
          for (let i = 0; i < 300; i++) {
            ctx.fillStyle = `hsl(${(i * 37) % 360},60%,${30 + (i % 40)}%)`;
            ctx.fillRect((i * 53) % 640, (i * 97) % 480, 14, 14);
          }
        };
        draw();
        setInterval(draw, 100);
        const s = c.captureStream(15);
        window.__streams.push(s);
        return s;
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: gum });
    },
    { denyCamera, store },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    if (process.env.DEBUG) console.error("pageerror:", e.message);
  });
  return { context, page };
}

const screenIs = (page, s) => page.locator(`[data-testid=nutrition-page][data-screen=${s}]`).waitFor();
const screen = (page) => page.getByTestId("nutrition-page").getAttribute("data-screen");
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("asha_live_nutrition_v5") || "{}"));
const camerasReleased = (page) => page.evaluate(() => window.__streams.length > 0 && window.__streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
const classified = (page) => page.evaluate(() => window.__classified);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (page, id) => page.locator(`[data-testid=nutrition-question][data-question=${id}]`).waitFor();
const pick = async (page, id, name) => {
  await q(page, id);
  await page.locator(`[data-testid=nutrition-question][data-question=${id}]`).getByRole("button", { name, exact: true }).click();
};
const enter = async (page, id, option, value) => {
  await q(page, id);
  const card = page.locator(`[data-testid=nutrition-question][data-question=${id}]`);
  await card.getByRole("button", { name: option, exact: true }).click();
  await card.getByRole("spinbutton").fill(String(value));
  await card.getByRole("button", { name: "OK", exact: true }).click();
};
const share = async (page, made, eaten) => {
  await q(page, "share");
  const card = page.locator("[data-testid=nutrition-question][data-question=share]");
  await card.getByRole("spinbutton").nth(0).fill(String(made));
  await card.getByRole("spinbutton").nth(1).fill(String(eaten));
  await card.getByRole("button", { name: "OK", exact: true }).click();
};
const dontKnow = async (page, id) => {
  await q(page, id);
  await page.locator(`[data-testid=nutrition-question][data-question=${id}]`).getByRole("button", { name: "I don't know" }).click();
};
const jpeg = (page, w, h) =>
  page.evaluate(
    ([w, h]) => {
      const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = c.getContext("2d");
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsl(${(i * 31) % 360},55%,${25 + (i % 50)}%)`;
        ctx.fillRect((i * 41) % w, (i * 67) % h, 18, 18);
      }
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    },
    [w, h],
  );

// ---------- 1. Live scan: steady banana freezes once, inference pauses, Retake, manual shutter, log once ----------
{
  const { context, page } = await setup();
  await page.goto(URL_);
  await page.getByTestId("nutrition-scan").click();
  await screenIs(page, "SCANNING");
  // A face in view keeps ASHA waiting and never freezes.
  await page.evaluate(() => window.__script({ faceCount: 1 }));
  await page.getByText("A face is in view").waitFor();
  await sleep(2500);
  assert.notEqual(await screen(page), "SNAPSHOT_FROZEN", "never freezes while a face is in view");
  assert.equal(await page.getByTestId("nutrition-tentative").count(), 0, "no tentative label from frames that aren't usable");
  // Food only: the same banana in 4 of the last 6 samples freezes the picture.
  await page.evaluate(() => window.__script({ faceCount: 0 }));
  await screenIs(page, "SNAPSHOT_FROZEN");
  assert.deepEqual(await page.evaluate(() => window.__cropSize), [224, 224], "the classifier gets a 224 px centre square");
  await page.getByTestId("nutrition-still-findings").getByText("Banana").waitFor();
  await page.getByText("experimental, check it").waitFor();
  const atFreeze = await classified(page);
  await sleep(2000);
  assert.ok((await classified(page)) - atFreeze <= 1, "live inference stops after the freeze (only the still is analysed)");
  assert.equal(await screen(page), "SNAPSHOT_FROZEN", "frozen exactly once, no second capture");

  // Retake resumes scanning and can freeze again.
  await page.getByTestId("nutrition-retake").click();
  await screenIs(page, "SCANNING");
  await page.waitForFunction((n) => window.__classified > n + 1, atFreeze); // scanning resumed
  await screenIs(page, "SNAPSHOT_FROZEN");

  // Continue scanning: no automatic freeze this time; the shutter takes the photo.
  await page.getByTestId("nutrition-continue").click();
  await screenIs(page, "SCANNING");
  await page.getByText("Automatic freeze is off for this try").waitFor();
  await sleep(3000);
  assert.equal(await screen(page), "SCANNING", "manual shutter mode never freezes by itself");
  await page.getByTestId("nutrition-shutter").click();
  await screenIs(page, "SNAPSHOT_FROZEN");

  await page.getByTestId("nutrition-confirm").click();
  await screenIs(page, "FOOD_REVIEW");
  assert.ok(await camerasReleased(page), "the camera is released once the photo is confirmed");
  const chip = page.locator("[data-testid=nutrition-chips] li[data-dish=banana]");
  assert.equal(await chip.getAttribute("data-origin"), "camera");
  await chip.getByText("Camera suggestion (experimental").waitFor();
  await page.getByTestId("nutrition-foods-ok").click();
  await pick(page, "size", "Medium (7–8 in long) · 118 g");
  // Edit previous answer: Back returns to the size question with the earlier answer shown.
  await q(page, "count");
  await page.getByRole("button", { name: "Back: edit previous answer" }).click();
  await q(page, "size");
  assert.equal(await page.getByRole("button", { name: "Medium (7–8 in long) · 118 g" }).getAttribute("aria-pressed"), "true");
  await pick(page, "size", "Large (8–9 in long) · 136 g");
  await pick(page, "count", "1");
  await screenIs(page, "INGREDIENT_REVIEW");
  await page.getByTestId("nutrition-calculate").click();
  await screenIs(page, "RESULT");
  // 136 g × 89 kcal/100 g = 121 kcal -> shown as "about 120 kcal".
  assert.equal((await page.getByTestId("nutrition-total-kcal").textContent()).trim(), "about 120 kcal");
  assert.equal(await page.getByTestId("nutrition-eaten").count(), 0, "no 'you ate' figure before it is confirmed");
  assert.ok(await page.getByTestId("nutrition-log").isDisabled(), "can't log before saying how much was eaten");
  await page.getByTestId("nutrition-ate-all").click();
  await page.getByTestId("nutrition-eaten").getByText("about 120 kcal").waitFor();
  // A double tap writes one log entry.
  await page.getByTestId("nutrition-log").dblclick();
  await screenIs(page, "LOGGED");
  const s = await store(page);
  assert.equal(s.log.length, 1, "logged once");
  const entry = s.log[0];
  assert.equal(entry.captureMethod, "live_scan");
  assert.equal(entry.photoStored, false);
  assert.equal(entry.items[0].canonical.databaseRecordId, "fdc:173944");
  assert.equal(entry.items[0].canonical.modelId, "asha/food-dinov2s-oi-bd66-int8");
  assert.equal(entry.items[0].canonical.captureMethod, "live_scan");
  assert.equal(entry.items[0].canonical.dataVersion, "asha-nutrition-v5/2026-11-20");
  assert.ok(entry.items[0].sources.every((x) => x.databaseRecordId && x.verification), "every figure keeps its source id");
  assert.equal(JSON.stringify(s).includes("blob:"), false, "no photo reference is stored");
  // "Ask ASHA" opens the assistant with the question typed in but not sent.
  const href = await page.getByTestId("nutrition-logged").getByRole("link").getAttribute("href");
  assert.match(href, /assistant\?q=/);
  await page.getByRole("button", { name: "Log another meal" }).click();
  await screenIs(page, "IDLE");
  await page.getByTestId("nutrition-log-entry").getByText("Banana").waitFor();
  await page.goto(base + href);
  await page.waitForFunction(() => document.querySelector("form input, form textarea")?.value?.startsWith("About my meal"));
  await context.close();
}

// ---------- 1b. The orange bug: best guess "orange" is named, never turned into apple, and not filled in ----------
{
  const { context, page } = await setup();
  await page.goto(URL_);
  await page.evaluate(() => window.__script({ categories: [{ label: "orange", score: 0.62 }, { label: "apple", score: 0.31 }, { label: "lemon_lime", score: 0.04 }] }));
  await page.getByTestId("nutrition-upload").click();
  await page.getByTestId("nutrition-file").setInputFiles({ name: "orange.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await jpeg(page, 800, 600), "base64") });
  await screenIs(page, "IMAGE_VALIDATED");
  await page.getByTestId("nutrition-use-photo").click();
  await screenIs(page, "FOOD_REVIEW");
  await page.getByTestId("nutrition-recognised").getByText("Orange (or malta)").waitFor();
  await page.getByTestId("nutrition-recognised").getByText("tap + Orange or malta below").waitFor();
  assert.equal(await page.locator("[data-testid=nutrition-chips] li[data-dish]").count(), 0, "no apple (or any food) added for an orange");
  await page.locator("[data-testid=nutrition-add] button[data-dish=orange]").click();
  await page.locator("[data-testid=nutrition-chips] li[data-dish=orange]").waitFor();
  await context.close();
}

// ---------- 1c. A best guess with no nutrition record is named, and nothing is added ----------
{
  const { context, page } = await setup();
  await page.goto(URL_);
  await page.evaluate(() => window.__script({ categories: [{ label: "lemon_lime", score: 0.62 }, { label: "apple", score: 0.31 }, { label: "orange", score: 0.04 }] }));
  await page.getByTestId("nutrition-upload").click();
  await page.getByTestId("nutrition-file").setInputFiles({ name: "lemon.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await jpeg(page, 800, 600), "base64") });
  await screenIs(page, "IMAGE_VALIDATED");
  await page.getByTestId("nutrition-use-photo").click();
  await screenIs(page, "FOOD_REVIEW");
  await page.getByTestId("nutrition-recognised").getByText("Lemon or lime").waitFor();
  assert.equal(await page.locator("[data-testid=nutrition-chips] li[data-dish]").count(), 0, "no apple (or any food) added for a lemon");
  await context.close();
}

// ---------- 2. Upload: rotate, no suggestion, rice + dal + fish curry kept separate, oil changes, unknown sodium ----------
{
  const { context, page } = await setup();
  await page.goto(URL_);
  await page.evaluate(() => window.__script({ categories: [{ label: "not_food", score: 0.95 }] }));
  await page.getByTestId("nutrition-upload").click();
  await page.getByTestId("nutrition-file").setInputFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await jpeg(page, 800, 600), "base64") });
  await screenIs(page, "IMAGE_VALIDATED");
  await page.getByRole("button", { name: "Rotate right" }).click();
  await page.waitForFunction(() => {
    const img = document.querySelector("[data-testid=nutrition-preview] img");
    return img && img.naturalWidth === 600 && img.naturalHeight === 800;
  });
  await page.getByTestId("nutrition-use-photo").click();
  await screenIs(page, "FOOD_REVIEW");
  await page.getByText("didn't recognise a food it knows").waitFor();
  assert.equal(await page.locator("[data-testid=nutrition-chips] li[data-dish]").count(), 0, "no food is invented when the camera has no suggestion");
  for (const d of ["rice", "dal", "fish_curry"]) await page.locator(`[data-testid=nutrition-add] button[data-dish=${d}]`).click();
  await page.getByTestId("nutrition-foods-ok").click();
  await pick(page, "form", "Cooked rice on the plate");
  await enter(page, "cooked", "Cups (1 cup ≈ 158 g)", 1);
  await pick(page, "prep", "Plain boiled rice (bhat)");
  await pick(page, "dalType", "Masoor (red lentil)");
  await pick(page, "amount", "1 bowl");
  await enter(page, "oil", "Tablespoons (1 tbsp ≈ 13.6 g)", 2);
  await dontKnow(page, "salt");
  await share(page, 4, 1);
  await pick(page, "fishType", "Tilapia");
  await enter(page, "fishGrams", "Weight in grams", 100);
  await pick(page, "potato", "None");
  await enter(page, "oil", "Tablespoons (1 tbsp ≈ 13.6 g)", 1);
  await enter(page, "salt", "Teaspoons (1 tsp ≈ 6 g)", 1);
  await share(page, 4, 1);
  await screenIs(page, "INGREDIENT_REVIEW");
  assert.equal(await page.getByTestId("review-item").count(), 3);
  await page.getByTestId("nutrition-calculate").click();
  await screenIs(page, "RESULT");
  const items = page.getByTestId("nutrition-item");
  assert.equal(await items.count(), 3, "three foods shown separately");
  // rice 158 g × 1.30 = 205; dal 100 g lentils 116 + ¼ of 27.2 g oil (60.1) = 176; fish 128 + ¼ of 13.6 g oil (30.1) = 158.
  const kcal = async (dish) => (await page.locator(`[data-testid=nutrition-item][data-dish=${dish}] [data-testid=item-kcal]`).textContent()).trim();
  assert.equal(await kcal("rice"), "about 205 kcal");
  assert.equal(await kcal("dal"), "about 175 kcal");
  assert.equal(await kcal("fish_curry"), "about 160 kcal");
  assert.equal((await page.getByTestId("nutrition-total-kcal").textContent()).trim(), "about 540 kcal");
  assert.equal((await page.getByTestId("total-sodium").textContent()).trim(), "unknown", "dal salt unknown -> meal sodium unknown, not zero");
  await page.locator("[data-testid=nutrition-item][data-dish=dal]").getByText("Salt in the pot is not known").first().waitFor();
  await page.getByTestId("nutrition-assumptions").getByText("One bowl of dal is taken as 100 g").waitFor();
  // Improve estimate: more oil in the dal pot raises only the dal, by ¼ of 2 more tablespoons.
  await page.getByTestId("nutrition-improve").click();
  await screenIs(page, "EDIT_ANSWERS");
  await page.locator("[data-testid=review-item][data-dish=dal]").getByRole("button", { name: /Change: How much oil/ }).click();
  await enter(page, "oil", "Tablespoons (1 tbsp ≈ 13.6 g)", 4);
  await screenIs(page, "INGREDIENT_REVIEW");
  await page.getByTestId("nutrition-calculate").click();
  await screenIs(page, "RESULT");
  assert.equal(await kcal("dal"), "about 235 kcal");
  assert.equal(await kcal("rice"), "about 205 kcal", "other foods unchanged");
  await page.getByTestId("nutrition-ate-all").click();
  await page.locator("[data-testid=nutrition-item][data-dish=rice]").getByRole("button", { name: "Half", exact: true }).click();
  await page.getByTestId("nutrition-eaten").waitFor();
  await page.getByTestId("nutrition-log").click();
  await screenIs(page, "LOGGED");
  const entry = (await store(page)).log[0];
  assert.equal(entry.captureMethod, "upload");
  assert.equal(entry.items.length, 3);
  const dal = entry.items.find((i) => i.dishId === "dal");
  assert.equal(dal.canonical.manualCorrections.length, 1, "the oil change after the first result is kept as a correction");
  assert.equal(dal.nutrients.sodium, null);
  assert.equal(entry.items.find((i) => i.dishId === "rice").eaten, "half");
  assert.ok(entry.eaten.kcal.min < entry.total.kcal.min, "energy eaten is less than the meal when half the rice was left");
  await context.close();
}

// ---------- 3. Bad files: not an image, HEIC this browser can't open, too big, too small ----------
{
  const { context, page } = await setup();
  await page.goto(URL_);
  const tryFile = async (file, text) => {
    await page.getByTestId("nutrition-upload").click();
    await page.getByTestId("nutrition-file").setInputFiles(file);
    await screenIs(page, "ERROR");
    await page.getByTestId("nutrition-error").getByText(text).waitFor();
    await page.goto(URL_);
  };
  await tryFile({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not a photo at all") }, "isn't a photo ASHA can read");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(200, 7)]);
  await tryFile({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: heic }, "can't open HEIC photos");
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16 * 1024 * 1024)]);
  await tryFile({ name: "huge.jpg", mimeType: "image/jpeg", buffer: huge }, "larger than 15 MB");
  await tryFile({ name: "tiny.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await jpeg(page, 120, 90), "base64") }, "too small");
  // From an error, manual entry still works.
  await page.getByTestId("nutrition-upload").click();
  await page.getByTestId("nutrition-file").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("nope") });
  await screenIs(page, "ERROR");
  await page.getByTestId("nutrition-error-manual").click();
  await screenIs(page, "FOOD_REVIEW");
  // Packaged food uses the label the person types in; kJ is converted.
  await page.locator("[data-testid=nutrition-add] button[data-dish=packaged]").click();
  await page.getByTestId("nutrition-foods-ok").click();
  await q(page, "productName");
  await page.getByRole("textbox").fill("Biscuits");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await enter(page, "labelKcal", "Kilojoules (kJ)", 418);
  await pick(page, "servings", "2 servings");
  await q(page, "labelExtras");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByTestId("nutrition-calculate").click();
  // 418 kJ / 4.184 = 99.9 kcal per serving × 2 = about 200 kcal; sodium not on the label -> unknown.
  assert.equal((await page.getByTestId("nutrition-total-kcal").textContent()).trim(), "about 200 kcal");
  assert.equal((await page.getByTestId("total-sodium").textContent()).trim(), "unknown");
  await page.getByTestId("nutrition-discard").click();
  await screenIs(page, "DISCARDED");
  assert.equal((await store(page)).log?.length ?? 0, 0, "discard saves nothing");
  await context.close();
}

// ---------- 4. Bangla phone, camera refused: manual entry, search, uncertain amount, no overflow ----------
{
  const { context, page } = await setup({ viewport: { width: 390, height: 844 }, denyCamera: true, store: { language: "bn", autoFreeze: true, log: [], audit: [] } });
  await page.goto(URL_);
  await page.getByText("লাইভ স্ক্যান").waitFor();
  assert.ok((await overflow(page)) <= 0, "home fits 390 px");
  await page.getByTestId("nutrition-scan").click();
  await screenIs(page, "PERMISSION_DENIED");
  await page.getByText("ক্যামেরার অনুমতি বন্ধ").waitFor();
  assert.ok((await overflow(page)) <= 0, "error screen fits 390 px");
  await page.getByTestId("nutrition-error-manual").click();
  await screenIs(page, "FOOD_REVIEW");
  for (const d of ["other", "strawberries"]) await page.locator(`[data-testid=nutrition-add] button[data-dish=${d}]`).click();
  assert.ok((await overflow(page)) <= 0, "food review fits 390 px");
  await page.getByTestId("nutrition-foods-ok").click();
  await q(page, "whatFood");
  await page.getByTestId("food-search").fill("আলু");
  await page.getByRole("button", { name: /আলু · সেদ্ধ/ }).click();
  await enter(page, "grams", "ওজন গ্রামে", 150).catch(async () => {
    const card = page.locator("[data-testid=nutrition-question][data-question=grams]");
    await card.getByRole("button", { name: "ওজন গ্রামে" }).click();
    await card.getByRole("spinbutton").fill("150");
    await card.getByRole("button", { name: "ঠিক আছে" }).click();
  });
  // Strawberries: frozen, amount unknown -> "estimate uncertain", never a made-up number.
  await page.locator("[data-testid=nutrition-question][data-question=kind]").getByRole("button", { name: "হিমায়িত, চিনি ছাড়া" }).click();
  await q(page, "grams");
  await page.getByRole("button", { name: "জানি না" }).click();
  await q(page, "sugar");
  await page.getByRole("button", { name: "একদম না" }).click();
  await q(page, "storageTips");
  await page.getByRole("button", { name: "না, দরকার নেই" }).click();
  assert.ok((await overflow(page)) <= 0, "questions fit 390 px");
  await page.getByTestId("nutrition-calculate").click();
  await screenIs(page, "RESULT");
  assert.equal((await page.locator("[data-testid=nutrition-item][data-dish=other] [data-testid=item-kcal]").textContent()).trim(), "প্রায় ১৩০ কিলোক্যালরি");
  assert.equal(await page.locator("[data-testid=nutrition-item][data-dish=strawberries]").getAttribute("data-status"), "uncertain");
  assert.equal(await page.getByTestId("nutrition-total").getAttribute("data-status"), "uncertain");
  await page.getByTestId("nutrition-counted-kcal").waitFor();
  assert.ok((await overflow(page)) <= 0, "result fits 390 px");
  await context.close();
}

await browser.close();
const relevant = errors.filter((e) => !/ResizeObserver/.test(e));
assert.deepEqual(relevant, [], `page errors: ${relevant.join(" | ")}`);
console.log("nutrition browser: 4 runs passed");
