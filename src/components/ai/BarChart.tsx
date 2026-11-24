"use client";

import { useState } from "react";

export type Bar = {
  label: string;
  value: number;
  /** Extra lines for the hover tooltip, for example "Recall@3 1.00". */
  details: string[];
  emphasis?: string;
};

// One series of horizontal bars on a 0–1 scale. Thin bars, value at the tip,
// hairline grid, and a tooltip on hover or keyboard focus. The table view
// lives beside the chart in the page.
export function BarChart({
  bars,
  label,
  unit = "decimal",
}: {
  bars: Bar[];
  label: string;
  // A string, not a formatter: this is rendered from a server component.
  unit?: "decimal" | "percent";
}) {
  const [active, setActive] = useState<number | null>(null);
  const format = (v: number) =>
    unit === "percent" ? `${Math.round(v * 100)}%` : v.toFixed(2);
  return (
    <figure aria-label={label} className="mt-6">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-12 left-[44%] sm:left-[38%]"
        >
          {[0, 0.5, 1].map((t) => (
            <span
              key={t}
              className="absolute inset-y-0 w-px bg-line"
              style={{ left: `${t * 100}%` }}
            />
          ))}
        </div>
        <ul className="relative space-y-1">
          {bars.map((bar, i) => (
            <li
              key={bar.label}
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${bar.label}: ${format(bar.value)}. ${bar.details.join(". ")}`}
              className="relative grid grid-cols-[44%_1fr_3rem] items-center gap-0 rounded-md py-2 outline-none focus-visible:bg-wash sm:grid-cols-[38%_1fr_3rem]"
            >
              <span className="pr-3 text-sm leading-snug text-ink">
                {bar.label}
                {bar.emphasis && (
                  <span className="block text-xs text-muted">
                    {bar.emphasis}
                  </span>
                )}
              </span>
              <span className="relative h-6">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-brand"
                  style={{
                    width: `${Math.max(0, Math.min(1, bar.value)) * 100}%`,
                    opacity: active === null || active === i ? 1 : 0.55,
                  }}
                />
              </span>
              <span className="pl-2 text-sm text-ink tabular-nums">
                {format(bar.value)}
              </span>
              {active === i && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full left-[44%] z-10 mt-1 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink shadow-card sm:left-[38%]"
                >
                  <span className="block font-semibold">{bar.label}</span>
                  {bar.details.map((d) => (
                    <span key={d} className="block text-muted">
                      {d}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
        <div
          aria-hidden
          className="relative mt-1 h-4 text-xs text-muted tabular-nums"
        >
          <span className="absolute inset-y-0 right-12 left-[44%] sm:left-[38%]">
            {[0, 0.5, 1].map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${t * 100}%` }}
              >
                {t === 0 ? "0" : t.toFixed(1)}
              </span>
            ))}
          </span>
        </div>
      </div>
    </figure>
  );
}
