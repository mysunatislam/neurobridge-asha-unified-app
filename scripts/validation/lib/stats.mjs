// Wilson score interval for a proportion; bootstrap for anything else.
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
export function bootstrap(items, stat, B = 2000) {
  const vals = [];
  for (let b = 0; b < B; b++) { const s = Array.from(items, () => items[Math.floor(rnd() * items.length)]); const v = stat(s); if (Number.isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b); return [vals[Math.floor(0.025 * vals.length)], vals[Math.floor(0.975 * vals.length)]];
}
export function prf(tp, fp, fn) {
  const p = tp / (tp + fp), r = tp / (tp + fn); return { precision: p, recall: r, f1: (2 * p * r) / (p + r), tp, fp, fn };
}
export const pct = (x, d = 1) => (Number.isFinite(x) ? (100 * x).toFixed(d) + "%" : "n/a");
export const ci = ([a, b], d = 1) => `${pct(a, d)}–${pct(b, d)}`;
export function confusion(pairs, labels) {
  const m = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))]));
  for (const [t, p] of pairs) if (m[t] && p in m[t]) m[t][p]++;
  return m;
}
export const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
