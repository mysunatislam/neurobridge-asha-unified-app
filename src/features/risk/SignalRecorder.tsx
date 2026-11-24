"use client";

import { useEffect, useRef } from "react";
import { usePerception } from "@/features/perception/PerceptionProvider";
import { riskStore } from "./store";

const EVERY_MS = 60_000;

/**
 * Keeps short summaries for Health outlook while the camera runs on any patient page:
 * at most one pulse/breathing reading a minute (only with fair or good signal), and each
 * FaceSpeak abnormal stretch once it is logged after its 60-second hold.
 */
export function SignalRecorder() {
  const { pulse, snapshot, state } = usePerception();
  const lastVital = useRef(0);
  const latched = useRef(false);

  useEffect(() => {
    if (state !== "on" || !pulse || !(pulse.status === "good" || pulse.status === "fair")) return;
    if (pulse.bpm == null && pulse.breathingBpm == null) return;
    const now = Date.now();
    if (now - lastVital.current < EVERY_MS) return;
    lastVital.current = now;
    riskStore.addVital({
      at: now,
      bpm: pulse.bpm,
      breathing: pulse.breathingBpm,
      quality: Math.round(pulse.quality * 100) / 100,
      reference: pulse.baseline?.bpm ?? null,
    });
  }, [pulse, state]);

  const lip = snapshot.analysis?.lip;
  useEffect(() => {
    const now = !!lip?.latched;
    if (now && !latched.current) riskStore.addStretch({ at: Date.now(), side: lip?.side });
    latched.current = now;
  }, [lip?.latched, lip?.side]);

  return null;
}
