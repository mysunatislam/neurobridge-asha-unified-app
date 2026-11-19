"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCalibrationData } from "@/features/calibration/useCalibrationData";
import {
  usePerception,
  usePerceptionEvent,
} from "@/features/perception/PerceptionProvider";
import { usePatientProfile } from "@/features/session/usePatientProfile";
import { useSession } from "@/features/session/store";
import { speak, stopSpeaking } from "@/features/speech/speak";
import { engineModule } from "@/lib/engine/load";
import { riskStore } from "@/features/risk/store";
import { sendRequest } from "./send";

// Health outlook counts needs that never reached anyone. Only the kind and outcome are kept.
const logOutcome = (p: Pending, outcome: "sent" | "local" | "failed" | "expired") =>
  riskStore.addRequest({ at: Date.now(), kind: p.kind, outcome, source: p.source });

export type Pending = {
  kind: string;
  text: string;
  source: string;
  at: number;
};
export type Delivery = {
  state: "idle" | "sending" | "sent" | "failed" | "local";
  text?: string;
  error?: string;
};

type Ctx = {
  pending: Pending | null;
  delivery: Delivery;
  confirmationReadyAt: number | null;
  confirmationHint: string;
  propose: (kind: string, text: string, source?: string) => boolean;
  confirm: () => Promise<void>;
  cancel: () => void;
  repeat: () => void;
};

const RequestContext = createContext<Ctx | null>(null);
type Plan = { mode: string; verb?: string };
type Guide = {
  confirmationMatches: (
    type: string,
    assessment: unknown,
    enabled?: string[],
  ) => boolean;
  responsePlan: (assessment: unknown, enabled?: string[]) => Plan;
};

/** A separate, expiring confirmation is required for each proposed request. */
export function RequestProvider({ children }: { children: React.ReactNode }) {
  const cred = useSession((s) => s.patient);
  const { profile } = usePatientProfile();
  const trained = useCalibrationData();
  const { calibrating } = usePerception();
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmationReadyAt, setConfirmationReadyAt] = useState<number | null>(
    null,
  );
  const [delivery, setDelivery] = useState<Delivery>({ state: "idle" });
  const last = useRef(-Infinity);
  const guide = useRef<Guide | null>(null);
  const current = useRef<Pending | null>(null);
  const currentCredential = useRef(cred);
  const pendingPatient = useRef<string | undefined>(undefined);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const questionVersion = useRef(0);
  const latest = useRef({ profile, trained, calibrating });
  currentCredential.current = cred;
  latest.current = { profile, trained, calibrating };

  useEffect(() => {
    let active = true;
    void engineModule<Guide>("companion-guide")
      .then((m) => {
        if (active) guide.current = m;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const hintFor = useCallback((p: Pending | null) => {
    const { profile, trained } = latest.current;
    if (p?.source === "deliberate blink")
      return "Wait for the question to finish, keep your eyes open briefly, then make your practised yes blink.";
    if (p?.source === "eyespeak") return "Look at Yes, send to ask, or at No to cancel.";
    const plan = guide.current?.responsePlan(
      profile?.assessment,
      trained?.enabled,
    );
    if (plan?.mode === "blink")
      return "Wait for the question to finish, keep your eyes open briefly, then make your practised yes blink.";
    if (plan?.mode === "menu")
      return "Nod and return to center to say yes, or tap a button.";
    if (plan?.mode === "yes")
      return "Please " + plan.verb + " to say yes, or tap a button.";
    return "Tap Yes to send, or No to cancel.";
  }, []);

  const cancel = useCallback(() => {
    questionVersion.current++;
    clearTimeout(expiry.current);
    if (current.current) stopSpeaking();
    current.current = null;
    setPending(null);
    setConfirmationReadyAt(null);
  }, []);

  const speakQuestion = useCallback(
    (p: Pending) => {
      const question = ++questionVersion.current;
      setConfirmationReadyAt(null);
      speak(p.text + ". Shall I ask your caregiver? " + hintFor(p), {
        onDone: () => {
          if (current.current === p && question === questionVersion.current)
            setConfirmationReadyAt(performance.now());
        },
      });
    },
    [hintFor],
  );

  const repeat = useCallback(() => {
    if (current.current) speakQuestion(current.current);
  }, [speakQuestion]);

  const propose = useCallback(
    (kind: string, text: string, source = "touch") => {
      const t = performance.now();
      if (
        current.current ||
        latest.current.calibrating ||
        t - last.current < 2500
      )
        return false;
      const p = { kind, text, source, at: t };
      current.current = p;
      pendingPatient.current = currentCredential.current?.patientId;
      setPending(p);
      setDelivery({ state: "idle" });
      clearTimeout(expiry.current);
      expiry.current = setTimeout(() => {
        if (current.current === p) logOutcome(p, "expired");
        cancel();
      }, 30000);
      speakQuestion(p);
      return true;
    },
    [cancel, speakQuestion],
  );

  const confirm = useCallback(async () => {
    const p = current.current;
    const credential = currentCredential.current;
    const t = performance.now();
    if (!p || t - p.at < 650) return;
    if (t - p.at > 30000 || pendingPatient.current !== credential?.patientId) {
      cancel();
      return;
    }
    // Clear the synchronous gate before awaiting I/O so simultaneous signals cannot send twice.
    current.current = null;
    questionVersion.current++;
    clearTimeout(expiry.current);
    setPending(null);
    setConfirmationReadyAt(null);
    last.current = t;
    stopSpeaking();
    if (!credential) {
      logOutcome(p, "local");
      setDelivery({ state: "local", text: p.text });
      speak(
        "I recognised your request on this device. Connect a caregiver to deliver it.",
      );
      return;
    }
    setDelivery({ state: "sending", text: p.text });
    try {
      await sendRequest(credential, p.kind, p.source, p.text, true);
      logOutcome(p, "sent");
      if (currentCredential.current?.patientId !== credential.patientId) return;
      setDelivery({ state: "sent", text: p.text });
      speak(
        "Your request was sent. I’ll let you know when your caregiver acknowledges it.",
      );
    } catch (e) {
      logOutcome(p, "failed");
      if (currentCredential.current?.patientId === credential.patientId)
        setDelivery({
          state: "failed",
          text: p.text,
          error: (e as Error).message,
        });
    }
  }, [cancel]);

  useEffect(() => {
    // Hydration can supply the stored credential after mount; do not erase a valid first tap.
    if (current.current && (calibrating || pendingPatient.current !== cred?.patientId)) cancel();
  }, [cred?.patientId, calibrating, cancel]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(expiry.current);
      questionVersion.current++;
      current.current = null;
      stopSpeaking();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancel]);

  usePerceptionEvent<{ type: string }>(
    "gesture",
    (e) => {
      const p = current.current;
      if (
        !p ||
        p.source === "deliberate blink" ||
        document.hidden ||
        calibrating ||
        confirmationReadyAt === null
      )
        return;
      if (
        guide.current?.confirmationMatches(
          e.type,
          profile?.assessment,
          trained?.enabled,
        )
      )
        void confirm();
    },
    !!pending && !calibrating,
  );

  const value = useMemo(
    () => ({
      pending,
      delivery,
      confirmationReadyAt,
      confirmationHint: hintFor(pending),
      propose,
      confirm,
      cancel,
      repeat,
    }),
    [
      pending,
      delivery,
      confirmationReadyAt,
      hintFor,
      propose,
      confirm,
      cancel,
      repeat,
    ],
  );
  return (
    <RequestContext.Provider value={value}>{children}</RequestContext.Provider>
  );
}

export function useRequests() {
  const ctx = useContext(RequestContext);
  if (!ctx) throw new Error("useRequests must be used inside RequestProvider");
  return ctx;
}
