"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { useMove } from "@/features/move/store";
import { useNutrition } from "@/features/nutrition/store";
import { assessRisk, RULES_VERSION, SOURCES, THRESHOLDS } from "@/features/risk/engine.js";
import { loadEnvironment, locate, PLACES, type Environment } from "@/features/risk/environment";
import { riskStore, sampleSignals, useRisk } from "@/features/risk/store";
import { cn } from "@/lib/cn";

type Level = "act" | "watch" | "info";
type Alert = {
  id: string;
  level: Level;
  title: string;
  summary: string;
  because: { text: string; source: string }[];
  actions: string[];
  sources: string[];
  ask?: string;
};
type Step = { id: string; time: string; text: string; because: string };

const LEVEL: Record<Level, { label: string; dot: string; text: string }> = {
  act: { label: "Act now", dot: "bg-danger", text: "text-danger" },
  watch: { label: "Watch", dot: "bg-amber-500", text: "text-amber-700" },
  info: { label: "For today", dot: "bg-line", text: "text-muted" },
};

const today = () => new Date().toLocaleDateString("en-CA");
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const r = (n: number | null | undefined) => (n == null ? "—" : Math.round(n));

function aqiWord(aqi: number | null) {
  if (aqi == null) return "";
  return aqi <= 50 ? "good" : aqi <= 100 ? "moderate" : aqi <= 150 ? "unhealthy for sensitive groups" : aqi <= 200 ? "unhealthy" : "very unhealthy";
}

export default function OutlookPage() {
  const risk = useRisk();
  const movePlan = useMove((m) => m.plan);
  const moveHistory = useMove((m) => m.history);
  const moveLockout = useMove((m) => m.lockout);
  const meals = useNutrition((n) => n.log);
  const [env, setEnv] = useState<Environment | null>(null);
  const [envError, setEnvError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const place = risk.place ?? PLACES[0];

  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      setEnvError("");
      try {
        setEnv(await loadEnvironment(place, force));
      } catch {
        setEnvError("Weather and air quality could not be loaded. Alerts below use your signals only.");
      } finally {
        setLoading(false);
        setNow(Date.now());
      }
    },
    [place],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const result = useMemo(
    () =>
      assessRisk({
        now,
        env,
        vitals: risk.vitals,
        stretch: risk.stretch,
        requests: risk.requests,
        move: { plan: movePlan, history: moveHistory, lockout: moveLockout },
        meals,
      }) as { alerts: Alert[]; plan: Step[]; summary: ReturnType<typeof assessRisk>["summary"] },
    [now, env, risk.vitals, risk.stretch, risk.requests, movePlan, moveHistory, moveLockout, meals],
  );
  const s = result.summary;
  const done = risk.done[today()] ?? [];
  const toggle = (id: string) =>
    riskStore.set((st) => {
      const list = st.done[today()] ?? [];
      return { done: { [today()]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } };
    });

  async function useMyLocation() {
    try {
      riskStore.set({ place: await locate() });
    } catch (e) {
      setEnvError((e as Error).message);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Health outlook"
        description="Alerts that combine your own signals with today's heat, humidity and air quality, and a plan to prevent problems. Decision support, not a diagnosis."
      />

      {/* Environment */}
      <section className="mb-8" aria-labelledby="env-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="env-heading" className="text-sm font-medium text-muted">
            Today in {place.name}
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="sr-only" htmlFor="place">
              Place
            </label>
            <select
              id="place"
              value={PLACES.some((p) => p.name === place.name) ? place.name : ""}
              onChange={(e) => {
                const p = PLACES.find((x) => x.name === e.target.value);
                if (p) riskStore.set({ place: p });
              }}
              className="h-9 rounded-lg border border-line bg-white px-2 text-ink"
            >
              {!PLACES.some((p) => p.name === place.name) && <option value="">{place.name}</option>}
              {PLACES.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
            <button onClick={useMyLocation} className="font-medium text-brand hover:underline">
              Use my location
            </button>
          </div>
        </div>
        <p className="mt-2 text-lg text-ink" data-testid="env-line">
          {env ? (
            <>
              Feels like {r(env.current.feels)}°C · humidity {r(env.current.humidity)}% · air quality {r(env.current.aqi)}
              {env.current.aqi != null && <span className="text-muted"> ({aqiWord(env.current.aqi)})</span>} · UV {r(env.current.uv)}
            </>
          ) : loading ? (
            <span className="text-muted">Loading weather and air quality…</span>
          ) : (
            <span className="text-muted">No weather data.</span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          {env ? `Updated ${time(env.fetchedAt)} from Open-Meteo. Only the place is sent, never health data. ` : ""}
          {envError}
          {env && (
            <button onClick={() => refresh(true)} className="ml-1 font-medium text-brand hover:underline">
              Refresh
            </button>
          )}
        </p>
      </section>

      {risk.sample && (
        <p className="mb-6 rounded-xl bg-wash px-4 py-3 text-sm text-ink" role="status">
          Showing sample signals so you can see how alerts work. They are not your readings.{" "}
          <button onClick={() => riskStore.clear()} className="font-medium text-brand hover:underline">
            Remove sample
          </button>
        </p>
      )}

      {/* Alerts */}
      <h2 className="mb-3 text-base font-semibold text-ink">Alerts</h2>
      {result.alerts.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line" data-testid="alerts">
          {result.alerts.map((a) => (
            <li key={a.id} data-level={a.level} data-alert={a.id}>
              <details className="group" open={a.level === "act"}>
                <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 hover:bg-wash focus-visible:bg-wash focus-visible:outline-none">
                  <span className={cn("mt-2 size-2 shrink-0 rounded-full", LEVEL[a.level].dot)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-ink">{a.title}</span>
                      <span className={cn("text-xs font-medium", LEVEL[a.level].text)}>{LEVEL[a.level].label}</span>
                    </span>
                    <span className="block text-sm text-muted">{a.summary}</span>
                  </span>
                  <span className="mt-1 text-xs text-muted group-open:hidden">Why</span>
                </summary>
                <div className="space-y-4 px-5 pb-5 pl-10 text-sm">
                  <div>
                    <h3 className="font-medium text-ink">Why you see this</h3>
                    <ul className="mt-1 space-y-1.5">
                      {a.because.map((b, i) => (
                        <li key={i} className="text-ink">
                          {b.text} <span className="block text-xs text-muted">Source: {b.source}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium text-ink">What you can do</h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-ink">
                      {a.actions.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  {a.ask && (
                    <Link href={`/dashboard/patient/assistant?q=${encodeURIComponent(a.ask)}`} className="inline-block font-medium text-brand hover:underline">
                      Ask Asha about this
                    </Link>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-white px-5 py-4 text-sm text-muted ring-1 ring-line">No alerts right now. Alerts appear here when your signals, the weather or the air call for care.</p>
      )}

      {/* Plan */}
      <h2 className="mt-10 mb-3 text-base font-semibold text-ink">Prevention plan for today</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line" data-testid="plan">
        {result.plan.map((p) => (
          <li key={p.id} className="flex items-start gap-3 px-5 py-3.5">
            <input
              id={`plan-${p.id}`}
              type="checkbox"
              checked={done.includes(p.id)}
              onChange={() => toggle(p.id)}
              className="mt-1 size-4 accent-[var(--color-brand)]"
            />
            <label htmlFor={`plan-${p.id}`} className="min-w-0 flex-1">
              <span className="flex flex-wrap gap-x-3">
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums text-ink">{p.time}</span>
                <span className={cn("flex-1 text-ink", done.includes(p.id) && "text-muted line-through")}>{p.text}</span>
              </span>
              <span className="block pl-0 text-xs text-muted sm:pl-[6.75rem]">{p.because}</span>
            </label>
          </li>
        ))}
      </ol>

      {/* Signals */}
      <h2 className="mt-10 mb-3 text-base font-semibold text-ink">Signals used</h2>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-line">
        {[
          ["VitalSense", s.pulse ? `${s.pulse.count} readings in the last ${THRESHOLDS.vitalsWindowH} h · pulse ${s.pulse.median} bpm${s.breathing ? ` · breathing ${s.breathing.median}/min` : ""}${s.reference ? ` · resting reference ${s.reference} bpm` : ""}` : "No readings with good signal in the last 6 h. Readings are kept while the camera runs on any page.", "/dashboard/patient/vitalsense"],
          ["FaceSpeak abnormal stretch", s.stretch.length ? `${s.stretch.length} logged in the last 24 h` : "None logged in the last 24 h", "/dashboard/patient/facespeak"],
          ["Requests", s.requests.total ? `${s.requests.total} in the last 24 h · ${s.requests.missed.length} did not reach a caregiver` : "None in the last 24 h", "/dashboard/patient/communicate"],
          ["Move", s.move.lastAt ? `Last session ${new Date(s.move.lastAt).toLocaleDateString()}` : "No sessions logged", "/dashboard/patient/move"],
          ["Nutrition", s.meals.count ? `${s.meals.count} meals in the last 24 h` : "No meals in the last 24 h", "/dashboard/patient/nutrition"],
          ["Weather and air", env ? `${env.place}, Open-Meteo, ${time(env.fetchedAt)}` : "Not loaded", null],
        ].map(([label, value, href]) => (
          <div key={label as string} className="flex flex-wrap gap-x-4 px-5 py-3">
            <dt className="w-48 shrink-0 font-medium text-ink">{href ? <Link href={href as string} className="hover:underline">{label}</Link> : label}</dt>
            <dd className="min-w-0 flex-1 text-muted">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {!risk.sample && (
          <Button variant="secondary" size="sm" onClick={() => riskStore.set({ ...sampleSignals(), sample: true })}>
            Try with sample signals
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => riskStore.clear()}>
          Delete outlook data
        </Button>
      </div>

      <details className="mt-8 text-sm">
        <summary className="cursor-pointer font-medium text-ink">How alerts are decided</summary>
        <div className="mt-3 space-y-2 text-muted">
          <p>
            Each alert comes from a fixed, published rule, not an AI model, so the same signals always give the same alert. Camera readings are experimental estimates: on their own they raise at most
            &ldquo;Watch&rdquo;. &ldquo;Act now&rdquo; needs two independent sources that agree, such as heat and a raised pulse, or a non-camera source such as requests that did not reach anyone.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Heat (feels like): watch from {THRESHOLDS.heatWatch}°C, act from {THRESHOLDS.heatAct}°C. {SOURCES.heat}.</li>
            <li>Air quality: watch from AQI {THRESHOLDS.aqiWatch}, act from {THRESHOLDS.aqiAct}. {SOURCES.aqi}.</li>
            <li>Pulse: above 100 bpm, or {THRESHOLDS.pulseOverReference * 100}% over your own resting reference; below 50 bpm. Breathing: above {THRESHOLDS.breathingHigh}/min. Median of readings with fair or good signal in the last {THRESHOLDS.vitalsWindowH} h.</li>
            <li>FaceSpeak: any one-sided stretch held 60 seconds in the last 24 h, with the BE FAST stroke signs to check.</li>
            <li>Requests: any that failed, timed out or could not reach a caregiver in the last 24 h; 3 or more is &ldquo;Act now&rdquo;.</li>
            <li>Water: no water request for {THRESHOLDS.waterGapH} h while it feels {THRESHOLDS.heatCaution}°C or more, or humidity is {THRESHOLDS.humidLow}% or less. Move: no session for {THRESHOLDS.moveGapDays} days, planned at the coolest hour with acceptable air.</li>
          </ul>
          <p>Rules {RULES_VERSION}. Everything here stays on this device; delete it at any time. These alerts support, and never replace, advice from a clinician. In an emergency call your local emergency number.</p>
        </div>
      </details>
    </div>
  );
}
