import type { Credential } from "@/lib/api";
import type { Assessment } from "@/lib/engine/types";

export type Role = "patient" | "caregiver";
export type CareEntry = Credential & { label: string; patientToken?: string };

export type SupportContext = { categories: string[]; goals: string[]; note: string };
export type Voice = { name: string; rate: number; pitch?: number };

export type Profile = {
  patientId: string;
  label: string;
  assessment: Assessment;
  supportContext: SupportContext;
  voice: Voice;
  recommendation: { primary: string; suggested: string[]; reason?: string };
  createdAt?: string;
  expiresAt?: string;
};

export type PatientStatus = {
  module: string;
  camera: boolean;
  face: boolean;
  hands: number;
  posture: string;
  activity: string;
  bpm: number | null;
  calibrated: boolean;
  at: string;
};

export type Receipt = { receivedAt: string | null; acknowledgedAt: string | null };

export type CareEvent = {
  id: string;
  kind: string;
  text: string;
  source: string;
  confirmed: boolean;
  at: string;
  receipt: Receipt | null;
};

export type SessionData = {
  profile: Profile;
  role: Role;
  status: PatientStatus | null;
  events: CareEvent[];
  vapidPublicKey: string | null;
};

export type Settings = {
  voice: string;
  rate: number;
  language: "auto" | "en" | "bn" | "mixed";
  speechLanguage: string;
  cloud: boolean;
  /** Experimental: answer with a small model running in this browser (WebLLM). */
  deviceAI?: boolean;
  proactive: boolean;
};
