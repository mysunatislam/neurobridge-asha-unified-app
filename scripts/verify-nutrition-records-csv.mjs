// Checks every ASHA Nutrition food record, portion weight and spoon weight against the official USDA
// SR Legacy CSV download (FoodData_Central_sr_legacy_food_csv_2018-04.zip from fdc.nal.usda.gov, CC0),
// for builds where the FoodData Central API host is blocked.
//
//   node scripts/verify-nutrition-records-csv.mjs <folder with food.csv, food_nutrient.csv, food_portion.csv>
//
// Prints each value next to the CSV's value and exits 1 on any mismatch. Nothing is sent anywhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOOD_RECORDS, PORTIONS, SPOON_GRAMS } from "../src/features/nutrition/catalog.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/verify-nutrition-records-csv.mjs <SR Legacy CSV folder>");
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const load = (name) => parseCsv(readFileSync(join(dir, name), "utf8"));

const NUTRIENT_IDS = { kcal: "1008", protein: "1003", fat: "1004", carbohydrate: "1005", fiber: "1079", sodium: "1093" };
const SPOON_RECORDS = { oil: 171411, sugar: 169655, salt: 173468 };
const wanted = new Set([...FOOD_RECORDS.map((r) => String(r.fdcId)), ...Object.values(SPOON_RECORDS).map(String)]);
const close = (a, b) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.005);

const description = new Map(load("food.csv").filter((r) => wanted.has(r.fdc_id)).map((r) => [r.fdc_id, r.description]));
const nutrients = new Map();
for (const r of load("food_nutrient.csv")) {
  if (!wanted.has(r.fdc_id)) continue;
  if (!nutrients.has(r.fdc_id)) nutrients.set(r.fdc_id, {});
  nutrients.get(r.fdc_id)[r.nutrient_id] = Number(r.amount);
}
const portions = new Map();
for (const r of load("food_portion.csv")) {
  if (!wanted.has(r.fdc_id)) continue;
  if (!portions.has(r.fdc_id)) portions.set(r.fdc_id, []);
  portions.get(r.fdc_id).push({ text: `${r.amount} ${r.modifier} ${r.portion_description}`.trim(), grams: Number(r.gram_weight) });
}

let failures = 0, checked = 0;
const report = (ok, line) => {
  checked += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
};

for (const r of FOOD_RECORDS) {
  const id = String(r.fdcId);
  // Descriptions in the CSV can carry a "(Includes foods for USDA's Food Distribution Program)" suffix.
  const d = description.get(id) ?? "";
  report(d.replace(/\s*\(Includes foods for USDA's Food Distribution Program\)$/, "") === r.description, `${r.id} description: "${d}"`);
  for (const [k, nid] of Object.entries(NUTRIENT_IDS)) {
    const csv = nutrients.get(id)?.[nid] ?? null;
    const ours = r.per100g[k];
    if (ours === null) console.log(`info ${r.id}.${k}: ASHA has unknown, CSV says ${csv}`);
    else report(csv !== null && close(ours, csv), `${r.id}.${k}: ASHA ${ours}, CSV ${csv}`);
  }
  const ps = PORTIONS[r.id];
  if (ps) {
    const csv = portions.get(id) ?? [];
    for (const p of ps) report(csv.some((x) => close(p.grams, x.grams)), `${r.id} portion ${p.id} ${p.grams} g; CSV: ${csv.map((x) => `${x.text}=${x.grams}`).join("; ")}`);
  }
}
for (const [kind, fdc] of Object.entries(SPOON_RECORDS)) {
  const csv = portions.get(String(fdc)) ?? [];
  for (const [unit, grams] of Object.entries(SPOON_GRAMS[kind])) report(csv.some((x) => close(grams, x.grams) && x.text.includes(unit)), `${kind} ${unit} ${grams} g; CSV: ${csv.map((x) => `${x.text}=${x.grams}`).join("; ")}`);
}
console.log(failures ? `\n${failures} of ${checked} checks failed.` : `\nAll ${checked} checks match the USDA SR Legacy CSV.`);
process.exit(failures ? 1 : 0);
