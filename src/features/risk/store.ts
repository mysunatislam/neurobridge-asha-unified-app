"use client";

import { useSyncExternalStore } from "react";
import { readLocal, removeLocal, saveLocal } from "@/lib/storage";

// Short summaries of signals for Health outlook, kept on this device only, for 7 days.
// No video, audio or images: a pulse number, a logged face event, a request outcome.
const KEY = "risk_signals_v1";
const KEEP_MS = 7 * 24 * 3600e3;

export type VitalReading = { at: number; bpm: number | null; breathing: number | null; quality: number; reference: number | null };
export type StretchEvent = { at: number; side?: "left" | "right" };
export type RequestOutcome = { at: number; kind: string; outcome: "sent" | "local" | "failed" | "expired" | "cancelled"; source?: string };
export type Place = { name: string; lat: number; lon: number };
export type RiskState = {
  vitals: VitalReading[];
  stretch: StretchEvent[];
  requests: RequestOutcome[];
  place: Place | null;
  /** True while the explicit "Try with sample data" set is loaded. */
  sample: boolean;
  /** Plan steps ticked today, keyed by local date. */
  done: Record<string, string[]>;
};

const initial: RiskState = { vitals: [], stretch: [], requests: [], place: null, sample: false, done: {} };
let state: RiskState | null = null;
const listeners = new Set<() => void>();
const fresh = <T extends { at: number }>(xs: T[], cap: number) => xs.filter((x) => Date.now() - x.at <= KEEP_MS).slice(-cap);

export const riskStore = {
  get(): RiskState {
    return (state ??= { ...initial, ...readLocal<Partial<RiskState>>(KEY, {}) });
  },
  set(patch: Partial<RiskState> | ((s: RiskState) => Partial<RiskState>)) {
    const current = riskStore.get();
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    next.vitals = fresh(next.vitals, 600);
    next.stretch = fresh(next.stretch, 200);
    next.requests = fresh(next.requests, 300);
    state = next;
    saveLocal(KEY, next);
    listeners.forEach((l) => l());
  },
  addVital(v: VitalReading) {
    // Sample data is replaced by real readings as soon as they arrive.
    riskStore.set((s) => (s.sample ? { ...initial, place: s.place, vitals: [v] } : { vitals: [...s.vitals, v] }));
  },
  addStretch(e: StretchEvent) {
    riskStore.set((s) => (s.sample ? { ...initial, place: s.place, stretch: [e] } : { stretch: [...s.stretch, e] }));
  },
  addRequest(r: RequestOutcome) {
    riskStore.set((s) => (s.sample ? { ...initial, place: s.place, requests: [r] } : { requests: [...s.requests, r] }));
  },
  clear() {
    const place = riskStore.get().place;
    state = { ...initial, place };
    removeLocal(KEY);
    saveLocal(KEY, state);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useRisk(): RiskState {
  return useSyncExternalStore(riskStore.subscribe, riskStore.get, () => initial);
}

/** A labelled sample set so the alerts can be seen before a week of real use. */
export function sampleSignals(now = Date.now()): Pick<RiskState, "vitals" | "stretch" | "requests"> {
  const h = 3600e3;
  return {
    vitals: [
      { at: now - 30 * h, bpm: 74, breathing: 15, quality: 0.8, reference: 74 },
      { at: now - 3 * h, bpm: 88, breathing: 19, quality: 0.7, reference: 74 },
      { at: now - 2 * h, bpm: 92, breathing: 22, quality: 0.72, reference: 74 },
      { at: now - 40 * 60e3, bpm: 94, breathing: 23, quality: 0.66, reference: 74 },
    ],
    stretch: [{ at: now - 5 * h, side: "left" }],
    requests: [
      { at: now - 9 * h, kind: "water", outcome: "sent" },
      { at: now - 6 * h, kind: "toilet", outcome: "expired" },
      { at: now - 2.5 * h, kind: "comfort", outcome: "failed" },
    ],
  };
}
