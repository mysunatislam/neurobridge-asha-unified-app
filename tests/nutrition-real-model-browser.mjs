// The real ASHA food recogniser, in the real worker, in headless Chromium: checks that the browser
// gives the same best guess as the Python evaluation (docs/NUTRITION_PUBLIC_DATA_VALIDATION.md) on
// held-out Open Images photos. Photos are not shipped with the repo: put them and expected.json in
// artifacts/food-parity/ (the evaluation script writes them). Skips when they are missing.
// ORT_DIST=<onnxruntime-web 1.22.0 dist folder> serves the WASM runtime locally when the CDN is blocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const dir = path.resolve("artifacts/food-parity");
if (!fs.existsSync(path.join(dir, "expected.json"))) {
  console.log("skip: artifacts/food-parity/expected.json not found");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.NEXT_TEST_URL || "http://127.0.0.1:4180";
const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
const page = await browser.newPage();
if (process.env.ORT_DIST) await page.route("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/**", (r) => r.fulfill({ path: path.join(process.env.ORT_DIST, path.basename(new URL(r.request().url()).pathname)) }));
await page.route("**/__parity/**", (r) => r.fulfill({ path: path.join(dir, decodeURIComponent(path.basename(new URL(r.request().url()).pathname))) }));
await page.goto(`${base}/engine/icon.svg`);
const results = await page.evaluate(async (files) => {
  const w = new Worker("/engine/food-classifier-worker.js");
  const wait = (type) => new Promise((res) => { const h = ({ data }) => { if (data.type === type || data.type === "error") { w.removeEventListener("message", h); res(data); } }; w.addEventListener("message", h); });
  const ready = wait("ready");
  w.postMessage({ type: "init" });
  const r0 = await ready;
  if (r0.type === "error") return { error: r0.message };
  const out = [];
  let id = 0;
  for (const f of files) {
    const img = await createImageBitmap(await (await fetch(`/__parity/${encodeURIComponent(f)}`)).blob());
    // The same centre square the app's hook crops (80% of the short side), resized to 224.
    const side = Math.round(Math.min(img.width, img.height) * 0.8);
    const crop = await createImageBitmap(img, Math.round((img.width - side) / 2), Math.round((img.height - side) / 2), side, side, { resizeWidth: 224, resizeHeight: 224, resizeQuality: "medium" });
    const p = wait("result");
    w.postMessage({ type: "classify", id: ++id, crop, frame: null }, [crop]);
    const r = await p;
    out.push({ file: f, top: r.categories?.[0], ms: r.ms, error: r.error });
  }
  return { loadMs: r0.loadMs, out };
}, expected.map((e) => e.file));
await browser.close();
assert.ok(!results.error, results.error);
let same = 0, right = 0, ms = [];
for (const r of results.out) {
  const e = expected.find((x) => x.file === r.file);
  assert.ok(!r.error, r.error);
  same += r.top.label === e.python_top1;
  right += r.top.label === e.truth;
  ms.push(r.ms);
}
ms.sort((a, b) => a - b);
const n = results.out.length;
const summary = { photos: n, sameBestGuessAsPython: same, correctInBrowser: right, loadMs: results.loadMs, p50ms: ms[Math.floor(n / 2)], p95ms: ms[Math.floor(n * 0.95)] };
console.log(JSON.stringify(summary));
fs.writeFileSync(path.join(dir, "browser-result.json"), JSON.stringify({ summary, results: results.out }, null, 1));
// Resizing in the browser differs slightly from Python's, so a few near-ties may flip.
assert.ok(same / n >= 0.9, `browser and Python agree on ${same}/${n}`);
console.log("ok: real food model runs in the browser worker and matches the evaluation");
