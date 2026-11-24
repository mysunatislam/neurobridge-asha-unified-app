// Energy eaten per day over the last few days, from the meal log on this device. Same rules as the
// engine: a range is {min, max}, max === null means "at least min", and a meal whose eaten energy
// is unknown is counted as unknown, never as zero.
import { approx } from "./engine.js";

const pad = (n) => String(n).padStart(2, "0");
/** The local calendar day of a date, as YYYY-MM-DD. */
export const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * One row per local calendar day, oldest first, ending today.
 * Each row: { day, meals, unknown, min, max } where min/max are kcal (max null = at least min),
 * meals counts meals with an eaten energy estimate and unknown counts logged meals without one.
 */
export function dailyEnergy(log, now = new Date(), days = 7) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    rows.push({ day: localDay(d), meals: 0, unknown: 0, min: 0, max: 0, open: false });
  }
  const byDay = new Map(rows.map((r) => [r.day, r]));
  for (const meal of log ?? []) {
    const row = byDay.get(localDay(new Date(meal.loggedAt)));
    if (!row) continue;
    const kcal = meal.eaten?.kcal;
    if (!kcal || !Number.isFinite(kcal.min)) {
      row.unknown += 1;
      continue;
    }
    row.meals += 1;
    row.min += kcal.min;
    if (kcal.max === null) row.open = true;
    else row.max += kcal.max;
  }
  return rows.map(({ open, ...r }) => ({
    ...r,
    min: r.meals ? approx(r.min, "kcal") : 0,
    max: r.meals ? (open ? null : approx(Math.max(r.max, r.min), "kcal")) : 0,
  }));
}
