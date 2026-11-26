"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/dashboard/Dialog";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Panel } from "@/components/dashboard/Panel";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EXERCISES, steps as stepText, title } from "@/features/move/catalog.js";
import { cueText, sayText } from "@/features/move/cues.js";
import { createDetector, detectorKind, isExperimental, isTracked } from "@/features/move/detectors.js";
import { DemoPlayer } from "@/features/move/DemoPlayer";
import { FRAMING, lessonFor, pick, VIEWPOINTS } from "@/features/move/lessons.js";
import { MoveOverlay } from "@/features/move/MoveOverlay";
import { lockoutActive, PAIN_AREAS, SCREEN_QUESTIONS, screen, SESSION_SYMPTOMS } from "@/features/move/safety.js";
import { TRACKING_LOST_MESSAGE, TRACKING_LOST_MESSAGE_BN, WATCHING, WorkoutSession } from "@/features/move/session.js";
import { moveStore, useMove, type Answer, type Lang, type Summary } from "@/features/move/store";
import { assessFrame, faceInput, handInput, inputTimestamp, LANDMARK_MAX, poseInput, poseRate, statusLabel, trackingModules } from "@/features/move/tracking.js";
import { BASE, Choice, tx, UrgentCard } from "@/features/move/ui";
import { CameraView } from "@/features/perception/CameraView";
import { useActiveModule, usePerception, usePerceptionEvent } from "@/features/perception/PerceptionProvider";
import { speak } from "@/features/speech/speak";
import type { FrameLandmarks } from "@/lib/engine/types";
import { cn } from "@/lib/cn";

type Detector = { update(frame: unknown): DetectorResult; restart?: () => void; quality(): number };
type DetectorResult = {
  valid: boolean;
  reason: string;
  phase: string;
  progress: number;
  counted: boolean;
  confidence: number;
  t: number;
  event?: string | null;
  angle?: number;
  value?: number;
  side?: string | null;
  holding?: boolean;
  heldMs?: number;
};
type Text = { en: string; bn: string };
type View = {
  status: string;
  points: { name: string; side?: string; visible: boolean; inFrame: boolean; visibility: number }[];
  hint: Text | null;
  notice?: Text | null;
  lighting: "ok" | "dark" | "bright" | null;
  counts: { pose: number; face: number; hands: number; total: number };
  side?: string;
};
type Lesson = { goal: Text; viewpoint: string; space: Text; easier: Text; cautions: Text[]; keyTip: Text; topErrors: Text[]; practice: number };

const lessonOf = (id: string) => lessonFor(id) as Lesson;
const ACTIVE = new Set(["WARM_UP", "LEARN", "CAMERA_SETUP", "PRACTICE", "EXERCISE", "REST", "COOL_DOWN", "TRACKING_LOST", "PAUSED"]);
const ENDED = new Set(["SUMMARY", "CANCELLED", "SAFETY_STOP", "COMPLETED"]);
const CAMERA_PHASES = new Set(["CAMERA_SETUP", "PRACTICE", "EXERCISE", "TRACKING_LOST"]);
const VIEW_ICON: Record<string, string> = { front: "⬆", side: "➡", seated: "🪑", floor: "▭", face: "☺", hand: "✋" };
const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** The exercise the camera should be measuring right now, or null. */
const watchId = (cur: WorkoutSession) => (cur.mode === "camera" && WATCHING.includes(cur.state) && cur.cameraCounting ? (cur.exercise.id as string) : null);
const sig = (cur: WorkoutSession) => `${cur.state}|${cur.index}|${cur.set}|${cur.reps}|${cur.practiceReps}`;

export default function LiveSession() {
  useActiveModule("move");
  const lang = useMove((s) => s.language);
  const plan = useMove((s) => s.plan);
  const voice = useMove((s) => s.voice);
  const cameraConsent = useMove((s) => s.cameraConsent);
  const conditions = useMove((s) => s.conditions);
  const painAreas = useMove((s) => s.painAreas);
  const clearance = useMove((s) => s.clearance);
  const lockout = useMove((s) => s.lockout);
  const saved = useMove((s) => s.activeSession);
  const recent = useMove((s) => s.recentScreen);
  const autoNext = useMove((s) => s.autoNext);
  const haptics = useMove((s) => s.haptics);
  const showAll = useMove((s) => s.showAllLandmarks);
  const { state: camera, status: cameraStatus, start: startCamera, stop: stopCamera, setExercising, setModule, instance, mirrored, setMirrored, switchCamera } = usePerception();

  // The camera is released when the workout ends or goes manual, but only if Move turned it on.
  const cameraAtMount = useRef(camera);
  const startedCamera = useRef(false);
  const stopRef = useRef(stopCamera);
  const cameraRef = useRef(camera);
  useEffect(() => {
    stopRef.current = stopCamera;
    cameraRef.current = camera;
    if (camera === "on" && cameraAtMount.current !== "on") startedCamera.current = true;
  }, [camera, stopCamera]);
  const releaseCamera = useCallback(() => {
    if (!startedCamera.current) return;
    startedCamera.current = false;
    cameraAtMount.current = "off";
    stopRef.current();
  }, []);
  // Fast tracking is only for this page; hand the camera back to the companion when leaving.
  useEffect(
    () => () => {
      setModule("companion");
      setMirrored(true);
      if (startedCamera.current) stopRef.current();
    },
    [setModule, setMirrored],
  );

  const session = useRef<WorkoutSession | null>(null);
  const detector = useRef<{ key: string; count: number; value: Detector | null }>({ key: "", count: -1, value: null });
  const lastResult = useRef<DetectorResult | null>(null);
  const lastFrame = useRef<FrameLandmarks | null>(null);
  // Distinct body-reading times from the last few seconds, to notice a phone that reads too slowly.
  const poseTimes = useRef<number[]>([]);
  const lastInput = useRef<number | null>(null);
  const viewRef = useRef<View | null>(null);
  const [, render] = useState(0);
  const [live, setLive] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);
  const [pausedForDemo, setPausedForDemo] = useState(false);
  const [cameras, setCameras] = useState(0);
  // Answers from the goal wizard a few minutes ago are pre-filled; the person can still change them.
  const fresh = recent && Date.now() - recent.at < 15 * 60 * 1000 ? recent : null;
  // Saved preferences arrive after hydration, so local choices only override them once the person acts.
  const [picked, setPrecheck] = useState<Record<string, Answer>>({});
  const precheck: Record<string, Answer> = { ...(fresh?.answers ?? {}), ...picked };
  const [modeChoice, setMode] = useState<"camera" | "manual" | null>(null);
  const mode = modeChoice ?? (cameraConsent ? "camera" : "manual");
  const [painChoice, setPainChoice] = useState<string[] | null>(null);
  const pain = painChoice ?? (fresh?.painAreas.length ? fresh.painAreas : painAreas);
  const setPain = (f: (x: string[]) => string[]) => setPainChoice(f(pain));
  const [unwell, setUnwell] = useState(false);
  const [symptomText, setSymptomText] = useState("");
  const [effort, setEffort] = useState<number | null>(null);
  const [felt, setFelt] = useState("");
  const lastSaved = useRef(0);
  const feedClock = useRef({ key: "", at: 0 });
  const recordedFor = useRef<string | null>(null);
  const [rated, setRated] = useState(false);
  const s = session.current;

  // What the remembered answers don't cover is asked here, before every workout.
  const ask = useMemo(() => SCREEN_QUESTIONS.filter((q: { id: string }) => q.id === "emergency_now" || !(q.id in conditions)), [conditions]);

  const persist = useCallback(
    (force = false) => {
      const cur = session.current;
      if (!cur) return;
      const now = performance.now();
      if (!force && now - lastSaved.current < 2000) return;
      lastSaved.current = now;
      moveStore.set({ activeSession: ACTIVE.has(cur.state) ? cur.serialize() : null });
      // Whatever was done is kept as soon as the workout ends, even if the page is closed before rating it.
      const ended = ENDED.has(cur.state);
      if (ended) releaseCamera();
      if (ended && cur.startedAt && recordedFor.current !== cur.startedAt + cur.state) {
        recordedFor.current = cur.startedAt + cur.state;
        const summary = cur.summary() as Summary;
        moveStore.set((st) => {
          const prior = st.history.find((h) => h.startedAt === summary.startedAt);
          return { history: [...st.history.filter((h) => h.startedAt !== summary.startedAt), { ...summary, effort: prior?.effort ?? null, feltAfter: prior?.feltAfter }] };
        });
      }
    },
    [releaseCamera],
  );

  const announce = useCallback(() => {
    const cur = session.current;
    if (!cur) return;
    const items = cur.drain() as { text: string; kind: string }[];
    if (!items.length) return;
    const text = items.map((a) => sayText(a.text, lang)).join(" ");
    setLive(text);
    if (voice) speak(text);
    if (haptics && items.some((a) => a.kind === "count" || a.kind === "praise")) navigator.vibrate?.(40);
  }, [voice, haptics, lang]);

  // Resume a workout that was interrupted by a reload or navigation. It comes back paused.
  useEffect(() => {
    if (session.current || !saved) return;
    try {
      session.current = WorkoutSession.restore(saved, { wallClock: Date.now, tracked: isTracked, practiceTarget: (id: string) => lessonOf(id).practice });
      render((v) => v + 1);
    } catch {
      moveStore.set({ activeSession: null });
    }
  }, [saved]);

  // Going on automatically after rest is the person's choice and can change mid-workout.
  useEffect(() => {
    if (session.current) session.current.autoNext = autoNext;
  }, [autoNext, s]);

  // The workout clock. Monotonic, and it only advances while the page is visible.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = session.current;
      if (!cur) return;
      const before = sig(cur);
      const now = performance.now();
      cur.tick(now);
      const w = watchId(cur);
      if (w) {
        // No frames at all (camera off, model missing, tab throttled) is the same as not seeing the person.
        const key = `${cur.detectorEpoch}:${w}`;
        if (feedClock.current.key !== key) feedClock.current = { key, at: now };
        else if (now - feedClock.current.at > 1500) cur.observe({ valid: false, t: now, reason: "No camera frames" });
        viewRef.current = assessFrame(lastFrame.current, w, { now, cameraOn: cameraRef.current === "on", poseFps: poseRate(poseTimes.current, lastFrame.current?.timestampMs ?? now) }) as View;
      } else viewRef.current = null;
      announce();
      persist(before !== sig(cur));
      render((v) => v + 1);
    }, 250);
    const hidden = () => {
      if (document.hidden && session.current && session.current.state !== "PAUSED") {
        session.current.pause();
        persist(true);
        render((v) => v + 1);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [announce, persist]);

  // While a workout runs, exercise movements must not be read as AAC requests.
  const exercisingNow = !!s && ACTIVE.has(s.state) && s.state !== "PAUSED";
  useEffect(() => {
    setExercising(exercisingNow);
  }, [exercisingNow, setExercising]);
  useEffect(() => () => setExercising(false), [setExercising]);

  const watching = s ? watchId(s) : null;
  // Model router: run at full rate only what this exercise is measured from (all of them for "show all").
  const routeId = watching ?? (s && ACTIVE.has(s.state) ? (s.exercise?.id ?? "") : "");
  useEffect(() => {
    if (camera !== "on") return;
    instance()?.setMoveTracking?.(trackingModules(routeId, showAll));
  }, [camera, instance, routeId, showAll]);

  useEffect(() => {
    if (camera !== "on") return;
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((d) => setCameras(d.filter((x) => x.kind === "videoinput").length))
      .catch(() => setCameras(0));
  }, [camera]);

  const feed = useCallback(
    (frame: FrameLandmarks) => {
      lastFrame.current = frame;
      const pt = frame.pose ? (frame.poseAt ?? frame.timestampMs) : null;
      if (Number.isFinite(pt) && pt !== poseTimes.current[poseTimes.current.length - 1]) {
        poseTimes.current.push(pt as number);
        if (poseTimes.current.length > 120) poseTimes.current.splice(0, poseTimes.current.length - 120);
      }
      const cur = session.current;
      if (!cur) return;
      const w = watchId(cur);
      if (!w) return;
      const kind = detectorKind(w);
      const key = `${cur.detectorEpoch}:${w}`;
      if (detector.current.key !== key) {
        const step = cur.step;
        try {
          const holdMs = kind === "face" ? (step?.holdSeconds ?? 2) * 1000 : kind === "hands" ? 200 : (step?.holdMs ?? 150);
          detector.current = { key, count: cur.countEpoch, value: createDetector(w, { limits: step?.limits ?? null, side: step?.side ?? null, holdMs }) as Detector | null };
        } catch {
          detector.current = { key, count: cur.countEpoch, value: null };
          cur.useManual();
          announce();
          persist(true);
          return;
        }
        lastInput.current = null;
        lastResult.current = null;
      }
      // Practice is over or a new set began: count afresh, keeping what was learned (e.g. resting values).
      if (detector.current.count !== cur.countEpoch) {
        detector.current.count = cur.countEpoch;
        detector.current.value?.restart?.();
      }
      // Each model result is used once, even though frames arrive at the face model's rate.
      const ts = inputTimestamp(frame, kind);
      if (Number.isFinite(ts) && ts === lastInput.current) return;
      lastInput.current = Number.isFinite(ts) ? (ts as number) : null;
      const input = kind === "pose" ? poseInput(frame) : kind === "hands" ? handInput(frame) : faceInput(frame);
      const result = detector.current.value?.update(input);
      if (!result) return;
      feedClock.current = { key, at: performance.now() };
      lastResult.current = result;
      const before = sig(cur);
      cur.observe(result);
      if (before !== sig(cur)) {
        announce();
        persist(true);
      }
    },
    [announce, persist],
  );
  usePerceptionEvent<FrameLandmarks>("landmarks", feed, !!s && s.mode === "camera" && camera === "on");

  function begin() {
    if (!plan) return;
    const screening = screen({ ...conditions, ...precheck }, { painAreas: pain, clearance, lockout });
    const cur = new WorkoutSession({ program: plan, mode, screening, language: lang, wallClock: Date.now, tracked: isTracked, practiceTarget: (id: string) => lessonOf(id).practice, autoNext });
    session.current = cur;
    cur.begin(performance.now());
    if (cur.lockout) moveStore.set({ lockout: cur.lockout });
    moveStore.set({ recentScreen: null });
    // The camera is turned on later, at the first camera set-up, after the person has seen the exercise.
    moveStore.set((st) => ({ consentAudit: [...st.consentAudit, { at: new Date().toISOString(), event: mode === "camera" ? "session_camera_on_device" : "session_manual" }] }));
    announce();
    persist(true);
    render((v) => v + 1);
  }

  function report(input: string) {
    const cur = session.current;
    if (!cur) return;
    cur.reportSymptom(input);
    if (cur.lockout) moveStore.set({ lockout: cur.lockout });
    setUnwell(false);
    setSymptomText("");
    setDemoOpen(false);
    announce();
    persist(true);
    render((v) => v + 1);
  }

  function record(cur: WorkoutSession, extra: Partial<Summary> = {}) {
    const summary = { ...(cur.summary() as Summary), ...extra };
    moveStore.set((st) => ({ history: [...st.history.filter((h) => h.startedAt !== summary.startedAt), summary] }));
  }

  function act(fn: (cur: WorkoutSession) => void) {
    const cur = session.current;
    if (!cur) return;
    fn(cur);
    if (cur.mode === "manual") releaseCamera();
    announce();
    persist(true);
    render((v) => v + 1);
  }

  function turnOnCamera() {
    if (camera === "on" || camera === "starting") return;
    void startCamera();
  }

  function openDemo() {
    const cur = session.current;
    if (cur && ["EXERCISE", "TRACKING_LOST", "PRACTICE"].includes(cur.state)) {
      act((c) => c.pause());
      setPausedForDemo(true);
    }
    setDemoOpen(true);
  }
  function closeDemo() {
    setDemoOpen(false);
    if (pausedForDemo && session.current?.state === "PAUSED") act((c) => c.resume(performance.now()));
    setPausedForDemo(false);
  }

  if (!plan && !s)
    return (
      <EmptyState title={tx(lang, "No plan yet", "এখনো প্ল্যান নেই")} action={<ButtonLink href={`${BASE}/start`}>{tx(lang, "Build a plan", "প্ল্যান তৈরি")}</ButtonLink>}>
        Choose a goal and ASHA suggests a starter routine you can change.
      </EmptyState>
    );

  // ---------- Before starting ----------
  if (!s) {
    if (lockoutActive(lockout, Date.now())) return <p className="text-muted">{tx(lang, "Workouts are paused for your safety.", "নিরাপত্তার জন্য ব্যায়াম বন্ধ।")}</p>;
    const answered = ask.every((q: { id: string }) => precheck[q.id]) && (!(precheck.pain === "yes" || precheck.pain === "unsure") || pain.length > 0 || "pain" in conditions);
    return (
      <div className="max-w-3xl">
        <PageHeader
          title={plan!.name}
          description={tx(lang, "A quick check before you start. ASHA doesn't diagnose; your answers decide what is safe to offer today.", "শুরুর আগে দ্রুত যাচাই। ASHA রোগ নির্ণয় করে না; আপনার উত্তর ঠিক করে আজ কী নিরাপদ।")}
        />
        <section aria-labelledby="precheck-title">
          <h2 id="precheck-title" className="mb-3 text-base font-semibold text-ink">
            {tx(lang, "Safety check", "নিরাপত্তা যাচাই")}
          </h2>
          <ol className="divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
            {ask.map((q: { id: string; en: string; bn: string }) => (
              <li key={q.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
                <p className="text-ink md:max-w-md">{lang === "bn" ? q.bn : q.en}</p>
                <div className="inline-flex shrink-0 self-start rounded-full bg-wash p-1 ring-1 ring-line md:self-center" role="radiogroup" aria-label={q.en}>
                  {(["no", "yes", "unsure"] as Answer[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={precheck[q.id] === v}
                      onClick={() => setPrecheck((p) => ({ ...p, [q.id]: v }))}
                      className={cn("h-9 min-w-14 rounded-full px-3 text-sm font-medium transition-colors", precheck[q.id] === v ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}
                    >
                      {v === "no" ? tx(lang, "No", "না") : v === "yes" ? tx(lang, "Yes", "হ্যাঁ") : tx(lang, "Not sure", "নিশ্চিত নই")}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {(precheck.pain === "yes" || precheck.pain === "unsure") && (
            <div className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-line">
              <p className="text-ink">{tx(lang, "Where is the pain?", "কোথায় ব্যথা?")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PAIN_AREAS.map((p: { id: string; en: string; bn: string }) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={pain.includes(p.id)}
                    onClick={() => setPain((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}
                    className={cn("h-10 rounded-full px-4 text-sm ring-1 transition-colors", pain.includes(p.id) ? "bg-brand-soft text-brand ring-brand" : "bg-white text-ink ring-line hover:bg-wash")}
                  >
                    {tx(lang, p.en, p.bn)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="count-title" className="mt-10">
          <h2 id="count-title" className="text-base font-semibold text-ink">
            {tx(lang, "How should ASHA count?", "কীভাবে গুনবে?")}
          </h2>
          <p className="mb-3 mt-0.5 text-sm text-muted">{tx(lang, "Each exercise starts with a short demonstration and a practice try that isn't counted.", "প্রতিটি ব্যায়াম শুরু হয় ছোট একটি প্রদর্শন আর একটি অনুশীলন দিয়ে, যা গোনা হয় না।")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice selected={mode === "camera"} onClick={() => setMode("camera")}>
              <span className="block font-medium text-ink">{tx(lang, "Camera counts tracked exercises", "ক্যামেরা গুনবে")}</span>
              <span className="block text-sm text-muted">{tx(lang, "On-device only. Video is never uploaded or saved. You can switch to manual at any time.", "শুধু এই ডিভাইসে। ভিডিও কখনো আপলোড বা সংরক্ষণ হয় না। যেকোনো সময় নিজে গোনায় যেতে পারবেন।")}</span>
            </Choice>
            <Choice selected={mode === "manual"} onClick={() => setMode("manual")}>
              <span className="block font-medium text-ink">{tx(lang, "Manual: I tap to count", "নিজে: আমি চেপে গুনব")}</span>
              <span className="block text-sm text-muted">{tx(lang, "No camera needed. Works offline.", "ক্যামেরা লাগবে না। অফলাইনেও চলে।")}</span>
            </Choice>
          </div>
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button disabled={!answered} onClick={begin}>
            {tx(lang, "Start workout", "ব্যায়াম শুরু")}
          </Button>
          {!answered && <p className="text-sm text-muted">{tx(lang, "Answer each question to continue.", "এগোতে প্রতিটি প্রশ্নের উত্তর দিন।")}</p>}
        </div>
      </div>
    );
  }

  // ---------- Blocked by the safety check ----------
  if (s.state === "PRECHECK")
    return (
      <Panel className="mx-auto max-w-2xl" title={tx(lang, "Not today, or not without your clinician", "আজ নয়, বা চিকিৎসক ছাড়া নয়")}>
        <p className="text-ink">{s.blockReason}</p>
        <p className="mt-2 text-sm text-muted">ASHA can&apos;t give medical clearance. You can record a clinician&apos;s clearance, follow a plan they assign, or choose a different plan.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href={`${BASE}/safety#clearance`}>Record clearance</ButtonLink>
          <ButtonLink href={`${BASE}/clinician`} variant="secondary">
            Clinician programs
          </ButtonLink>
          <Button
            variant="ghost"
            onClick={() => {
              session.current = null;
              moveStore.set({ activeSession: null });
              render((v) => v + 1);
            }}
          >
            {tx(lang, "Back", "পেছনে")}
          </Button>
        </div>
      </Panel>
    );

  // ---------- Stopped for safety ----------
  if (s.state === "SAFETY_STOP")
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {!lockoutActive(lockout, Date.now()) && <UrgentCard reasons={s.safety?.reasons ?? []} kind={s.safety?.action === "stop_rest" ? "rest" : "emergency"} />}
        <p className="text-sm text-muted">{tx(lang, "This workout has ended and the camera is off. What you completed was saved to Progress.", "ব্যায়াম শেষ হয়েছে এবং ক্যামেরা বন্ধ। যা করেছেন তা অগ্রগতিতে সংরক্ষিত।")}</p>
        <ButtonLink href={`${BASE}/progress`} variant="secondary">
          {tx(lang, "View progress", "অগ্রগতি দেখুন")}
        </ButtonLink>
      </div>
    );

  // ---------- Summary ----------
  if (s.state === "SUMMARY" || s.state === "CANCELLED" || s.state === "COMPLETED") {
    const sum = s.summary() as Summary;
    return (
      <div className="mx-auto max-w-3xl space-y-6" data-testid="move-summary">
        <PageHeader
          title={s.state === "CANCELLED" ? tx(lang, "Workout stopped", "ব্যায়াম থামানো হয়েছে") : tx(lang, "Workout complete", "ব্যায়াম শেষ")}
          description={`${sum.programName} · ${sum.activeMinutes} ${tx(lang, "active minutes", "সক্রিয় মিনিট")} · ${sum.setsDone} / ${sum.setsPlanned} ${tx(lang, "sets", "সেট")}`}
        />
        <Panel title={tx(lang, "What you did", "যা করেছেন")}>
          <ul className="divide-y divide-line">
            {sum.exercises.map((e) => {
              const ex = EXERCISES[e.exerciseId];
              const held = e.countedBy.includes("camera") ? tx(lang, "held, timed by the camera", "ধরে রাখা, ক্যামেরা সময় গুনেছে") : tx(lang, "held, your timer", "ধরে রাখা, আপনার টাইমার");
              return (
                <li key={e.exerciseId} className="py-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-ink">{title(ex, lang)}</span>
                    <span className="text-sm text-muted">
                      {e.excludedBySafetyCheck
                        ? tx(lang, "Left out by today's safety check", "আজকের নিরাপত্তা যাচাইয়ে বাদ")
                        : e.skipped
                          ? e.skipReason || tx(lang, "Skipped", "বাদ দেওয়া")
                          : `${e.setsDone}/${e.plannedSets} ${tx(lang, "sets", "সেট")} · ${e.seconds ? `${e.seconds}s ${held}` : `${e.reps} ${tx(lang, "reps", "বার")}`}`}
                    </span>
                  </div>
                  {!e.skipped && !e.seconds && (e.setsDone > 0 || e.reps > 0) && (
                    <p className="mt-1 text-sm text-ink" data-testid="move-summary-sources">
                      {`${e.cameraReps ?? 0} ${tx(lang, "camera estimate", "ক্যামেরার আনুমানিক")} · ${e.manualReps ?? 0} ${tx(lang, "your entry", "আপনার গোনা")}`}
                      {e.partials ? ` · ${e.partials} ${tx(lang, "partial, not counted", "অসম্পূর্ণ, গোনা হয়নি")}` : ""}
                    </p>
                  )}
                  {e.quality && (
                    <p className="mt-1 text-xs text-muted">
                      {tx(lang, "Clear view in", "পরিষ্কার দেখা গেছে")} {Math.round(e.quality.clearViewShare * 100)}% {tx(lang, "of camera frames", "ক্যামেরা ফ্রেমে")} · {tx(lang, "tracking lost", "ট্র্যাকিং হারিয়েছে")} {e.quality.trackingLost}×
                      {isExperimental(e.exerciseId) ? ` · ${tx(lang, "experimental detector", "পরীক্ষামূলক ডিটেক্টর")}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">{tx(lang, sum.note, "গোনা হয় ক্যামেরার আনুমানিক হিসাবে বা আপনার নিজের চাপে, আলাদা করে দেখানো। ক্যালরি, শরীরের সংকেত বা ভঙ্গির নম্বর অনুমান করা হয় না।")}</p>
        </Panel>
        {!rated && s.state !== "COMPLETED" ? (
          <Panel title={tx(lang, "How hard did that feel?", "কতটা কঠিন লাগল?")} description="0 is resting, 10 is the hardest you can imagine. Most workouts should feel 3–5. Your workout is already saved; this adds how it felt.">
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" aria-label="Effort from 0 to 10">
              {Array.from({ length: 11 }, (_, i) => (
                <Choice key={i} selected={effort === i} onClick={() => setEffort(i)} className="p-2 text-center">
                  <span className="font-semibold text-ink">{i}</span>
                </Choice>
              ))}
            </div>
            <p className="mt-4 text-sm font-medium text-ink">{tx(lang, "How do you feel now?", "এখন কেমন লাগছে?")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {["Good", "Tired but fine", "Sore"].map((f) => (
                <Choice key={f} selected={felt === f} onClick={() => setFelt(f)} className="p-3">
                  <span className="text-ink">{f}</span>
                </Choice>
              ))}
              <Choice selected={false} onClick={() => setUnwell(true)} className="p-3">
                <span className="text-red-700">Unwell</span>
              </Choice>
            </div>
            <Button
              className="mt-5"
              onClick={() => {
                record(s, { effort, feltAfter: felt });
                setRated(true);
                act((cur) => cur.finish());
              }}
            >
              {tx(lang, "Save how it felt", "অনুভূতি সংরক্ষণ")}
            </Button>
          </Panel>
        ) : (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${BASE}/progress`}>{tx(lang, "View progress", "অগ্রগতি দেখুন")}</ButtonLink>
            <Button
              variant="secondary"
              onClick={() => {
                session.current = null;
                setRated(false);
                setEffort(null);
                setFelt("");
                moveStore.set({ activeSession: null });
                render((v) => v + 1);
              }}
            >
              {tx(lang, "Back to start", "শুরুতে ফিরুন")}
            </Button>
          </div>
        )}
        {unwell && <SymptomPicker onPick={report} onClose={() => setUnwell(false)} text={symptomText} setText={setSymptomText} />}
      </div>
    );
  }

  // ---------- Live ----------
  const ex = s.exercise;
  const step = s.step;
  const lesson = ex ? lessonOf(ex.id) : null;
  const paused = s.state === "PAUSED";
  const phase: string = paused ? (s.resumeTo ?? "PAUSED") : s.state;
  const r = watching ? lastResult.current : null;
  const view = watching ? viewRef.current : null;
  const lost = phase === "TRACKING_LOST";
  const showCamera = !!ex && s.mode === "camera" && s.cameraCounting && CAMERA_PHASES.has(phase);
  const label = statusLabel(view?.status ?? "OFF", { mode: s.mode, cameraOn: camera === "on" });
  const timed = !!s.holdTarget;
  const upNext = s.upNext as { exerciseId: string; set: number } | null;
  const cue = !showCamera || camera !== "on" || paused ? null : lost ? tx(lang, TRACKING_LOST_MESSAGE, TRACKING_LOST_MESSAGE_BN) : view && view.status !== "READY" && view.hint ? pick(view.hint, lang) : r?.reason ? cueText(r.reason, lang) : view?.notice ? pick(view.notice, lang) : null;
  const cueDetail = lost && view?.hint ? pick(view.hint, lang) : null;
  const stage: Record<string, string> = {
    WARM_UP: tx(lang, "Warm-up", "ওয়ার্ম-আপ"),
    LEARN: tx(lang, "Learn", "শিখুন"),
    CAMERA_SETUP: tx(lang, "Set up", "সেটআপ"),
    PRACTICE: tx(lang, "Practice", "অনুশীলন"),
    EXERCISE: tx(lang, "Do it", "করুন"),
    TRACKING_LOST: tx(lang, "Can't see you", "দেখা যাচ্ছে না"),
    REST: tx(lang, "Rest", "বিশ্রাম"),
    COOL_DOWN: tx(lang, "Cool-down", "কুল-ডাউন"),
    PAUSED: tx(lang, "Paused", "বিরতি"),
  };
  const flow = s.cameraCounting ? ["LEARN", "CAMERA_SETUP", "PRACTICE", "EXERCISE", "REST"] : ["LEARN", "EXERCISE", "REST"];
  const flowAt = phase === "TRACKING_LOST" ? "EXERCISE" : phase;
  const progress = timed ? s.holdMs / Math.max(1, s.holdTarget) : s.reps / Math.max(1, step?.targetReps ?? 1);

  return (
    <div className="pb-4">
      <div aria-live="polite" className="sr-only" data-testid="move-live">
        {live}
      </div>
      <div className="mb-4">
        <p className="text-sm text-muted">
          {s.program.name} · {tx(lang, "exercise", "ব্যায়াম")} {s.index + 1} / {s.program.sequence.length}
          {ex && !["WARM_UP", "COOL_DOWN"].includes(phase) ? ` · ${title(ex, lang)}` : ""}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink" data-testid="move-state" data-state={s.state}>
          {stage[s.state] ?? s.state}
        </h1>
        {ex && flow.includes(flowAt) && (
          <ol className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label={tx(lang, "Steps for this exercise", "এই ব্যায়ামের ধাপ")}>
            {flow.map((f, i) => {
              const at = flow.indexOf(flowAt);
              return (
                <li key={f} aria-current={f === flowAt ? "step" : undefined} className={cn("rounded-full px-2.5 py-1 ring-1", f === flowAt ? "bg-brand text-white ring-brand" : i < at ? "bg-brand-soft text-brand ring-brand-mint" : "bg-white text-muted ring-line")}>
                  {i + 1}. {stage[f]}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {unwell && <SymptomPicker onPick={report} onClose={() => setUnwell(false)} text={symptomText} setText={setSymptomText} />}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-3">
          {showCamera && ex && lesson ? (
            <>
              <CameraView offMessage={tx(lang, "The camera stays off until you turn it on. Video never leaves this device.", "আপনি চালু না করা পর্যন্ত ক্যামেরা বন্ধ থাকে। ভিডিও এই ডিভাইসের বাইরে যায় না।")}>
                <MoveOverlay exerciseId={ex.id} showAll={showAll} mirrored={mirrored} framing={phase === "CAMERA_SETUP" || phase === "PRACTICE" ? FRAMING[lesson.viewpoint as keyof typeof FRAMING] : null} ready={view?.status === "READY"} />
                {cue && (
                  <div className={cn("absolute inset-x-3 top-3 rounded-xl px-3 py-2 text-center text-base font-semibold text-white sm:text-lg", lost ? "bg-red-700/85" : "bg-black/65")} data-testid="move-cue" aria-live="polite" lang={lang}>
                    {cue}
                    {cueDetail && <span className="mt-0.5 block text-sm font-normal">{cueDetail}</span>}
                  </div>
                )}
              </CameraView>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={label.key === "live" ? "good" : label.key === "uncertain" ? "warn" : "neutral"} pulse={label.key === "live"}>
                  <span data-testid="move-tracking-status" data-status={camera === "on" ? (view?.status ?? "TRACKING_LOST") : "OFF"}>
                    {tx(lang, label.en, label.bn)}
                  </span>
                </StatusPill>
                {isExperimental(ex.id) && <StatusPill tone="brand">{tx(lang, "Experimental detector", "পরীক্ষামূলক ডিটেক্টর")}</StatusPill>}
                {camera === "on" && cameras > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => void switchCamera()}>
                    {tx(lang, "Switch camera", "ক্যামেরা বদলান")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-pressed={mirrored} data-testid="move-mirror" onClick={() => setMirrored(!mirrored)}>
                  {mirrored ? tx(lang, "Mirror view: on", "আয়নার মতো: চালু") : tx(lang, "Mirror view: off", "আয়নার মতো: বন্ধ")}
                </Button>
              </div>
              <AdvancedPanel lang={lang} view={view} result={r} frame={camera === "on" ? lastFrame.current : null} showAll={showAll} />
            </>
          ) : phase === "LEARN" && ex ? (
            <DemoPlayer exerciseId={ex.id} lang={lang} />
          ) : phase === "EXERCISE" && ex ? (
            <Panel title={s.mode === "manual" ? tx(lang, "Manual mode", "ম্যানুয়াল মোড") : tx(lang, "You count this one", "এটি আপনি গুনবেন")} description={tx(lang, "Tap once for each repetition you finish. Your counts are saved as your own entry.", "প্রতিবার শেষ করলে একবার চাপুন। আপনার গোনা আপনার নিজের হিসেবে সংরক্ষিত হয়।")}>
              <DemoPlayer exerciseId={ex.id} lang={lang} compact />
            </Panel>
          ) : phase === "REST" && upNext ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted">{tx(lang, "Next up", "এরপর")}</p>
              <DemoPlayer exerciseId={upNext.exerciseId} lang={lang} compact />
            </div>
          ) : (
            <Panel title={phase === "COOL_DOWN" ? tx(lang, "Cool down", "কুল-ডাউন") : tx(lang, "Warm up", "ওয়ার্ম-আপ")}>
              <p className="text-ink">{phase === "COOL_DOWN" ? tx(lang, "Walk or march slowly and let your breathing settle.", "ধীরে হাঁটুন বা পা ফেলুন, শ্বাস স্বাভাবিক হতে দিন।") : tx(lang, "March gently in place or seated, roll your shoulders and breathe normally.", "দাঁড়িয়ে বা বসে আলতো করে পা ফেলুন, কাঁধ ঘোরান, স্বাভাবিকভাবে শ্বাস নিন।")}</p>
              {s.screening?.heartConscious && <p className="mt-2 text-sm text-muted">{tx(lang, "Heart-conscious: keep to a pace where you can talk comfortably.", "হৃদয়-সচেতন: এমন গতিতে থাকুন যাতে স্বচ্ছন্দে কথা বলা যায়।")}</p>}
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {paused ? (
            <Panel title={tx(lang, "Paused", "বিরতি")}>
              <p className="text-ink">{tx(lang, "Nothing is counted or timed while paused.", "বিরতির সময় কিছু গোনা বা সময় ধরা হয় না।")}</p>
              <Button className="mt-4" onClick={() => act((cur) => cur.resume(performance.now()))}>
                {tx(lang, "Resume", "আবার শুরু")}
              </Button>
            </Panel>
          ) : (
            <>
              {(s.state === "WARM_UP" || s.state === "COOL_DOWN") && (
                <Panel title={stage[s.state]}>
                  <p className="text-4xl font-semibold tabular-nums text-ink" aria-label={tx(lang, "Time left", "বাকি সময়")}>
                    {fmt(s.remainingMs)}
                  </p>
                  <Button className="mt-4" variant="secondary" onClick={() => act((cur) => cur.next())}>
                    {s.state === "WARM_UP" ? tx(lang, "I'm warmed up", "ওয়ার্ম-আপ হয়েছে") : tx(lang, "Finish", "শেষ")}
                  </Button>
                </Panel>
              )}

              {s.state === "LEARN" && ex && lesson && (
                <Panel title={title(ex, lang)} description={pick(lesson.goal, lang)} action={step.clinicianLocked ? <StatusPill tone="brand">Clinician plan</StatusPill> : undefined}>
                  <p className="flex items-center gap-2 text-sm font-medium text-ink" data-testid="move-viewpoint">
                    <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-brand-soft text-base">
                      {VIEW_ICON[lesson.viewpoint] ?? "•"}
                    </span>
                    {pick(VIEWPOINTS[lesson.viewpoint as keyof typeof VIEWPOINTS], lang)}
                  </p>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink">
                    {(stepText(ex, lang) as string[]).slice(0, 3).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div>
                      <dt className="font-medium text-ink">{tx(lang, "You need", "যা লাগবে")}</dt>
                      <dd className="text-muted">{pick(lesson.space, lang)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink">{tx(lang, "Easier option", "সহজ বিকল্প")}</dt>
                      <dd className="text-muted">{pick(lesson.easier, lang)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink">{tx(lang, "Watch out for", "যা এড়াবেন")}</dt>
                      <dd className="text-muted">{lesson.topErrors.map((e) => pick(e, lang)).join("; ")}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
                    <p className="font-medium">{tx(lang, "Safety", "নিরাপত্তা")}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {lesson.cautions.map((c) => (
                        <li key={c.en}>{pick(c, lang)}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {s.cameraCounting
                      ? `${tx(lang, "Next you'll set up the camera and try it once without counting.", "এরপর ক্যামেরা ঠিক করে একবার না গুনে চেষ্টা করবেন।")}${isExperimental(ex.id) ? ` ${tx(lang, "This camera detector is experimental.", "এই ক্যামেরা ডিটেক্টরটি পরীক্ষামূলক।")}` : ""}`
                      : tx(lang, "You'll count this one yourself.", "এটি আপনি নিজে গুনবেন।")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => act((cur) => cur.ready())}>{s.cameraCounting ? tx(lang, "I'm ready: set up camera", "প্রস্তুত: ক্যামেরা ঠিক করি") : tx(lang, "I'm ready", "আমি প্রস্তুত")}</Button>
                    <Button variant="ghost" onClick={() => act((cur) => cur.skip())}>
                      {tx(lang, "Skip this exercise", "এই ব্যায়াম বাদ দিন")}
                    </Button>
                  </div>
                </Panel>
              )}

              {s.state === "CAMERA_SETUP" && lesson && (
                <Panel title={tx(lang, "Set up your camera", "ক্যামেরা ঠিক করুন")} description={pick(VIEWPOINTS[lesson.viewpoint as keyof typeof VIEWPOINTS], lang)}>
                  {camera === "error" ? (
                    <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                      <p className="font-medium">{tx(lang, "Camera unavailable. You can log the workout manually.", "ক্যামেরা পাওয়া যাচ্ছে না। আপনি নিজে গুনে ব্যায়াম লিখতে পারেন।")}</p>
                      {cameraStatus && <p className="mt-1">{cameraStatus}</p>}
                    </div>
                  ) : camera !== "on" ? (
                    <>
                      <p className="text-sm text-ink">{tx(lang, "ASHA looks at a few body points on this device to count. Video is never uploaded or saved, and the camera turns off when the workout ends.", "গোনার জন্য আশা এই ডিভাইসেই শরীরের কয়েকটি বিন্দু দেখে। ভিডিও কখনো আপলোড বা সংরক্ষণ হয় না, ব্যায়াম শেষে ক্যামেরা বন্ধ হয়।")}</p>
                      <Button className="mt-3" onClick={turnOnCamera} disabled={camera === "starting"}>
                        {camera === "starting" ? tx(lang, "Loading on-device models…", "ডিভাইসের মডেল লোড হচ্ছে…") : tx(lang, "Turn on camera", "ক্যামেরা চালু করুন")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-ink">{tx(lang, "Fit yourself inside the dashed outline. It turns green when ASHA can see what it needs.", "ড্যাশ দেওয়া রেখার ভেতরে আসুন। আশা দরকারি অংশ দেখতে পেলে রেখা সবুজ হবে।")}</p>
                      <VisibilityList view={view} lang={lang} />
                    </>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={!s.framingOk || camera !== "on"} onClick={() => act((cur) => cur.confirmCamera())}>
                      {s.framingOk ? tx(lang, "Let's practise", "অনুশীলন করি") : tx(lang, "Waiting for a clear view…", "পরিষ্কার দৃশ্যের অপেক্ষা…")}
                    </Button>
                    <Button variant="secondary" onClick={() => act((cur) => cur.useManual())}>
                      {tx(lang, "Use manual counting", "নিজে গুনব")}
                    </Button>
                  </div>
                </Panel>
              )}

              {s.state === "PRACTICE" && (
                <Panel title={tx(lang, "Practice (not counted)", "অনুশীলন (গোনা হবে না)")}>
                  <p className="text-4xl font-semibold tabular-nums text-ink" data-testid="move-practice">
                    {s.practiceReps} / {s.practiceGoal}
                  </p>
                  <p className="mt-1 text-sm text-muted">{timed ? tx(lang, "Get into position and hold it for 2 seconds. Nothing is timed yet.", "অবস্থানে এসে ২ সেকেন্ড ধরে রাখুন। এখনো সময় গোনা হচ্ছে না।") : tx(lang, "Try the movement. These tries are not counted.", "নড়াচড়াটি চেষ্টা করুন। এগুলো গোনা হবে না।")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={!s.canStartCounting} onClick={() => act((cur) => cur.startCounting())}>
                      {s.practiceReps >= s.practiceGoal ? tx(lang, "Start counting", "গোনা শুরু") : tx(lang, "Skip practice and start", "অনুশীলন বাদ দিয়ে শুরু")}
                    </Button>
                    <Button variant="secondary" onClick={openDemo}>
                      {tx(lang, "Show me again", "আবার দেখান")}
                    </Button>
                    <Button variant="ghost" onClick={() => act((cur) => cur.useManual())}>
                      {tx(lang, "Use manual counting", "নিজে গুনব")}
                    </Button>
                  </div>
                  {!s.canStartCounting && <p className="mt-2 text-xs text-muted">{tx(lang, "Counting can start once ASHA has had a clear view of you for a second.", "আশা এক সেকেন্ড পরিষ্কার দেখতে পেলে গোনা শুরু করা যাবে।")}</p>}
                </Panel>
              )}

              {(s.state === "EXERCISE" || s.state === "TRACKING_LOST") && ex && step && (
                <Panel title={title(ex, lang)} description={lesson ? pick(lesson.keyTip, lang) : undefined} action={step.clinicianLocked ? <StatusPill tone="brand">Clinician plan</StatusPill> : undefined}>
                  <div className="grid grid-cols-[auto_1fr] items-end gap-4">
                    <div>
                      <p className="text-sm text-muted">{tx(lang, "Set", "সেট")}</p>
                      <p className="text-2xl font-semibold tabular-nums text-ink">
                        {s.set} / {step.sets}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted">{timed ? tx(lang, "Hold", "ধরে রাখুন") : tx(lang, "Reps", "বার")}</p>
                      <p className="text-5xl font-semibold tabular-nums text-ink" data-testid="move-reps">
                        {timed ? `${Math.floor(s.holdMs / 1000)}s / ${Math.round(s.holdTarget / 1000)}s` : `${s.reps} / ${step.targetReps}`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-wash" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, progress) * 100)} aria-label={tx(lang, "Set progress", "সেটের অগ্রগতি")}>
                    <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.min(1, progress) * 100}%` }} />
                  </div>
                  {timed && s.cameraCounting && (
                    <p className="mt-2 text-sm text-muted">{s.holdRunning ? tx(lang, "Holding: the timer runs while the camera sees the position.", "ধরে আছেন: ক্যামেরা অবস্থান দেখলে সময় চলে।") : tx(lang, "The timer waits until the camera sees the position.", "ক্যামেরা অবস্থান না দেখা পর্যন্ত টাইমার অপেক্ষা করে।")}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {timed ? (
                      !s.cameraCounting && (
                        <Button disabled={s.holdRunning} onClick={() => act((cur) => cur.startHold())}>
                          {s.holdRunning ? tx(lang, "Holding…", "ধরে আছেন…") : tx(lang, "Start timer", "টাইমার শুরু")}
                        </Button>
                      )
                    ) : (
                      <Button className="min-w-32 text-lg" onClick={() => act((cur) => cur.manualRep())}>
                        {s.cameraCounting ? tx(lang, "+1 (camera missed one)", "+১ (ক্যামেরা মিস করেছে)") : tx(lang, "+1 rep", "+১ বার")}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => act((cur) => cur.finishSet())}>
                      {tx(lang, "Done with this set", "এই সেট শেষ")}
                    </Button>
                    <Button variant="ghost" onClick={openDemo}>
                      {tx(lang, "Show me again", "আবার দেখান")}
                    </Button>
                    {s.cameraCounting && (
                      <Button variant="ghost" onClick={() => act((cur) => cur.useManual())}>
                        {tx(lang, "Switch to manual", "নিজে গুনব")}
                      </Button>
                    )}
                  </div>
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer font-medium text-ink">{tx(lang, "Stop signs, easier option and limits", "থামার লক্ষণ, সহজ বিকল্প ও সীমা")}</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                      {lesson?.cautions.map((c) => <li key={c.en}>{pick(c, lang)}</li>)}
                      {(ex.stopCues as string[]).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                      {lesson && <li>{pick(lesson.easier, lang)}</li>}
                      <li>{ex.limitation}</li>
                    </ul>
                  </details>
                </Panel>
              )}

              {s.state === "REST" && (
                <Panel title={tx(lang, "Rest", "বিশ্রাম")}>
                  <p className="text-5xl font-semibold tabular-nums text-ink" data-testid="move-rest" aria-label={tx(lang, "Rest time left", "বিশ্রামের বাকি সময়")}>
                    {fmt(s.remainingMs)}
                  </p>
                  <p className="mt-2 text-sm text-muted">{s.restDone ? tx(lang, "Rest is over. Tap Next when you're ready, or rest a little longer.", "বিশ্রাম শেষ। প্রস্তুত হলে \"পরের\" চাপুন, বা আরেকটু বিশ্রাম নিন।") : tx(lang, "Breathe easily. Sip water if you need to.", "সহজভাবে শ্বাস নিন। দরকার হলে একটু পানি খান।")}</p>
                  {upNext && (
                    <div className="mt-3 rounded-xl bg-wash p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">{tx(lang, "Next up", "এরপর")}</p>
                      <p className="font-medium text-ink">
                        {title(EXERCISES[upNext.exerciseId], lang)}
                        {upNext.set > 1 ? ` · ${tx(lang, "set", "সেট")} ${upNext.set}` : ""}
                      </p>
                      <p className="text-sm text-muted">{pick(lessonOf(upNext.exerciseId).keyTip, lang)}</p>
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => act((cur) => cur.next())}>{s.restDone ? tx(lang, "Next", "পরের") : tx(lang, "Skip rest", "বিশ্রাম বাদ")}</Button>
                    <Button variant="secondary" onClick={() => act((cur) => cur.extendRest())}>
                      {tx(lang, "Rest 30 s longer", "আরও ৩০ সেকেন্ড বিশ্রাম")}
                    </Button>
                  </div>
                  <label className="mt-4 flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="size-5" checked={autoNext} onChange={(e) => moveStore.set({ autoNext: e.target.checked })} />
                    {tx(lang, "Go on automatically when rest ends", "বিশ্রাম শেষে নিজে থেকে এগোবে")}
                  </label>
                </Panel>
              )}
            </>
          )}

          {upNext && s.state !== "REST" && (
            <details className="rounded-2xl bg-white p-4 text-sm ring-1 ring-line" data-testid="move-next-up">
              <summary className="cursor-pointer font-medium text-ink">
                {tx(lang, "Next up", "এরপর")}: {title(EXERCISES[upNext.exerciseId], lang)}
                {upNext.set > 1 ? ` · ${tx(lang, "set", "সেট")} ${upNext.set}` : ""}
              </summary>
              <p className="mt-2 text-muted">{pick(lessonOf(upNext.exerciseId).keyTip, lang)}</p>
            </details>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="size-5" checked={haptics} onChange={(e) => moveStore.set({ haptics: e.target.checked })} />
            {tx(lang, "Vibrate on each count (phones that support it)", "প্রতি গোনায় কাঁপুন (যেসব ফোনে চলে)")}
          </label>
          <Link href={`${BASE}/plan`} className="block text-center text-sm text-muted underline">
            {tx(lang, "Leave this page (the workout pauses)", "পাতা ছাড়ুন (ব্যায়াম থামবে)")}
          </Link>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" data-testid="move-toolbar">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {paused ? (
            <Button onClick={() => act((cur) => cur.resume(performance.now()))}>{tx(lang, "Resume", "আবার শুরু")}</Button>
          ) : (
            <Button variant="secondary" onClick={() => act((cur) => cur.pause())}>
              {tx(lang, "Pause", "বিরতি")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => act((cur) => cur.stop())}>
            {tx(lang, "End", "শেষ করুন")}
          </Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={() => setUnwell(true)}>
            {tx(lang, "Stop for symptoms", "উপসর্গের জন্য থামুন")}
          </Button>
        </div>
      </div>

      <Dialog open={demoOpen && !!ex} onClose={closeDemo} title={tx(lang, "Demonstration", "প্রদর্শন")}>
        {ex && (
          <div className="p-4">
            <DemoPlayer exerciseId={ex.id} lang={lang} />
            {pausedForDemo && <p className="mt-3 text-sm text-muted">{tx(lang, "Counting is paused while you watch.", "দেখার সময় গোনা বন্ধ থাকে।")}</p>}
            <Button className="mt-3 w-full" onClick={closeDemo}>
              {tx(lang, "Back to the exercise", "ব্যায়ামে ফিরুন")}
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function VisibilityList({ view, lang }: { view: View | null; lang: Lang }) {
  if (!view) return <p className="mt-3 text-sm text-muted">{tx(lang, "Waiting for the camera…", "ক্যামেরার অপেক্ষা…")}</p>;
  const name = (n: string) => n.replace(/_/g, " ");
  return (
    <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2" data-testid="move-visibility">
      {view.points.map((p) => (
        <li key={p.name} className={cn("flex items-center gap-2", p.visible ? "text-emerald-700" : "text-amber-800")}>
          <span aria-hidden="true">{p.visible ? "✓" : "✕"}</span>
          <span>
            {name(p.name)}: {p.visible ? tx(lang, "seen", "দেখা যাচ্ছে") : p.inFrame ? tx(lang, "unclear", "অস্পষ্ট") : tx(lang, "out of view", "ছবির বাইরে")}
          </span>
        </li>
      ))}
      {view.points.length === 0 && <li className="text-amber-800">{view.hint ? pick(view.hint, lang) : tx(lang, "Nothing seen yet", "এখনো কিছু দেখা যায়নি")}</li>}
      <li className={cn("flex items-center gap-2", view.lighting === "ok" || view.lighting === null ? "text-emerald-700" : "text-amber-800")}>
        <span aria-hidden="true">{view.lighting === "ok" || view.lighting === null ? "✓" : "✕"}</span>
        <span>
          {tx(lang, "Light", "আলো")}: {view.lighting === "dark" ? tx(lang, "too dark", "খুব অন্ধকার") : view.lighting === "bright" ? tx(lang, "too bright behind you", "পেছনে খুব উজ্জ্বল") : view.lighting === "ok" ? tx(lang, "good", "ভালো") : tx(lang, "not measured", "মাপা হয়নি")}
        </span>
      </li>
    </ul>
  );
}

function AdvancedPanel({ lang, view, result, frame, showAll }: { lang: Lang; view: View | null; result: DetectorResult | null; frame: FrameLandmarks | null; showAll: boolean }) {
  const counts = view?.counts ?? { pose: 0, face: 0, hands: 0, total: 0 };
  const measured = result?.angle ?? result?.value;
  return (
    <details className="rounded-2xl bg-white p-4 text-sm ring-1 ring-line">
      <summary className="cursor-pointer font-medium text-ink">{tx(lang, "Advanced tracking details", "ট্র্যাকিংয়ের বিস্তারিত")}</summary>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-ink">
        <input type="checkbox" className="size-5" data-testid="move-show-all" checked={showAll} onChange={(e) => moveStore.set({ showAllLandmarks: e.target.checked })} />
        {tx(lang, "Show all detected landmarks", "শনাক্ত সব বিন্দু দেখান")}
      </label>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted">
        <dt>{tx(lang, "Landmarks now", "এখনকার বিন্দু")}</dt>
        <dd className="tabular-nums text-ink" data-testid="move-landmark-count">
          {counts.total} / {LANDMARK_MAX.total}
        </dd>
        <dt>{tx(lang, "Body · face · hands", "শরীর · মুখ · হাত")}</dt>
        <dd className="tabular-nums">
          {counts.pose}/{LANDMARK_MAX.pose} · {counts.face}/{LANDMARK_MAX.face} · {counts.hands}/{LANDMARK_MAX.hands}
        </dd>
        <dt>{tx(lang, "Models at full rate", "পূর্ণ গতিতে মডেল")}</dt>
        <dd>{frame?.models ? [frame.models.pose === "fast" && "body", frame.models.hands === "fast" && "hands", "face"].filter(Boolean).join(", ") : "—"}</dd>
        <dt>{tx(lang, "Model time per frame", "প্রতি ফ্রেমে মডেলের সময়")}</dt>
        <dd className="tabular-nums">{frame ? `${frame.processingMs} ms` : "—"}</dd>
        <dt>{tx(lang, "Measured value", "মাপা মান")}</dt>
        <dd className="tabular-nums">{Number.isFinite(measured) ? (measured as number).toFixed(2) : "—"}</dd>
        <dt>{tx(lang, "Side used", "যে পাশ ব্যবহার হয়েছে")}</dt>
        <dd>{result?.side ?? view?.side ?? "—"}</dd>
        <dt>{tx(lang, "Detector phase", "ডিটেক্টরের ধাপ")}</dt>
        <dd>{result?.phase ?? "—"}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted">{tx(lang, "Landmark visibility is not a measure of how well you did the exercise.", "বিন্দু দেখা যাওয়া মানে ব্যায়াম কতটা ভালো হয়েছে তার মাপ নয়।")}</p>
    </details>
  );
}

function SymptomPicker({ onPick, onClose, text, setText }: { onPick: (v: string) => void; onClose: () => void; text: string; setText: (v: string) => void }) {
  const lang = useMove((s) => s.language);
  return (
    <Panel className="mb-6 ring-2 ring-red-300" title={tx(lang, "What are you feeling?", "কেমন লাগছে?")} description="Choose one. ASHA's safety rules decide what happens next.">
      <div className="grid gap-2 sm:grid-cols-2">
        {SESSION_SYMPTOMS.map((x: { id: string; en: string; bn: string; action: string }) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onPick(x.id)}
            className={cn("min-h-12 rounded-2xl p-3 text-left font-medium ring-1", x.action === "emergency" ? "bg-red-50 text-red-900 ring-red-200 hover:bg-red-100" : "bg-white text-ink ring-line hover:bg-wash")}
          >
            {tx(lang, x.en, x.bn)}
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onPick(text);
        }}
      >
        <label className="sr-only" htmlFor="symptom-text">
          Describe it
        </label>
        <input id="symptom-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx(lang, "Or describe it (English or Bangla)", "অথবা লিখুন (বাংলা বা ইংরেজি)")} className="h-11 min-w-0 flex-1 rounded-xl px-3 ring-1 ring-line" />
        <Button type="submit" variant="secondary">
          {tx(lang, "Check", "যাচাই")}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tx(lang, "Close", "বন্ধ")}
        </Button>
      </form>
    </Panel>
  );
}
