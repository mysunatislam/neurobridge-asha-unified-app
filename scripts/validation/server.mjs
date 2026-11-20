import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const here = new URL(".", import.meta.url).pathname;
const roots = { "/repo/": path.resolve(here, "../../public") + "/", "/data/": path.resolve(process.env.VALIDATION_DATA || path.join(here, "../../../validation-data")) + "/", "/h/": path.join(here, "web") + "/" };
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".task": "application/octet-stream", ".bmp":"image/bmp" };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const k = Object.keys(roots).find((r) => u.startsWith(r));
  if (!k) { res.writeHead(404); return res.end(); }
  const p = path.normalize(roots[k] + u.slice(k.length));
  if (!p.startsWith(roots[k])) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": types[path.extname(p).toLowerCase()] || "application/octet-stream", "cross-origin-opener-policy":"same-origin","cross-origin-embedder-policy":"require-corp" }); res.end(b); });
}).listen(8765, "127.0.0.1", () => console.log("up"));
