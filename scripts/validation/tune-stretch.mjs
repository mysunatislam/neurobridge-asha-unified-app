import { load, stretchActive } from "./eval-genki.mjs"; import { wilson, pct, ci } from "./lib/stats.mjs";
const F = load().filter((s) => s.face), neg = F.filter((s) => s.smile === 0);
const A = neg.filter((s) => s.i % 2 === 0), B = neg.filter((s) => s.i % 2 === 1); // fit on even, test on odd
const fit = (S) => { const xs = S.map((s) => Math.sin((s.f.yaw * Math.PI) / 180)), ys = S.map((s) => s.lateral); const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length; return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); };
const K = fit(A); console.log("K (fit on even images)", K.toFixed(3));
const which = (S, rule) => { const lat = S.filter((s) => stretchActive(s, rule) && Math.abs(s.corner) / 0.04 <= Math.abs(s.lateral - (rule.yawComp||0) * Math.sin(s.f.yaw*Math.PI/180)) / 0.035).length; return lat; };
for (const [name, rule] of [["current", {}], ["yaw-compensated", { yawComp: K }], ["compensated, |yaw|<15 gate", { yawComp: K, yawGate: 15 }]]) {
  const k = B.filter((s) => stretchActive(s, rule)).length;
  console.log(`${name.padEnd(28)} held-out FP ${k}/${B.length} = ${pct(k / B.length)} [${ci(wilson(k, B.length))}]  (lateral-driven ${which(B, rule)})`);
  for (const [a, b] of [[0, 5], [5, 10], [10, 15], [15, 20]]) { const bin = B.filter((s) => Math.abs(s.f.yaw) >= a && Math.abs(s.f.yaw) < b), kk = bin.filter((s) => stretchActive(s, rule)).length; console.log(`     |yaw| ${a}-${b}°: ${pct(kk / bin.length)} (${kk}/${bin.length})`); }
}
// corner asymmetry vs roll/pitch
const big = B.filter((s) => Math.abs(s.corner) >= 0.04); console.log("corner >= 0.04 on held-out", pct(big.length / B.length));
// residual spread of the compensated lateral shift at rest
const res = B.filter((s)=>Math.abs(s.f.yaw)<20).map((s) => Math.abs(s.lateral - K * Math.sin((s.f.yaw * Math.PI) / 180))).sort((a, b) => a - b);
console.log("compensated |lateral| p50/p90/p95/p99", [0.5, 0.9, 0.95, 0.99].map((q) => res[Math.floor(q * res.length)].toFixed(4)).join(" "));
const raw = B.filter((s)=>Math.abs(s.f.yaw)<20).map((s) => Math.abs(s.lateral)).sort((a, b) => a - b);
console.log("raw |lateral| p50/p90/p95/p99", [0.5, 0.9, 0.95, 0.99].map((q) => raw[Math.floor(q * raw.length)].toFixed(4)).join(" "));
