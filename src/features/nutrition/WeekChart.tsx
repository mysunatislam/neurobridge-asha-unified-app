"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "./engine.js";
import type { MealLog } from "./store";
import { dailyEnergy } from "./week.js";

type Day = { day: string; meals: number; unknown: number; min: number; max: number | null };
const fmt = formatValue as (v: unknown, key: string, lang: string) => string;
const tx = (lang: string, en: string, bn: string) => (lang === "bn" ? bn : en);
const bnDigits = (s: string) => s.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const locale = (lang: string) => (lang === "bn" ? "bn-BD" : "en-GB");
const noon = (iso: string) => new Date(`${iso}T12:00:00`);
// An open top is drawn 15% above the lowest estimate, dashed, because its real height is unknown.
const OPEN_TOP = 0.15;

function DayTip({ active, payload, lang }: { active?: boolean; payload?: { payload: Day }[]; lang: string }) {
  const d = active ? payload?.[0]?.payload : null;
  if (!d) return null;
  const meals = lang === "bn" ? `${bnDigits(String(d.meals))}টি খাবার` : `${d.meals} meal${d.meals === 1 ? "" : "s"}`;
  const unknown = lang === "bn" ? `${bnDigits(String(d.unknown))}টির শক্তি অজানা` : `${d.unknown} without an energy estimate`;
  return (
    <div className="rounded-xl bg-white px-3 py-2 text-sm shadow-md ring-1 ring-line">
      <p className="font-medium text-ink">{noon(d.day).toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" })}</p>
      {d.meals > 0 ? <p className="text-ink">{fmt({ min: d.min, max: d.max }, "kcal", lang)}</p> : null}
      <p className="text-muted">
        {d.meals + d.unknown === 0 ? tx(lang, "Nothing logged", "কিছু লেখা হয়নি") : [d.meals > 0 ? meals : null, d.unknown > 0 ? unknown : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** Energy eaten per day for the last 7 days, drawn from the meal log on this device. */
export function WeekChart({ log, lang, now }: { log: MealLog[]; lang: string; now?: Date }) {
  const days = dailyEnergy(log, now ?? new Date()) as Day[];
  if (!days.some((d) => d.meals + d.unknown > 0)) return null;
  const data = days.map((d) => ({
    ...d,
    label: noon(d.day).toLocaleDateString(locale(lang), { weekday: "short" }),
    low: d.min,
    extra: d.max === null ? Math.round(d.min * OPEN_TOP) : d.max - d.min,
  }));
  // Round gridlines (250 or 500 kcal apart) so the scale is easy to read.
  const highest = Math.max(...data.map((d) => d.low + d.extra));
  const step = highest > 1000 ? 500 : 250;
  const ticks = Array.from({ length: Math.ceil(highest / step) + 1 }, (_, i) => i * step);
  return (
    <figure className="mt-3" data-testid="nutrition-week">
      <figcaption className="text-sm font-medium text-ink">{tx(lang, "Energy eaten, last 7 days", "গত ৭ দিনে খাওয়া শক্তি")}</figcaption>
      <div className="mt-2 h-48 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--color-muted)", fontSize: 12 }} />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              domain={[0, ticks[ticks.length - 1]]}
              ticks={ticks}
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickFormatter={(v: number) => (lang === "bn" ? bnDigits(String(v)) : String(v))}
            />
            <Tooltip cursor={{ fill: "var(--color-brand-soft)" }} content={<DayTip lang={lang} />} isAnimationActive={false} />
            <Bar dataKey="low" stackId="kcal" fill="var(--color-brand)" maxBarSize={36} isAnimationActive={false} />
            <Bar dataKey="extra" stackId="kcal" maxBarSize={36} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.day}
                  fill="var(--color-brand-mint)"
                  stroke={d.max === null ? "var(--color-brand)" : "none"}
                  strokeDasharray={d.max === null ? "3 3" : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {days.map((d) => (
          <li key={d.day}>
            {noon(d.day).toLocaleDateString(locale(lang), { weekday: "long" })}: {d.meals > 0 ? fmt({ min: d.min, max: d.max }, "kcal", lang) : tx(lang, "no estimate", "অনুমান নেই")}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">
        {tx(
          lang,
          "Dark: the lowest estimate. Light: up to the highest. A dashed top means an amount was unknown, so the day was at least the dark part.",
          "গাঢ়: সর্বনিম্ন অনুমান। হালকা: সর্বোচ্চ অনুমান পর্যন্ত। ড্যাশ দেওয়া মাথা মানে কোনো পরিমাণ অজানা ছিল, তাই দিনটি অন্তত গাঢ় অংশের সমান।",
        )}
      </p>
    </figure>
  );
}
