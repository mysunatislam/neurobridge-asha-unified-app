"use client";

import { readLocal, saveLocal } from "@/lib/storage";
import type { Place } from "./store";

// Weather and air quality from Open-Meteo (free, no key, CC BY 4.0). Only the place's
// coordinates are sent, never health data. Cached on this device for 30 minutes.
const CACHE = "risk_env_v1";
const TTL = 30 * 60e3;

export type Hour = { hour: number; feels: number | null; temp: number | null; humidity: number | null; aqi: number | null; uv: number | null };
export type Environment = {
  place: string;
  lat: number;
  lon: number;
  /** The place's offset from UTC, so "the coolest hour" is in the place's own time. */
  utcOffsetSeconds: number;
  fetchedAt: number;
  current: { temp: number | null; feels: number | null; humidity: number | null; uv: number | null; aqi: number | null; pm25: number | null };
  hourly: Hour[];
};

export const PLACES: Place[] = [
  { name: "Dhaka", lat: 23.81, lon: 90.41 },
  { name: "Chattogram", lat: 22.36, lon: 91.78 },
  { name: "Abu Dhabi", lat: 24.45, lon: 54.38 },
  { name: "Dubai", lat: 25.2, lon: 55.27 },
  { name: "Delhi", lat: 28.61, lon: 77.21 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "New York", lat: 40.71, lon: -74.01 },
];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
  return res.json();
}

export async function loadEnvironment(place: Place, force = false): Promise<Environment> {
  const cached = readLocal<Environment | null>(CACHE, null);
  if (!force && cached && cached.place === place.name && cached.lat === place.lat && cached.lon === place.lon && Date.now() - cached.fetchedAt < TTL) return cached;
  const at = `latitude=${place.lat.toFixed(2)}&longitude=${place.lon.toFixed(2)}&timezone=auto&forecast_days=1`;
  const [w, a] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?${at}&current=temperature_2m,relative_humidity_2m,apparent_temperature,uv_index&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,uv_index`),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${at}&current=us_aqi,pm2_5&hourly=us_aqi`).catch(() => null),
  ]);
  const times: string[] = w?.hourly?.time ?? [];
  const aqiByTime = new Map<string, number | null>((a?.hourly?.time ?? []).map((t: string, i: number) => [t, num(a.hourly.us_aqi?.[i])]));
  const env: Environment = {
    place: place.name,
    lat: place.lat,
    lon: place.lon,
    utcOffsetSeconds: num(w?.utc_offset_seconds) ?? -new Date().getTimezoneOffset() * 60,
    fetchedAt: Date.now(),
    current: {
      temp: num(w?.current?.temperature_2m),
      feels: num(w?.current?.apparent_temperature),
      humidity: num(w?.current?.relative_humidity_2m),
      uv: num(w?.current?.uv_index),
      aqi: num(a?.current?.us_aqi),
      pm25: num(a?.current?.pm2_5),
    },
    hourly: times.map((t, i) => ({
      hour: Number(t.slice(11, 13)),
      temp: num(w.hourly.temperature_2m?.[i]),
      feels: num(w.hourly.apparent_temperature?.[i]),
      humidity: num(w.hourly.relative_humidity_2m?.[i]),
      uv: num(w.hourly.uv_index?.[i]),
      aqi: aqiByTime.get(t) ?? null,
    })),
  };
  saveLocal(CACHE, env);
  return env;
}

/** The device's location, rounded to about 1 km, only after the person presses the button. */
export function locate(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is not available in this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ name: "Your location", lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      () => reject(new Error("Location was not shared. Pick a city instead.")),
      { timeout: 10000, maximumAge: 30 * 60e3 },
    );
  });
}
