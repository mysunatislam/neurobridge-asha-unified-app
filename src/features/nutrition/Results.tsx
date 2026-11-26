"use client";

import { cn } from "@/lib/cn";
import { NUTRIENT_KEYS, NUTRIENT_LABEL } from "./catalog.js";
import { EATEN_CHOICES, formatValue, STATUS_TEXT } from "./engine.js";
import { storageTips } from "./interview.js";
import type { ItemResult, Meal, NutrientKey, Text } from "./types";

const L = (lang: string, x?: Text | null) => (x ? (lang === "bn" ? x.bn : x.en) : "");
const tx = (lang: string, en: string, bn: string) => (lang === "bn" ? bn : en);
const LABELS = NUTRIENT_LABEL as Record<NutrientKey, Text & { unit: string }>;
const KEYS = NUTRIENT_KEYS as NutrientKey[];
const STATUS = STATUS_TEXT as Record<string, Text>;
const fmt = formatValue as (v: unknown, key: string, lang: string) => string;

export const EATEN_TEXT: Record<string, Text> = {
  all: { en: "All of it", bn: "পুরোটা" },
  most: { en: "Most (¾)", bn: "বেশিরভাগ (¾)" },
  half: { en: "Half", bn: "অর্ধেক" },
  little: { en: "A little (¼)", bn: "অল্প (¼)" },
  none: { en: "None", bn: "একদম না" },
};

const TONE: Record<string, string> = {
  estimate: "bg-brand-soft text-brand",
  range: "bg-brand-soft text-brand",
  lower_bound: "bg-amber-100 text-amber-900",
  uncertain: "bg-amber-100 text-amber-900",
  unavailable: "bg-wash text-muted",
};

export function StatusBadge({ status, lang }: { status: string; lang: string }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[status])}>{L(lang, STATUS[status])}</span>;
}

function why(meal: Meal, lang: string) {
  if (meal.status === "unavailable" && !meal.counted.length) return tx(lang, "None of these foods could be counted with checked values.", "এই খাবারগুলোর কোনোটিই যাচাই করা মানে গোনা যায়নি।");
  if (meal.excluded.length) return tx(lang, `${meal.excluded.length} of ${meal.items.length} foods couldn't be counted, so the total leaves them out.`, `${meal.items.length}টির মধ্যে ${meal.excluded.length}টি খাবার গোনা যায়নি, তাই মোটে সেগুলো নেই।`);
  if (meal.status === "lower_bound") return tx(lang, "Something that adds energy (such as oil or sugar) has an unknown amount, so this is the least it could be.", "শক্তি যোগ করে এমন কিছুর (যেমন তেল বা চিনি) পরিমাণ অজানা, তাই এটি সর্বনিম্ন।");
  if (meal.status === "range") return tx(lang, "The range comes from answers that weren't exact, such as the size.", "সীমাটি এসেছে এমন উত্তর থেকে যা নির্দিষ্ট নয়, যেমন মাপ।");
  return tx(lang, "Worked out from your answers and checked food records. Real meals vary.", "আপনার উত্তর ও যাচাই করা খাবারের রেকর্ড থেকে হিসাব। আসল খাবারে পার্থক্য থাকে।");
}

export function MealSummary({ meal, lang }: { meal: Meal; lang: string }) {
  const counted = meal.counted.length > 0;
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-line" aria-labelledby="meal-total" data-testid="nutrition-total" data-status={meal.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="meal-total" className="text-sm font-medium text-muted">
          {tx(lang, "Meal estimate", "খাবারের আনুমানিক হিসাব")}
        </h2>
        <StatusBadge status={meal.status} lang={lang} />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink" data-testid="nutrition-total-kcal">
        {counted ? (meal.status === "uncertain" ? `${L(lang, STATUS.uncertain)}` : fmt(meal.total.kcal, "kcal", lang)) : L(lang, STATUS.unavailable)}
      </p>
      {counted && meal.status === "uncertain" && (
        <p className="mt-1 text-lg text-ink" data-testid="nutrition-counted-kcal">
          {tx(lang, "Foods that could be counted: ", "যেগুলো গোনা গেছে: ")}
          {fmt(meal.total.kcal, "kcal", lang)}
        </p>
      )}
      <p className="mt-2 text-sm text-muted">{why(meal, lang)}</p>
      {meal.eaten ? (
        <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 font-medium text-brand" data-testid="nutrition-eaten">
          {tx(lang, "Energy you ate (from your answers): ", "আপনি যা খেয়েছেন (আপনার উত্তর থেকে): ")}
          {fmt(meal.eaten.kcal, "kcal", lang)}
        </p>
      ) : (
        counted && <p className="mt-3 text-sm text-muted">{tx(lang, "This is what was on the plate. Tell ASHA how much you ate below.", "এটি প্লেটে যা ছিল। কতটা খেয়েছেন নিচে জানান।")}</p>
      )}
      {counted && (
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KEYS.filter((k) => k !== "kcal").map((k) => (
            <div key={k} className="rounded-xl bg-wash px-3 py-2">
              <dt className="text-xs text-muted">{L(lang, LABELS[k])}</dt>
              <dd className="font-semibold text-ink" data-testid={`total-${k}`}>
                {fmt(meal.total[k], k, lang)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function ItemCard({ r, lang, eaten, onEaten }: { r: ItemResult; lang: string; eaten: string | null; onEaten?: (choice: string) => void }) {
  const counted = r.status !== "uncertain" && r.status !== "unavailable";
  const tips = storageTips(r.storage, lang) as string[];
  return (
    <article className="rounded-2xl bg-white p-5 ring-1 ring-line" data-testid="nutrition-item" data-dish={r.dishId} data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold text-ink">{L(lang, r.label) || tx(lang, "Food", "খাবার")}</h3>
        <StatusBadge status={r.status} lang={lang} />
      </div>
      <p className="mt-1 text-2xl font-semibold text-ink" data-testid="item-kcal">
        {counted ? fmt(r.nutrients.kcal, "kcal", lang) : L(lang, STATUS[r.status])}
      </p>
      {!counted && r.reference && (
        <p className="mt-1 text-sm text-muted">
          {r.reference.perServing
            ? tx(lang, `For reference: ${r.reference.kcal} kcal per serving on the label.`, `তথ্যের জন্য: লেবেলে প্রতি পরিবেশনে ${r.reference.kcal} কিলোক্যালরি।`)
            : tx(lang, `For reference: ${L("en", r.reference.label)} has ${r.reference.kcal} kcal per 100 g (${r.reference.databaseRecordId}).`, `তথ্যের জন্য: ${L("bn", r.reference.label)}-এ প্রতি ১০০ গ্রামে ${r.reference.kcal} কিলোক্যালরি (${r.reference.databaseRecordId})।`)}
        </p>
      )}
      {r.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-amber-900">
          {r.notes.map((n, i) => (
            <li key={i}>{L(lang, n)}</li>
          ))}
        </ul>
      )}
      {counted && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {KEYS.filter((k) => k !== "kcal").map((k) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1">
              <dt className="text-muted">{L(lang, LABELS[k])}</dt>
              <dd className="text-right font-medium text-ink" title={r.nutrients[k] === null ? L(lang, r.unknownWhy[k]) : undefined}>
                {fmt(r.nutrients[k], k, lang)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {counted && Object.keys(r.unknownWhy).length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {(Object.entries(r.unknownWhy) as [NutrientKey, Text][]).map(([k, w]) => `${L(lang, LABELS[k])}: ${L(lang, w)}`).join(" · ")}
        </p>
      )}
      {onEaten && counted && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink">{tx(lang, "How much of it did you eat?", "এর কতটা খেয়েছেন?")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(EATEN_CHOICES as string[]).map((c) => (
              <button key={c} type="button" aria-pressed={eaten === c} onClick={() => onEaten(c)} className={cn("min-h-11 rounded-full px-4 text-sm font-medium ring-1", eaten === c ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:bg-wash")}>
                {L(lang, EATEN_TEXT[c])}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {tips.length > 0 && (
        <div className="mt-4 rounded-xl bg-wash p-3 text-sm" data-testid="storage-tips">
          <p className="font-medium text-ink">{tx(lang, "Storage tips (these don't change the calories)", "রাখার পরামর্শ (এতে ক্যালরি বদলায় না)")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {tips.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {r.components.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-brand">{tx(lang, "Where these numbers come from", "এই সংখ্যাগুলো কোথা থেকে")}</summary>
          <ul className="mt-2 space-y-2" data-testid="item-sources">
            {r.components.map((c, i) => (
              <li key={i} className="rounded-lg bg-wash px-3 py-2">
                <p className="font-medium text-ink">
                  {c.sources.map((s) => L(lang, s.label)).join(tx(lang, " to ", " থেকে "))}
                  {c.grams && (
                    <span className="font-normal text-muted">
                      {" · "}
                      {c.grams.max === null ? tx(lang, "amount unknown", "পরিমাণ অজানা") : c.grams.max !== c.grams.min ? `${Math.round(c.grams.min)}–${Math.round(c.grams.max)} g` : `${Math.round(c.grams.min * 10) / 10} g`}
                      {c.scope === "pot" && c.potGrams !== null ? tx(lang, ` (your share of ${Math.round(c.potGrams * 10) / 10} g in the pot)`, ` (পাতিলের ${Math.round(c.potGrams * 10) / 10} গ্রামের আপনার ভাগ)`) : ""}
                    </span>
                  )}
                </p>
                {c.sources.map((s) => (
                  <p key={s.databaseRecordId} className="text-xs text-muted">
                    {s.databaseSource} · {s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.databaseRecordId}</a> : s.databaseRecordId}
                    {s.dataVersion ? ` · ${s.dataVersion}` : ""} · {verificationText(s.verification, lang)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function verificationText(v: string, lang: string) {
  if (v === "api_verified") return tx(lang, "checked against the USDA API", "USDA API-তে যাচাই করা");
  if (v === "cross_checked") return tx(lang, "cross-checked copy, API check pending", "প্রতিলিপি মিলিয়ে দেখা, API যাচাই বাকি");
  if (v === "csv_verified") return tx(lang, "checked against the USDA download, API check pending", "USDA-র ডাউনলোড করা তথ্যে যাচাই করা, API যাচাই বাকি");
  if (v === "entered_by_person") return tx(lang, "typed in by you", "আপনার লেখা");
  return v;
}

export function Assumptions({ meal, lang }: { meal: Meal; lang: string }) {
  const all = [...new Map(meal.items.flatMap((r) => r.assumptions).map((a) => [a.en, a])).values()];
  if (!all.length) return null;
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-line" aria-labelledby="assumed" data-testid="nutrition-assumptions">
      <h2 id="assumed" className="font-semibold text-ink">
        {tx(lang, "What ASHA assumed", "আশা যা ধরে নিয়েছে")}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
        {all.map((a, i) => (
          <li key={i}>{L(lang, a)}</li>
        ))}
        <li>{tx(lang, "These are estimates from food tables, not measurements of your meal. ASHA has not been tested for accuracy against weighed meals.", "এগুলো খাদ্য তালিকা থেকে অনুমান, আপনার খাবারের মাপ নয়। ওজন করা খাবারের সাথে আশার নির্ভুলতা এখনো পরীক্ষা করা হয়নি।")}</li>
      </ul>
    </section>
  );
}
