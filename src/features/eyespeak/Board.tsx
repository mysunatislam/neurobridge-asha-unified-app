"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRequests } from "@/features/requests/RequestProvider";
import { speak } from "@/features/speech/speak";
import { cn } from "@/lib/cn";
import { LongBlink, tileBefore } from "./cursor-logic.js";
import { BOARDS, CONFIRM_TILES, DwellSelector, HALF_STEPS, TileTracker, isGroup, predictGaze, smoothPoint, stepAt, wordsIn } from "./gaze";
import type { BoardSize, GazeModel, Group, Step } from "./gaze";
import type { Feed } from "./Calibration";

type Rect = { id: string; x: number; y: number; w: number; h: number };
/** Eyes lost for longer than this (not a blink) clear the fill. */
const LOSS_MS = 600;
/** Below this many face results per second, say so on the board. */
const SLOW_FPS = 5;
/** A slow blink that starts this soon after the scanning light moves could be meant for either tile. */
const REACTION_MS = 250;
/** Scanning waits this long before the light starts, and again after each choice. */
const SCAN_PAUSE_MS = 1200;
/** Without a face for this long, scanning stops and says so. */
const NO_FACE_MS = 1500;
const NO_FACE = "Asha can’t see your eyes. Face the camera and the light carries on.";

export type BoardMode = "gaze" | "scan";

/**
 * Full screen tiles chosen with the eyes.
 *
 * Gaze: a tile is chosen after the smoothed gaze point stays on it for the selection time (brief
 * jitter, blinks and slow frames pause rather than restart it), or at once with a slow blink (eyes
 * closed for 0.7 s or more; natural blinks don't count). With accuracy for only two halves of
 * the screen, the halves open in steps until a word is reached, and closing the eyes for two seconds
 * goes back a step.
 *
 * Scan: needs no calibration. A light moves from tile to tile and a slow blink chooses the lit one.
 *
 * Touch works on every tile in both. Needs (water, toilet…) go through the same confirmation as
 * everywhere in Asha, answered here with two halves of the screen.
 */
export function Board({
  size,
  mode = "gaze",
  model,
  dwellMs,
  showDot,
  feed,
  onExit,
}: {
  size: Exclude<BoardSize, 0>;
  mode?: BoardMode;
  model: GazeModel | null;
  dwellMs: number;
  showDot: boolean;
  feed: Feed;
  onExit: () => void;
}) {
  const { pending, propose, confirm, cancel, delivery } = useRequests();
  const confirming = !!pending && pending.source === "eyespeak";
  const scan = mode === "scan";
  const steps = !scan && size === 2;
  const board = BOARDS[scan ? 9 : size];
  const [path, setPath] = useState<string[]>([]);
  const tiles: Step[] = useMemo(() => (confirming ? CONFIRM_TILES : steps ? stepAt(path).options : board.tiles), [confirming, steps, path, board]);
  const cols = confirming || steps ? 2 : board.cols;
  const crumbs = useMemo(() => {
    const out: string[] = [];
    let node: Group = HALF_STEPS;
    for (const id of path) {
      const next = node.options.find((o) => o.id === id);
      if (!next || !isGroup(next)) break;
      out.push(next.label);
      node = next;
    }
    return out;
  }, [path]);
  const grid = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const rects = useRef<Rect[]>([]);
  const nodes = useRef(new Map<string, HTMLElement>());
  // Slow devices deliver a face result every few hundred milliseconds; a late one must not restart the fill.
  const dwell = useMemo(() => new DwellSelector({ dwellMs, maxGapMs: 900 }), [dwellMs]);
  // Each tile stays lit a little longer than the selection time, enough to see it and blink slowly.
  const stepMs = dwellMs + 600;
  const smooth = useRef<{ x: number; y: number; t: number } | null>(null);
  // One blink detector for the whole board: it learns what this person's open eyes look like, and a
  // new layout must not make it start learning again (a closure in that moment would count as open).
  const blinkRef = useRef<LongBlink | null>(null);
  const [status, setStatus] = useState("");
  const [lit, setLit] = useState(-1);
  const [said, setSaid] = useState<string[]>([]);
  // The note shows whatever happened last: a word spoken after a request replaces its delivery note.
  const [saidOver, setSaidOver] = useState<typeof delivery | null>(null);

  const back = useCallback(() => setPath((p) => (p.length ? p.slice(0, -1) : p)), []);
  const choose = useCallback(
    (step: Step) => {
      if (isGroup(step)) return setPath((p) => [...p, step.id]);
      setPath((p) => (p.length ? [] : p));
      if (step.id === "confirm-yes") return void confirm();
      if (step.id === "confirm-no") return cancel();
      setSaid((s) => [step.label, ...s].slice(0, 6));
      if (step.need) propose(step.need, step.say, "eyespeak");
      else {
        setSaidOver(delivery);
        speak(step.say);
      }
    },
    [confirm, cancel, propose, delivery],
  );
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });

  // Tile positions as fractions of the screen, the same frame the calibration used.
  useLayoutEffect(() => {
    const measure = () => {
      const W = innerWidth, H = innerHeight;
      rects.current = [...nodes.current.entries()].map(([id, el]) => {
        const r = el.getBoundingClientRect();
        return { id, x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H };
      });
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [tiles]);

  useEffect(() => {
    dwell.reset();
    const tracker = new TileTracker();
    // A new layout appears under a still gaze (after "Water" the left half is "No"). The tile under
    // where the eyes were when it changed is ignored until they move off it, so nothing is chosen
    // without a deliberate look. (Tile positions are already measured: layout effects run first.)
    const was = smooth.current;
    dwell.hold(was ? (rects.current.find((r) => was.x >= r.x && was.x <= r.x + r.w && was.y >= r.y && was.y <= r.y + r.h)?.id ?? null) : null);
    let lostSince: number | null = null;
    let lastT: number | null = null;
    const blink = (blinkRef.current ??= new LongBlink());
    // Where the eyes were, moment by moment, so a slow blink chooses the tile they had settled on.
    const trail: { t: number; x: number; y: number }[] = [];
    const steady = Math.min(0.14, Math.max(0.06, (model?.validation?.p90Error ?? 0.1) * 0.8));
    let rate = 0;
    // A short message that outlasts the per-frame status for a few seconds.
    let hint: { text: string; until: number } | null = null;

    // Scanning: which tile was lit from when, on the camera's clock (performance.now), so a blink is
    // matched to the tile that was lit when the eyes began to close, not when the closure was seen.
    const start = performance.now();
    const lights: { i: number; at: number }[] = [{ i: 0, at: start + SCAN_PAUSE_MS }];
    let seenAt = start;
    let paused = 0;
    let lastTick = start;

    const paint = (id: string | null, progress: number) => {
      for (const [key, el] of nodes.current) el.style.setProperty("--dwell", key === id ? String(progress) : "0");
    };
    const lose = (t: number, reason: string) => {
      // A blink or a frame or two without irises pauses the fill; only a longer loss clears it.
      lostSince ??= t;
      if (t - lostSince < LOSS_MS || blink.closing) return;
      dwell.update(null, t, false);
      tracker.reset();
      smooth.current = null;
      paint(null, 0);
      if (dot.current) dot.current.style.opacity = "0";
      setStatus(reason);
    };
    const pick = (id: string, via: "blink" | "dwell" | "scan") => {
      if (root.current) root.current.dataset.chosenBy = via;
      dwell.hold(id);
      paint(null, 0);
      if (scan) {
        // Start again from the first tile after a pause, so the next choice begins from a known place.
        lights.push({ i: 0, at: performance.now() + SCAN_PAUSE_MS });
        paused = 0;
        setLit(-1);
      }
      const tile = tiles.find((x) => x.id === id);
      if (tile) chooseRef.current(tile);
    };

    const timer = scan
      ? setInterval(() => {
          const now = performance.now();
          const dt = now - lastTick;
          lastTick = now;
          const cur = lights[lights.length - 1];
          const asking = !!document.querySelector("dialog[open]");
          const away = now - seenAt > NO_FACE_MS;
          setStatus(asking ? "Answer the question on screen first." : away ? NO_FACE : hint && now < hint.until ? hint.text : "");
          if (now < cur.at) return setLit(-1);
          setLit(cur.i);
          // The light waits while the eyes are closing (it may be a choice), while the face is away
          // and while another question is open.
          if (blink.closing || away || asking) {
            paused += dt;
            return;
          }
          if (now - cur.at - paused < stepMs) return;
          paused = 0;
          lights.push({ i: (cur.i + 1) % tiles.length, at: now });
          if (lights.length > 8) lights.shift();
        }, 50)
      : null;

    feed((f, t, open) => {
      if (lastT !== null && t > lastT) rate = rate ? rate * 0.9 + (1000 / (t - lastT)) * 0.1 : 1000 / (t - lastT);
      lastT = t;
      if (open !== null) seenAt = t;
      if (document.querySelector("dialog[open]")) {
        if (!scan) setStatus("Answer the question on screen first.");
        return;
      }
      const b = blink.update(open, t);
      if (scan) {
        if (b?.kind !== "click") return;
        const at = [...lights].reverse().find((l) => l.at <= b.closedAt);
        if (!at) return; // during the pause after a choice
        if (b.closedAt - at.at >= REACTION_MS) return pick(tiles[at.i].id, "scan");
        hint = { text: "That blink began just as the light moved, so nothing was chosen. Blink while your tile is lit.", until: t + 3000 };
        return;
      }
      if (b?.kind === "click") {
        const id = tileBefore(trail, rects.current, b.closedAt, { radius: steady });
        if (id) return pick(id, "blink");
        hint = { text: "Your eyes were still moving. Rest them on a tile for a moment, then blink slowly.", until: t + 3000 };
      }
      // Closing the eyes for about two seconds goes back a step.
      if (b?.kind === "long" && steps) back();
      if (!model) return;
      if (!f.valid) return lose(t, f.reason);
      const p = predictGaze(model, f.values, { requireValidation: false }) as { valid: boolean; x?: number; y?: number; reason?: string };
      if (!p.valid || p.x === undefined || p.y === undefined) return lose(t, p.reason ?? "");
      lostSince = null;
      const s = (smooth.current = smoothPoint(smooth.current, { x: p.x, y: p.y }, t));
      if (dot.current) {
        dot.current.style.opacity = "1";
        dot.current.style.transform = `translate(${s.x * innerWidth}px, ${s.y * innerHeight}px)`;
      }
      setStatus(hint && t < hint.until ? hint.text : rate && rate < SLOW_FPS ? `Tracking is slow on this device (${Math.round(rate)} per second), so hold your gaze a little longer. Closing other apps helps.` : "");
      const over = tracker.update(s, rects.current, t);
      trail.push(s);
      while (trail.length && trail[0].t < t - 2500) trail.shift();
      const chosen = dwell.update(over, t, true);
      paint((dwell.target as string | null) ?? null, dwell.progress ?? 0);
      if (chosen) pick(chosen as string, "dwell");
    });
    return () => {
      feed(null);
      if (timer) clearInterval(timer);
    };
  }, [feed, model, dwell, tiles, scan, steps, stepMs, back]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onExit]);

  const startNote = scan
    ? "A light moves from tile to tile. Blink slowly when it reaches the word you want."
    : steps
      ? "Look at a half and hold your gaze, or blink slowly. Each half opens two more until you reach your word."
      : "Look at a tile and hold your gaze until it fills, or blink slowly.";
  const saidNote = said.length ? `Said: ${said.join(" · ")}` : startNote;
  const deliveryNote: Partial<Record<typeof delivery.state, string>> = {
    sending: "Sending to your caregiver…",
    sent: "Sent to your caregiver.",
    local: "Recognised on this device. Connect a caregiver to deliver requests.",
    failed: "Not sent. Check the connection, or use touch.",
  };
  const note = confirming
    ? `Send to your caregiver: “${pending!.text}”?${scan ? " Blink slowly when your answer is lit." : ""}`
    : crumbs.length
      ? `${crumbs.join(" › ")}. Close your eyes for 2 seconds to go back.`
      : (delivery !== saidOver && deliveryNote[delivery.state]) || saidNote;

  return (
    <div
      ref={root}
      className="fixed inset-0 z-[60] flex flex-col bg-wash"
      role="dialog"
      aria-modal="true"
      aria-label={scan ? "Blink to choose" : "Look to choose"}
      data-testid="gaze-board"
      data-mode={mode}
      data-size={confirming ? 2 : steps ? "steps" : scan ? 9 : size}
    >
      <div className="flex min-h-12 items-center gap-3 px-4 pt-2 text-sm">
        <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-ink" data-testid="board-note">
          {note}
        </p>
        {steps && !confirming && path.length > 0 && (
          <button onClick={back} className="shrink-0 rounded-full px-4 py-2 font-medium text-ink ring-1 ring-line hover:bg-white" data-testid="board-back">
            Back
          </button>
        )}
        <button onClick={onExit} className="shrink-0 rounded-full px-4 py-2 font-medium text-muted ring-1 ring-line hover:bg-white">
          Close
        </button>
      </div>
      {status && (
        <p className="px-4 pt-1 text-sm text-amber-800" data-testid="board-status">
          {status}
        </p>
      )}
      <div ref={grid} className="grid flex-1 gap-[3vmin] p-[3vmin]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tiles.map((t, i) => {
          const yes = t.id === "confirm-yes";
          const on = scan && i === lit;
          const words = isGroup(t) ? wordsIn(t) : [];
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) nodes.current.set(t.id, el);
                else nodes.current.delete(t.id);
              }}
              data-tile={t.id}
              data-group={isGroup(t) || undefined}
              data-scan={on || undefined}
              onClick={() => choose(t)}
              className={cn(
                "relative grid place-items-center overflow-hidden rounded-3xl text-center transition-[box-shadow,opacity] duration-150",
                yes ? "bg-brand text-white" : "bg-white text-ink",
                on ? (yes ? "ring-[6px] ring-ink" : "ring-[6px] ring-brand") : yes ? "ring-1 ring-brand" : "ring-1 ring-line",
                scan && !on && "opacity-55",
              )}
              style={{ ["--dwell" as string]: "0" }}
            >
              <span aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 origin-bottom transition-transform duration-100", yes ? "bg-white/30" : "bg-brand/20")} style={{ height: "100%", transform: "scaleY(var(--dwell))" }} />
              <span className="relative px-[2vmin]">
                <span className="block text-[clamp(1.5rem,5vmin,3.5rem)] leading-tight font-semibold">{t.label}</span>
                <span className={cn("mt-1 block text-[clamp(1rem,3vmin,1.75rem)]", yes ? "text-white/80" : "text-muted")}>{t.bn}</span>
                {words.length > 3 && <span className="mt-2 block text-[clamp(0.875rem,2.4vmin,1.25rem)] text-muted">{words.join(" · ")}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {showDot && !scan && (
        <div ref={dot} data-testid="gaze-dot" aria-hidden="true" className="pointer-events-none fixed top-0 left-0 z-[61] -mt-4 -ml-4 size-8 rounded-full border-4 border-brand/70 bg-brand/15 opacity-0 ring-2 ring-white transition-opacity" />
      )}
    </div>
  );
}
