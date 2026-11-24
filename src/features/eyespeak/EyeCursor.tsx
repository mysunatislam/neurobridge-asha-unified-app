"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePerception, usePerceptionEvent } from "@/features/perception/PerceptionProvider";
import type { FrameLandmarks } from "@/lib/engine/types";
import { CursorPicker } from "./CursorPicker";
import { Fixation, LongBlink, eyeOpenness, nearTargets, pointBefore } from "./cursor-logic.js";
import { boardFor, extractGazeFeatures, predictGaze, smoothPoint } from "./gaze";
import type { Features } from "./gaze";
import { eyeSpeakStore, useEyeSpeak } from "./store";
import { collectTargets, labelOf, press } from "./targets";
import type { Target } from "./targets";

/** Eyes lost for longer than this (not a blink) hide the pointer. */
const LOSS_MS = 600;
const OUTLINES = 8;
const NOTE_MS = 3500;

const howToClick = (click: "blink" | "dwell" | "both") => (click === "blink" ? "blink slowly" : click === "dwell" ? "hold your look" : "blink slowly or hold your look");

/**
 * The eyes as a mouse on every patient page. A ring shows where the calibrated gaze lands; the
 * buttons within this person's measured accuracy of it are outlined. A slow blink (or a held look,
 * if chosen) clicks: one button in reach is clicked, several open big tiles to pick from, because a
 * webcam can't tell close buttons apart. A bar at the bottom scrolls, pauses and turns it off, by
 * eye or by touch. It needs a calibration good enough for 6 or 9 tiles, checked this visit.
 */
export function EyeCursor() {
  const es = useEyeSpeak();
  const { state: camera, instance } = usePerception();
  const size = boardFor(es.checked ? es.model?.validation ?? null : null);
  const ready = es.cursor && camera === "on" && !!es.model && (size === 9 || size === 6);
  const active = ready && !es.inUse;
  const byBlink = es.cursorClick !== "dwell", byDwell = es.cursorClick !== "blink";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const [lost, setLost] = useState("");
  const [picker, setPicker] = useState<{ choices: Target[]; from: { x: number; y: number } } | null>(null);
  const [scroll, setScroll] = useState({ up: false, down: false });
  const frame = useRef<((f: FrameLandmarks) => void) | null>(null);
  const pickerFeed = useRef<((f: FrameLandmarks) => void) | null>(null);
  const holdNext = useRef<() => void>(() => {});
  const layer = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const flash = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string) => setNote({ text, at: Date.now() }), []);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // Everything the cursor draws lives in one holder that moves into an open dialog, because a
  // modal dialog sits above the whole page and makes the rest of it unclickable.
  useEffect(() => {
    if (!es.cursor) return;
    const el = document.createElement("div");
    el.dataset.eyeCursorRoot = "";
    const place = () => {
      const into = document.querySelector("dialog[open]") ?? document.body;
      if (el.parentElement !== into) into.append(el);
    };
    place();
    const watch = new MutationObserver(place);
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    document.documentElement.dataset.eyeCursor = "on";
    setHost(el);
    return () => {
      watch.disconnect();
      el.remove();
      delete document.documentElement.dataset.eyeCursor;
      setHost(null);
    };
  }, [es.cursor]);

  // Face points on every page, and only the face model where hands and body aren't needed.
  useEffect(() => {
    const p = instance();
    if (!p || camera !== "on" || !active) return;
    p.setGazeCursor?.(true);
    return () => p.setGazeCursor?.(false);
  }, [active, camera, instance]);

  useEffect(() => {
    if (!es.cursor) return;
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setScroll({ up: scrollY > 2, down: scrollY < max - 2 });
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    const timer = setInterval(update, 1000);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
      clearInterval(timer);
    };
  }, [es.cursor]);

  const closePicker = useCallback(
    (target: Target | null) => {
      setPicker(null);
      eyeSpeakStore.set({ picking: false });
      holdNext.current();
      if (target) {
        requestAnimationFrame(() => {
          // If the page redrew that button meanwhile, click the same button where it is now.
          const el = target.el.isConnected
            ? target.el
            : collectTargets()
                .filter((t) => labelOf(t.el) === target.label)
                .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0]?.el;
          if (el) {
            press(el);
            say(`Clicked “${target.label}”.`);
          } else say(`“${target.label}” is no longer on the screen, so nothing was clicked.`);
        });
      } else say("Cancelled. Nothing was clicked.");
    },
    [say],
  );
  const registerPicker = useCallback((fn: ((f: FrameLandmarks) => void) | null) => {
    pickerFeed.current = fn;
  }, []);

  useEffect(() => {
    const model = es.model;
    const p90 = model?.validation?.p90Error;
    if (!active || !model || p90 === undefined) return;
    // Where the eyes may really be looking, at this person's accuracy (9 in 10 looks are within it).
    const reach = Math.max(0.035, p90);
    const steady = Math.min(0.14, Math.max(0.06, p90 * 0.8));
    const fix = new Fixation({ dwellMs: es.dwellMs, radius: steady, graceMs: 400 });
    const blink = new LongBlink();
    const paused = es.cursorPaused;
    let smooth: { x: number; y: number; t: number } | null = null;
    const trail: { x: number; y: number; t: number }[] = [];
    let lostSince: number | null = null;
    let targets: Target[] = [];
    let targetsAt = -Infinity;
    holdNext.current = () => fix.hold();

    const pool = () => {
      const now = performance.now();
      if (now - targetsAt > 300) {
        targets = collectTargets();
        targetsAt = now;
      }
      return paused ? targets.filter((x) => x.el.hasAttribute("data-gaze-resume")) : targets;
    };
    const showRing = (s: { x: number; y: number } | null, progress = 0) => {
      if (!ring.current) return;
      ring.current.style.opacity = s ? (paused ? "0.45" : "1") : "0";
      if (s) ring.current.style.transform = `translate(${s.x * innerWidth}px, ${s.y * innerHeight}px)`;
      arc.current?.setAttribute("stroke-dashoffset", String(100 - progress * 100));
    };
    const outline = (list: Target[]) => {
      boxes.current.forEach((box, i) => {
        const t = list[i];
        if (!box) return;
        box.style.display = t ? "block" : "none";
        if (t) Object.assign(box.style, { left: `${t.x * innerWidth - 4}px`, top: `${t.y * innerHeight - 4}px`, width: `${t.w * innerWidth + 8}px`, height: `${t.h * innerHeight + 8}px` });
      });
      if (layer.current) layer.current.dataset.near = String(list.length);
    };
    const click = (t: Target) => {
      fix.hold();
      if (flash.current) {
        Object.assign(flash.current.style, { left: `${t.x * innerWidth - 6}px`, top: `${t.y * innerHeight - 6}px`, width: `${t.w * innerWidth + 12}px`, height: `${t.h * innerHeight + 12}px` });
        flash.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
      }
      press(t.el);
      say(`Clicked “${t.label}”.`);
    };
    let picking = false;
    /** Click what the eyes are on, or ask which one. True when the picker opened. */
    const act = (point: { x: number; y: number }, via: "blink" | "dwell") => {
      const near = (nearTargets(pool(), point, reach) as Target[]).map((t) => ({ ...t, label: labelOf(t.el) }));
      if (!near.length) {
        if (via === "blink") say("Nothing to click there.");
        return false;
      }
      if (near.length === 1) {
        click(near[0]);
        return false;
      }
      fix.hold();
      outline([]);
      showRing(null);
      picking = true;
      eyeSpeakStore.set({ picking: true });
      setPicker({ choices: near.slice(0, size - 1), from: point });
      return true;
    };
    const lose = (t: number, reason: string) => {
      lostSince ??= t;
      // A blink, even a slow one, keeps the pointer where it was.
      if (t - lostSince < LOSS_MS || blink.closing) return;
      smooth = null;
      fix.reset();
      showRing(null);
      outline([]);
      setLost(reason);
    };

    frame.current = (f) => {
      if (pickerFeed.current) return pickerFeed.current(f);
      if (picking) {
        // The picker is opening; its own pointer takes over once it is on screen.
        if (!eyeSpeakStore.get().picking) picking = false;
        else return;
      }
      const t = f.faceAt ?? f.timestampMs;
      const b = blink.update(eyeOpenness(f.face, f.videoSize.width, f.videoSize.height), t);
      if (b && byBlink) {
        if (b.kind === "click") {
          const at = pointBefore(trail, b.closedAt, { radius: steady });
          if (at && act(at, "blink")) return;
          else say("Your eyes were still moving, so nothing was clicked. Rest them on the button for a moment, then blink slowly.");
        } else if (b.kind === "short" && b.ms >= 500) say("That blink was short, so nothing was clicked. Close your eyes for about a second to click.");
      }
      const feat = extractGazeFeatures(f.face, f.videoSize.width, f.videoSize.height) as Features;
      if (!feat.valid) return lose(t, feat.reason);
      const p = predictGaze(model, feat.values, { requireValidation: false }) as { valid: boolean; x?: number; y?: number; reason?: string };
      if (!p.valid || p.x === undefined || p.y === undefined) return lose(t, p.reason ?? "");
      if (lostSince !== null) setLost("");
      lostSince = null;
      smooth = smoothPoint(smooth, { x: p.x, y: p.y }, t);
      trail.push(smooth);
      while (trail.length && trail[0].t < t - 2000) trail.shift();
      const list = pool();
      const fired = fix.update(smooth, t, byDwell && nearTargets(list, fix.point ?? smooth, reach).length > 0);
      outline(nearTargets(list, fix.point ?? smooth, reach).slice(0, OUTLINES) as Target[]);
      showRing(smooth, byDwell ? fix.progress : 0);
      if (fired && fix.point) act(fix.point, "dwell");
    };
    return () => {
      frame.current = null;
      showRing(null);
      outline([]);
    };
  }, [active, es.model, es.dwellMs, es.cursorPaused, byBlink, byDwell, size, say]);

  usePerceptionEvent<FrameLandmarks>("landmarks", (f) => frame.current?.(f), active);

  // Leaving the picker open without the cursor would strand it.
  useEffect(() => {
    if (!active && picker) closePicker(null);
  }, [active, picker, closePicker]);
  useEffect(() => () => eyeSpeakStore.set({ picking: false }), []);

  if (!es.cursor || !host) return null;
  const how = howToClick(es.cursorClick);
  const screenChanged = !!es.screen && (Math.abs(es.screen.w - innerWidth) > innerWidth * 0.1 || Math.abs(es.screen.h - innerHeight) > innerHeight * 0.1);
  const status = !ready
    ? camera !== "on"
      ? "Eye cursor is waiting for the camera."
      : !es.model || !es.checked
        ? "Eye cursor needs a calibration or a 3-dot check on the EyeSpeak page."
        : "Eye cursor needs a calibration accurate enough for 6 or 9 tiles."
    : note
      ? note.text
      : es.cursorPaused
        ? `Paused. Look at Resume and ${how} to carry on.`
        : lost
          ? lost
          : screenChanged
            ? "The window size changed since calibrating, so the pointer may be off. Calibrate again on the EyeSpeak page."
            : `Look at a button and ${how} to click.`;
  const bar = "h-11 rounded-xl px-4 text-sm font-medium ring-1 ring-line disabled:cursor-not-allowed disabled:opacity-40";

  return createPortal(
    <>
      {active && (
        <div ref={layer} data-gaze-ignore aria-hidden="true" className={`pointer-events-none fixed inset-0 z-[67] ${picker ? "hidden" : ""}`} data-testid="eye-cursor-layer">
          {Array.from({ length: OUTLINES }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              className={`fixed hidden rounded-xl ${i === 0 ? "border-[3px] border-brand" : "border-2 border-dashed border-brand/60"}`}
            />
          ))}
          <div ref={flash} className="fixed rounded-2xl bg-brand/25 opacity-0 ring-4 ring-brand" />
          <div ref={ring} data-testid="eye-cursor" className="fixed top-0 left-0 -mt-5 -ml-5 size-10 opacity-0">
            <svg viewBox="0 0 40 40" className="size-10 -rotate-90 drop-shadow">
              <circle cx="20" cy="20" r="15" pathLength="100" className="fill-brand/15 stroke-white" strokeWidth="7" />
              <circle cx="20" cy="20" r="15" pathLength="100" className="fill-none stroke-brand/70" strokeWidth="4" />
              <circle ref={arc} cx="20" cy="20" r="15" pathLength="100" strokeDasharray="100" strokeDashoffset="100" className="fill-none stroke-brand" strokeWidth="4" />
            </svg>
          </div>
        </div>
      )}
      {!es.inUse && (
        <div role="region" aria-label="Eye cursor" data-testid="cursor-bar" className="fixed inset-x-3 bottom-3 z-[65] mx-auto flex max-w-max flex-wrap items-center justify-center gap-2 rounded-2xl bg-white p-2 shadow-float ring-1 ring-line">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 basis-56 px-2 text-sm text-ink" data-testid="cursor-note">
            {status}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className={bar} disabled={!ready || es.cursorPaused || !scroll.up} onClick={() => scrollBy({ top: -Math.round(innerHeight * 0.6), behavior: "smooth" })}>
              Scroll up
            </button>
            <button className={bar} disabled={!ready || es.cursorPaused || !scroll.down} onClick={() => scrollBy({ top: Math.round(innerHeight * 0.6), behavior: "smooth" })}>
              Scroll down
            </button>
            {es.cursorPaused ? (
              <button className={`${bar} bg-brand text-white ring-brand`} data-gaze-resume onClick={() => eyeSpeakStore.set({ cursorPaused: false })}>
                Resume
              </button>
            ) : (
              <button className={bar} disabled={!ready} onClick={() => eyeSpeakStore.set({ cursorPaused: true })}>
                Pause
              </button>
            )}
            <button className={bar} onClick={() => eyeSpeakStore.set({ cursor: false, cursorPaused: false })}>
              Turn off
            </button>
          </div>
        </div>
      )}
      {picker && es.model && (
        <CursorPicker choices={picker.choices} from={picker.from} model={es.model} dwellMs={es.dwellMs} byBlink={byBlink} byDwell={byDwell} register={registerPicker} onPick={closePicker} />
      )}
    </>,
    host,
  );
}
