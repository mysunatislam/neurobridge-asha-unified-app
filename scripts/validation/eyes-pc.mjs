// Eye validation in one run, for a computer that holds the eye datasets (they stay on it).
//   node scripts/validation/eyes-pc.mjs <dataDir> <workDir> [gaze|blink|all]
// dataDir holds the unzipped sets, found by searching it:
//   MPIIFaceGaze: folders pXX with pXX.txt (or pXX_first250.txt) and Calibration/screenSize.mat
//   Eyeblink8 / TalkingFace: .avi videos with a .tag annotation file in the same folder
// Needs ffmpeg (on PATH, or the npm package ffmpeg-static) and Playwright with Chromium
// (PLAYWRIGHT_MODULE may point at it). Writes landmarks and summary-eyes.json into workDir.
// Only numbers are printed: no image, frame or face leaves the computer.
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process"; import { createRequire } from "node:module"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [dataArg, workArg, which = "all"] = process.argv.slice(2);
if (!dataArg || !workArg) { console.error("usage: node eyes-pc.mjs <dataDir> <workDir> [gaze|blink|all]"); process.exit(1); }
const DATA = path.resolve(dataArg), WORK = path.resolve(workArg); fs.mkdirSync(WORK, { recursive: true });
const summary = fs.existsSync(path.join(WORK, "summary-eyes.json")) ? JSON.parse(fs.readFileSync(path.join(WORK, "summary-eyes.json"), "utf8")) : {};
const save = () => fs.writeFileSync(path.join(WORK, "summary-eyes.json"), JSON.stringify(summary, null, 1));
const url = (abs) => "http://127.0.0.1:8765/data/" + path.relative(DATA, abs).split(path.sep).map(encodeURIComponent).join("/");
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "_frames") walk(p, out); } else out.push(p); } return out; }
const files = walk(DATA);

const server = spawn(process.execPath, [path.join(here, "server.mjs")], { env: { ...process.env, VALIDATION_DATA: DATA }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => server.stdout.once("data", ok));
process.on("exit", () => server.kill());
const count = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0);
const pass = (mode, list, out) => new Promise((ok) => {
  const c = spawn(process.execPath, [path.join(here, "run.mjs"), "face", mode, list, out], { stdio: "inherit", env: { ...process.env, MAX_LINES: process.env.MAX_LINES || "1200" } });
  c.on("exit", (code) => ok(code));
});
// Detection runs in short passes (a fresh browser and Node process each), resuming each time, so
// memory never builds up over a long video. Stops if two passes in a row add nothing.
async function detect(mode, list, out) {
  const total = count(list); let stuck = 0;
  while (count(out) < total) { const before = count(out); const code = await pass(mode, list, out);
    if (count(out) > before) stuck = 0; else if (++stuck >= 2) throw new Error(`run.mjs made no progress (exit ${code})`); }
}

// ---------- minimal MATLAB v5 reader, for screenSize.mat (named numeric scalars) ----------
function readMat(buf) {
  if (buf.toString("latin1", 0, 10).includes("7.3")) throw new Error("MAT 7.3 not supported");
  const vars = {};
  const elements = (b, off, end, cb) => { while (off + 8 <= end) {
    let type = b.readUInt32LE(off), n = b.readUInt32LE(off + 4), data = off + 8, next;
    if (type >>> 16) { n = type >>> 16; type &= 0xffff; data = off + 4; next = off + 8; } else next = data + n + (type === 15 ? 0 : (8 - (n % 8)) % 8);
    cb(type, b, data, n); off = next; } };
  const num = (type, b, o, n) => { const f = { 9: [8, "readDoubleLE"], 7: [4, "readFloatLE"], 5: [4, "readInt32LE"], 6: [4, "readUInt32LE"], 3: [2, "readInt16LE"], 4: [2, "readUInt16LE"], 1: [1, "readInt8"], 2: [1, "readUInt8"] }[type]; return f ? b[f[1]](o) : NaN; };
  const matrix = (b, o, n) => { let i = 0, name = "", val; elements(b, o, o + n, (t, bb, d, len) => { if (i === 2) name = bb.toString("latin1", d, d + len); if (i === 3) val = num(t, bb, d, len); i++; }); if (name) vars[name] = val; };
  const top = (t, b, d, n) => { if (t === 15) { const u = zlib.inflateSync(b.subarray(d, d + n)); elements(u, 0, u.length, top); } else if (t === 14) matrix(b, d, n); };
  elements(buf, 128, buf.length, top);
  return vars;
}
const COMMON = [[1280, 800], [1440, 900], [1366, 768], [1600, 900], [1680, 1050], [1920, 1080], [1920, 1200], [2560, 1440]];

// ---------- gaze: MPIIFaceGaze ----------
async function gazeRun() {
  const people = [...new Set(files.filter((f) => /[\\/]p\d\d[\\/]p\d\d(_first250)?\.txt$/.test(f)).map((f) => path.dirname(f)))].sort();
  if (!people.length) { console.error("No MPIIFaceGaze pXX folders found"); return; }
  const meta = {}, lines = [], screens = {};
  for (const dir of people) {
    const pid = path.basename(dir);
    const ann = fs.existsSync(path.join(dir, `${pid}_first250.txt`)) ? `${pid}_first250.txt` : `${pid}.txt`;
    const rows = fs.readFileSync(path.join(dir, ann), "utf8").trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 3 && fs.existsSync(path.join(dir, r[0])));
    let W, H, how = "screenSize.mat";
    try { const m = readMat(fs.readFileSync(path.join(dir, "Calibration", "screenSize.mat"))); W = m.width_pixel; H = m.height_pixel; if (!(W > 0 && H > 0)) throw new Error("no size"); }
    catch (e) { const mx = Math.max(...rows.map((r) => +r[1])), my = Math.max(...rows.map((r) => +r[2])); [W, H] = COMMON.find(([w, h]) => w >= mx && h >= my) || [mx, my]; how = `guessed from gaze range (${e.message})`; }
    screens[pid] = { W, H, how, images: rows.length };
    meta[pid] = rows.map((r) => { const id = `${pid}/${r[0]}`; lines.push(`${url(path.join(dir, r[0]))}\t0\t-\t${id}`); return { id, x: +r[1] / W, y: +r[2] / H }; });
  }
  fs.writeFileSync(path.join(WORK, "gaze-meta.json"), JSON.stringify(meta));
  fs.writeFileSync(path.join(WORK, "gaze.list"), lines.join("\n") + "\n");
  console.error(`gaze: ${people.length} people, ${lines.length} images`); console.error(JSON.stringify(screens));
  await detect("image", path.join(WORK, "gaze.list"), path.join(WORK, "gaze.jsonl"));
  const { people: load, simulate } = await import(pathToFileURL(path.join(here, "eval-gaze.mjs")).href);
  const { quantile, wilson } = await import(pathToFileURL(path.join(here, "lib", "stats.mjs")).href);
  const P = load(WORK);
  const run = (pids, opts) => { const errs = [], boards = {}, tiles = {}; let failed = 0;
    for (const pid of pids) { const r = simulate(P[pid], opts); if (r.failed) { boards[pid] = 0; failed++; continue; } boards[pid] = r.board; errs.push(...r.errs);
      for (const [k, v] of Object.entries(r.tiles)) { const T = (tiles[k] ??= { right: 0, wrong: 0 }); T.right += v.right; T.wrong += v.wrong; } }
    const n9 = Object.values(boards).filter((b) => b === 9).length, any = Object.values(boards).filter((b) => b > 0).length;
    return { people: pids.length, failed, boards, board9: n9, boardAny: any, n: errs.length, mean: errs.reduce((a, b) => a + b, 0) / (errs.length || 1), median: quantile(errs, 0.5), p90: quantile(errs, 0.9),
      tiles: Object.fromEntries(Object.entries(tiles).map(([k, T]) => [k, { rate: T.right / (T.right + T.wrong), ci: wilson(T.right, T.right + T.wrong), n: T.right + T.wrong }])) }; };
  const pids = Object.keys(P).sort();
  const usable = Object.fromEntries(pids.map((p) => [p, { ok: P[p].filter((s) => s.ok).length, all: P[p].length, reasons: P[p].filter((s) => !s.ok).reduce((m, s) => ((m[s.reason] = (m[s.reason] || 0) + 1), m), {}) }]));
  const grid = []; for (const ridge of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5]) for (const points of [5, 9, 16]) for (const perPoint of [8, 12]) grid.push({ ridge, points, perPoint });
  const A = pids.filter((_, i) => i % 2 === 0), B = pids.filter((_, i) => i % 2 === 1);
  const score = (r) => r.boardAny * 10 + r.board9 * 5 - r.mean * 100; // more people given a board, then a better board, then lower error
  const pick = (set) => grid.map((o) => ({ o, r: run(set, o) })).sort((a, b) => score(b.r) - score(a.r))[0].o;
  const oA = pick(A), oB = pick(B);
  summary.gaze = { screens, usable, current: run(pids, { ridge: 0.05, points: 9, perPoint: 8 }),
    sweep: grid.map((o) => ({ ...o, ...(({ boards, tiles, ...r }) => r)(run(pids, o)) })),
    crossValidated: { pickedOnEven: oA, heldOutOdd: run(B, oA), pickedOnOdd: oB, heldOutEven: run(A, oB), currentOdd: run(B, { ridge: 0.05, points: 9, perPoint: 8 }), currentEven: run(A, { ridge: 0.05, points: 9, perPoint: 8 }) } };
  save(); console.log(JSON.stringify({ gaze: { usable, current: summary.gaze.current, crossValidated: summary.gaze.crossValidated } }, null, 1));
}

// ---------- blinks: Eyeblink8 / TalkingFace ----------
function ffmpegBin() { if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg"; return createRequire(import.meta.url)(process.env.FFMPEG_STATIC_MODULE || "ffmpeg-static"); }
export function parseTag(text) {
  const body = text.split(/#start/)[1]?.split(/#end/)[0] ?? text;
  const frames = []; for (const l of body.split(/\r?\n/)) { const f = l.split(":").map((s) => s.trim()); if (f.length >= 2 && /^\d+$/.test(f[0])) frames.push([+f[0], +f[1]]); }
  const blinks = new Map(); for (const [fr, id] of frames) if (id >= 0) { const b = blinks.get(id) || { start: fr, end: fr }; b.start = Math.min(b.start, fr); b.end = Math.max(b.end, fr); blinks.set(id, b); }
  return { frames: frames.length, first: frames[0]?.[0] ?? 0, blinks: [...blinks.values()].sort((a, b) => a.start - b.start) };
}
async function blinkRun() {
  const vids = files.filter((f) => /\.(avi|mp4|mov|wmv)$/i.test(f)).map((v) => { const dir = path.dirname(v), tags = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".tag"));
    const tag = tags.find((n) => path.parse(n).name === path.parse(v).name) || (tags.length === 1 ? tags[0] : null); return tag ? { video: v, tag: path.join(dir, tag) } : null; }).filter(Boolean);
  if (!vids.length) { console.error("No video with a .tag file found"); return; }
  const ff = ffmpegBin(); const recs = {};
  for (const [i, { video, tag }] of vids.entries()) {
    const name = `${String(i).padStart(2, "0")}-${path.basename(path.dirname(video))}-${path.parse(video).name}`.replace(/[^\w.-]/g, "_");
    const out = path.join(WORK, `blink-${name}.jsonl`);
    const probe = spawnSync(ff, ["-i", video], { encoding: "utf8" }).stderr; const fps = +(probe.match(/([\d.]+) fps/)?.[1] || 30);
    if (!fs.existsSync(out + ".done")) {
      const fdir = path.join(DATA, "_frames", name); fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir, { recursive: true });
      const r = spawnSync(ff, ["-loglevel", "error", "-i", video, "-start_number", "0", "-q:v", "3", path.join(fdir, "%06d.jpg")], { stdio: "inherit" });
      if (r.status !== 0) throw new Error("ffmpeg failed on " + video);
      const frames = fs.readdirSync(fdir).filter((n) => n.endsWith(".jpg")).sort();
      fs.writeFileSync(out + ".list", frames.map((n, k) => `${url(path.join(fdir, n))}\t${Math.round((k * 1000) / fps)}\t${k === 0 ? "reset" : "-"}\t${k}`).join("\n") + "\n");
      console.error(`${name}: ${frames.length} frames at ${fps} fps`);
      await detect("video", out + ".list", out);
      fs.writeFileSync(out + ".done", ""); fs.rmSync(fdir, { recursive: true, force: true });
    }
    recs[name] = { fps, tag, out };
  }
  fs.rmSync(path.join(DATA, "_frames"), { recursive: true, force: true });
  const { runVideo, match } = await import(pathToFileURL(path.join(here, "lib", "blink.mjs")).href);
  const { wilson } = await import(pathToFileURL(path.join(here, "lib", "stats.mjs")).href);
  const src = fs.readFileSync(path.join(here, "..", "..", "public", "engine", "blink-counter.js"), "utf8");
  // Variants of the counter's limits, made by editing a copy of its source (the app file is unchanged).
  const variant = async ({ frac, abs, recover, lows }) => {
    let s = src.replaceAll("r.left * 0.08", `r.left * ${frac}`).replaceAll("r.right * 0.08", `r.right * ${frac}`).replaceAll("Math.max(0.018,", `Math.max(${abs},`)
      .replaceAll("* 0.2 &&", `* ${recover} &&`).replace("c.minRight) * 0.2;", `c.minRight) * ${recover};`).replace("c.lows >= 2 && duration >= 65", `c.lows >= ${lows} && duration >= 65`);
    const f = path.join(WORK, `bc-${frac}-${abs}-${recover}-${lows}.mjs`); fs.writeFileSync(f, s); return (await import(pathToFileURL(f).href)).BlinkCounter;
  };
  const data = Object.fromEntries(Object.entries(recs).map(([n, r]) => { const lines = fs.readFileSync(r.out, "utf8").trim().split("\n").map((l) => JSON.parse(l)); lines.sort((a, b) => +a.id - +b.id);
    const t = parseTag(fs.readFileSync(r.tag, "utf8")); const shift = t.first === 1 ? 1 : 0; // tags that count frames from 1
    return [n, { fps: r.fps, recs: lines, gt: t.blinks.map((b) => ({ start: b.start - shift, end: b.end - shift })) }]; }));
  const evalSet = (names, Counter) => { let tp = 0, fp = 0, fn = 0, mins = 0, clicks = 0, triples = 0, valid = 0, frames = 0; const per = {};
    for (const n of names) { const d = data[n], r = runVideo(d.recs, d.fps, { Counter }), m = match(r.blinks, d.gt); tp += m.tp; fp += m.fp; fn += m.fn;
      const min = r.valid / d.fps / 60; mins += min; valid += r.valid; frames += r.frames; const c = r.long.filter((e) => e.kind === "click").length; clicks += c; triples += r.triples;
      per[n] = { blinks: d.gt.length, ...m, minutes: +min.toFixed(2), faceFrames: r.valid / r.frames, longBlinkClicks: c, triples: r.triples }; }
    const P = tp / (tp + fp || 1), R = tp / (tp + fn || 1);
    return { tp, fp, fn, precision: P, recall: R, f1: (2 * P * R) / (P + R || 1), pCI: wilson(tp, tp + fp), rCI: wilson(tp, tp + fn), minutes: mins, falseClicksPerMin: clicks / (mins || 1), clicks, triplesPerMin: triples / (mins || 1), triples, faceFrames: valid / (frames || 1), per }; };
  const names = Object.keys(data).sort();
  const grid = []; for (const frac of [0.05, 0.08, 0.12, 0.16, 0.2]) for (const abs of [0.01, 0.018, 0.03]) for (const recover of [0.2, 0.35, 0.5]) for (const lows of [1, 2]) grid.push({ frac, abs, recover, lows });
  const counters = []; for (const o of grid) counters.push({ o, C: await variant(o) });
  const A = names.filter((_, i) => i % 2 === 0), B = names.filter((_, i) => i % 2 === 1);
  const best = (set) => counters.map(({ o, C }) => ({ o, C, r: evalSet(set, C) })).sort((a, b) => b.r.f1 - a.r.f1)[0];
  const bA = best(A), bB = best(B);
  // LongBlink (eye-cursor click): every recording here is natural blinking, so any click is a false click.
  summary.blink = { videos: names.map((n) => ({ name: n, fps: data[n].fps, frames: data[n].recs.length, blinks: data[n].gt.length })), current: evalSet(names, null),
    sweep: counters.map(({ o, C }) => ({ ...o, ...(({ per, ...r }) => r)(evalSet(names, C)) })),
    crossValidated: { pickedOnEven: bA.o, heldOutOdd: evalSet(B, bA.C), currentOdd: evalSet(B, null), pickedOnOdd: bB.o, heldOutEven: evalSet(A, bB.C), currentEven: evalSet(A, null) } };
  save(); for (const f of fs.readdirSync(WORK)) if (f.startsWith("bc-")) fs.rmSync(path.join(WORK, f));
  const brief = (r) => (({ per, sweep, ...x }) => x)(r);
  console.log(JSON.stringify({ blink: { videos: summary.blink.videos, current: summary.blink.current, crossValidated: Object.fromEntries(Object.entries(summary.blink.crossValidated).map(([k, v]) => [k, v.tp === undefined ? v : brief(v)])) } }, null, 1));
}

if (which === "gaze" || which === "all") await gazeRun();
if (which === "blink" || which === "all") await blinkRun();
server.kill(); process.exit(0);
