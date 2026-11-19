import assert from "node:assert/strict";
import test from "node:test";
import { assessRisk, bestMoveHour } from "../src/features/risk/engine.js";

const H = 3600e3;
const now = Date.UTC(2026, 10, 18, 6, 0); // 12:00 in Dhaka (UTC+6)
const env = (current, hourly = []) => ({ place: "Dhaka", utcOffsetSeconds: 6 * 3600, fetchedAt: now, current: { temp: 30, feels: 30, humidity: 60, uv: 3, aqi: 40, pm25: 8, ...current }, hourly });
const vit = (bpm, breathing, minsAgo = 30, reference = null) => ({ at: now - minsAgo * 60e3, bpm, breathing, quality: 0.7, reference });
const ids = (r) => r.alerts.map((a) => a.id);
const level = (r, id) => r.alerts.find((a) => a.id === id)?.level;

test("nothing worrying gives no warning alerts", () => {
  const r = assessRisk({ now, env: env({ feels: 24 }), vitals: [vit(72, 14)], move: { history: [{ endedAt: new Date(now - H).toISOString() }] }, meals: [], requests: [{ at: now - H, kind: "water", outcome: "sent" }] });
  assert.ok(r.alerts.every((a) => a.level === "info"), JSON.stringify(ids(r)));
});

test("heat alone is a watch; heat with a raised pulse is act, and says why", () => {
  const heat = assessRisk({ now, env: env({ feels: 35, temp: 32, humidity: 75 }) });
  assert.equal(level(heat, "heat"), "watch");
  const strain = assessRisk({ now, env: env({ feels: 35, temp: 32, humidity: 75 }), vitals: [vit(96, 16, 20, 74), vit(94, 16, 40, 74)] });
  const a = strain.alerts[0];
  assert.equal(a.id, "heat-strain");
  assert.equal(a.level, "act");
  assert.match(a.because.map((b) => b.text).join(" "), /feels like 35°C.*|above your resting reference of 74/);
  assert.ok(a.because.every((b) => b.source));
  assert.ok(!ids(strain).includes("pulse"));
});

test("camera readings alone never raise act", () => {
  const r = assessRisk({ now, env: env({ feels: 22 }), vitals: [vit(130, 30), vit(128, 29, 50)] });
  assert.ok(r.alerts.every((a) => a.level !== "act"));
  assert.equal(level(r, "pulse"), "watch");
  assert.equal(level(r, "breathing"), "watch");
});

test("poor-quality camera readings are ignored", () => {
  const r = assessRisk({ now, env: env({}), vitals: [{ ...vit(140, 30), quality: 0.2 }] });
  assert.ok(!ids(r).includes("pulse"));
});

test("poor air with fast breathing combines into one act alert", () => {
  const r = assessRisk({ now, env: env({ aqi: 160, pm25: 70 }), vitals: [vit(80, 24)] });
  assert.equal(r.alerts[0].id, "air-breathing");
  assert.equal(r.alerts[0].level, "act");
  assert.ok(!ids(r).includes("air"));
});

test("face stretch is shown with the stroke check, and missed requests escalate", () => {
  const r = assessRisk({
    now,
    env: env({}),
    stretch: [{ at: now - 2 * H, side: "left" }],
    requests: [1, 2, 3].map((i) => ({ at: now - i * H, kind: "toilet", outcome: i === 1 ? "failed" : "expired" })),
  });
  assert.equal(level(r, "face-stretch"), "watch");
  assert.match(r.alerts.find((a) => a.id === "face-stretch").actions[0], /emergency/);
  assert.equal(level(r, "missed-requests"), "act");
  assert.ok(r.plan.some((p) => p.id === "now-requests"));
});

test("hydration uses the last water request, in heat", () => {
  const r = assessRisk({ now, env: env({ feels: 33 }), requests: [{ at: now - 5 * H, kind: "water", outcome: "sent" }] });
  assert.ok(ids(r).includes("hydration"));
  const recent = assessRisk({ now, env: env({ feels: 33 }), requests: [{ at: now - 1 * H, kind: "water", outcome: "sent" }] });
  assert.ok(!ids(recent).includes("hydration"));
});

test("the move hour is the coolest acceptable hour left in the place's own day", () => {
  const hourly = [
    { hour: 9, feels: 25, aqi: 40 },
    { hour: 13, feels: 36, aqi: 40 },
    { hour: 18, feels: 29, aqi: 160 },
    { hour: 19, feels: 30, aqi: 60 },
  ];
  const e = env({}, hourly);
  assert.equal(bestMoveHour(e, now).hour, 19); // 9 AM has passed; 6 PM air is poor
  const r = assessRisk({ now, env: e, move: { history: [] } });
  assert.match(r.alerts.find((a) => a.id === "move-gap").actions[0], /7 PM/);
  assert.ok(r.plan.some((p) => p.id === "move" && p.time === "7 PM"));
});

test("a recent Move safety stop and low intake are explained", () => {
  const r = assessRisk({
    now,
    env: null,
    move: { history: [{ endedAt: new Date(now - 24 * H).toISOString(), safety: { action: "stop_rest", reasons: ["Dizziness or light-headedness."] } }] },
    meals: [1, 2].map((i) => ({ loggedAt: new Date(now - i * H).toISOString(), total: { kcal: { min: 300, max: 400 } }, eaten: null })),
  });
  assert.equal(level(r, "move-safety-stop"), "watch");
  assert.ok(ids(r).includes("low-intake"));
});

test("without weather, alerts still work from signals only and the plan is never empty", () => {
  const r = assessRisk({ now, env: null });
  assert.ok(r.plan.length >= 1);
  assert.ok(Array.isArray(r.alerts));
});
