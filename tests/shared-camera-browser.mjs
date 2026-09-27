// Real camera models with an official face fixture. API is stubbed here;
// production-browser.mjs separately verifies real two-device transport.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const profile = {
  patientId: "camera-test",
  label: "Camera verification",
  assessment: {
    leftHand: "none",
    rightHand: "none",
    wrist: "none",
    fingers: "none",
    eyes: "reliable",
    lips: "reliable",
    head: "none",
    speech: "limited",
    canSee: true,
    canHear: true,
  },
  supportContext: { categories: ["locked-in"], goals: ["needs"], note: "" },
  recommendation: {
    primary: "facespeak",
    suggested: ["facespeak", "senseassist"],
  },
  voice: { name: "", rate: 0.9 },
};
try {
  await page.route("**/api/session**", (route) =>
    route.fulfill({
      json: { profile, role: "patient", events: [], status: null },
    }),
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "asha_live_patient",
      JSON.stringify({ patientId: "camera-test", token: "only-a-local-test" }),
    );
    window.cameraOpenCount = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        window.cameraOpenCount++;
        const image = new Image();
        image.src = "/artifacts/portrait-test.jpg";
        await image.decode();
        const canvas = Object.assign(document.createElement("canvas"), {
          width: 640,
          height: 480,
        });
        const ctx = canvas.getContext("2d");
        const draw = () => ctx.drawImage(image, 0, 0, 640, 480);
        draw();
        window.fixtureTimer = setInterval(draw, 40);
        window.fixtureStream = canvas.captureStream(25);
        return window.fixtureStream;
      },
    });
  });
  await page.goto("http://127.0.0.1:4180/");
  await page.locator("#patient:not([hidden])").waitFor();
  await page.locator("#startMonitoring").click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById("liveSummary").dataset.cycles || "{}")
        .pose >= 2,
    null,
    { timeout: 60000 },
  );
  await page.locator("#detailsButton").click();
  const checked = [];
  for (const module of [
    "facespeak",
    "fingerspeak",
    "vitalsense",
    "senseassist",
    "posture",
  ]) {
    const before = await page
      .locator("#liveSummary")
      .evaluate((el) => JSON.parse(el.dataset.cycles));
    await page.locator(`[data-module=${module}]`).click();
    await page.waitForFunction(
      (prior) => {
        const now = JSON.parse(
          document.getElementById("liveSummary").dataset.cycles || "{}",
        );
        return ["face", "hand", "pose", "pulse"].every(
          (key) => now[key] > prior[key],
        );
      },
      before,
      { timeout: 15000 },
    );
    assert.equal(await page.evaluate(() => window.cameraOpenCount), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    checked.push(module);
    if (module === "facespeak") {
      await page.screenshot({
        path: "artifacts/neuroface-light-mobile.png",
        fullPage: true,
      });
      await page.locator("#themeButton").click();
      await page.screenshot({
        path: "artifacts/neuroface-dark-mobile.png",
        fullPage: true,
      });
    }
  }
  await page.locator('#details [data-view="patient"]').click();
  const before = await page
    .locator("#liveSummary")
    .evaluate((el) => JSON.parse(el.dataset.cycles));
  await page.waitForFunction(
    (n) =>
      JSON.parse(document.getElementById("liveSummary").dataset.cycles).pose >
      n,
    before.pose,
  );
  await page.locator("#pauseMonitoring").click();
  assert.equal(
    await page.evaluate(() =>
      window.fixtureStream.getTracks().every((t) => t.readyState === "ended"),
    ),
    true,
  );
  assert.equal(errors.length, 0);
  const report = {
    oneCameraAcrossModules: true,
    activeModules: checked,
    continuesOnPatientPage: true,
    stopsOnPause: true,
    applicationErrors: errors,
  };
  console.log(JSON.stringify(report));
  await fs.writeFile(
    "artifacts/shared-camera-verification.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
