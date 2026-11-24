// node run.mjs <kind face|hand> <mode image|video> <listfile> <out.jsonl>   (resumes; restarts the page on a hang)
import { createRequire } from "node:module"; import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
process.on("unhandledRejection", (e) => console.error("unhandled", String(e)));
const [kind, mode, list, outFile] = process.argv.slice(2);
const lines = fs.readFileSync(list, "utf8").trim().split("\n");
// Drop a half-written last line left by a crash, then resume after the complete ones.
if (fs.existsSync(outFile)) { const t = fs.readFileSync(outFile, "utf8"); const cut = t.lastIndexOf("\n") + 1; if (cut < t.length) fs.truncateSync(outFile, Buffer.byteLength(t.slice(0, cut))); }
const done = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean).length : 0;
// One process handles at most MAX_LINES lines, then exits so memory starts fresh; callers loop until done.
const stopAt = Math.min(lines.length, done + (+process.env.MAX_LINES || Infinity));
const B = mode === "image" ? 20 : 60; const t0 = Date.now();
let b, p;
async function open() {
  if (b) await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
  b = await chromium.launch({ args: ["--no-sandbox", "--js-flags=--max-old-space-size=4096"] }); p = await b.newPage();
  p.on("console", (m) => { try { if (m.type() === "error") console.error("page:", m.text()); } catch {} }); p.on("crash", () => console.error("page crashed"));
  await p.goto("http://127.0.0.1:8765/h/index.html"); await p.waitForFunction(() => window.ready, null, { timeout: 120000 });
}
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
await open();
const out = fs.createWriteStream(outFile, { flags: "a" });
for (let i = done; i < stopAt; i += B) {
  const chunk = lines.slice(i, Math.min(i + B, stopAt)).map((l) => l.split("\t"));
  const urls = chunk.map((c) => c[0]);
  let res;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = mode === "image" ? await withTimeout(p.evaluate(([k, u]) => window.runImages(k, u), [kind, urls]), 120000)
        : await withTimeout(p.evaluate(([k, u, t, r]) => window.runVideo(k, u, t, r), [kind, urls, chunk.map((c) => +c[1]), chunk[0][2] === "reset" || attempt > 0]), 300000);
    } catch (e) { console.error("batch", i, String(e)); await open(); }
  }
  if (!res) res = urls.map(() => ({ error: "failed" }));
  res.forEach((r, j) => out.write(JSON.stringify({ id: chunk[j].length > 3 ? chunk[j][3] : chunk[j][0], ...r }) + "\n"));
  if ((i / B) % 10 === 0) console.error(`${i + res.length}/${lines.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
// A browser lost to sleep can hang close(); never let that hold the pass open.
await new Promise((r) => out.end(r)); await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]); process.exit(0);
