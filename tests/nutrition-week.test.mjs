import test from "node:test";
import assert from "node:assert/strict";
import { dailyEnergy, localDay } from "../src/features/nutrition/week.js";

const now = new Date(2026, 10, 19, 20, 0); // 19 Nov 2026, 8 PM local
const at = (day, hour) => new Date(2026, 10, day, hour, 0).toISOString();
const meal = (id, loggedAt, kcal) => ({ id, loggedAt, eaten: kcal === undefined ? null : { kcal } });

test("seven local days, oldest first, ending today", () => {
  const rows = dailyEnergy([], now);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].day, "2026-11-13");
  assert.equal(rows[6].day, localDay(now));
  assert.ok(rows.every((r) => r.meals === 0 && r.unknown === 0 && r.min === 0 && r.max === 0));
});

test("sums a day's ranges and keeps an open top open", () => {
  const rows = dailyEnergy(
    [
      meal("a", at(18, 8), { min: 300, max: 420 }),
      meal("b", at(18, 13), { min: 510, max: 640 }),
      meal("c", at(19, 9), { min: 250, max: null }),
      meal("d", at(19, 13), { min: 200, max: 260 }),
    ],
    now,
  );
  const day18 = rows.find((r) => r.day === "2026-11-18");
  const day19 = rows.find((r) => r.day === "2026-11-19");
  assert.deepEqual([day18.meals, day18.min, day18.max], [2, 810, 1060]);
  assert.deepEqual([day19.meals, day19.min, day19.max], [2, 450, null]);
});

test("a meal without an energy estimate is counted as unknown, not zero", () => {
  const rows = dailyEnergy([meal("a", at(17, 8)), meal("b", at(17, 12), null), meal("c", at(17, 19), { min: 400, max: 400 })], now);
  const day = rows.find((r) => r.day === "2026-11-17");
  assert.deepEqual([day.meals, day.unknown, day.min, day.max], [1, 2, 400, 400]);
});

test("meals older than the window are left out", () => {
  const rows = dailyEnergy([meal("old", at(12, 12), { min: 900, max: 900 })], now);
  assert.ok(rows.every((r) => r.meals === 0));
});
