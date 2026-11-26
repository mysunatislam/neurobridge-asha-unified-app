// ASHA Nutrition V5 food records and dishes. Every number here has a named source record.
//
// The eleven records already shipped with Everyday were checked against the USDA FoodData Central
// API when they were added, and are reused unchanged. The five records added for V5 (apple,
// strawberries fresh / frozen plain / frozen sweetened, uncooked rice) could not be fetched from
// the API in this build because the API host was blocked; their values were transcribed from two
// published copies of the same USDA data (the VA VistA nutrient file and FoodData Central SR
// Legacy CSV extracts), which agree. They are marked `cross_checked` and their fibre is left
// unknown until verified. On 2026-11-20 they, and the fruit records added for the camera, were matched
// value by value to the official USDA SR Legacy CSV download (scripts/verify-nutrition-records-csv.mjs)
// and marked `csv_verified`, with fibre filled in. `scripts/verify-nutrition-records.mjs` re-checks
// everything against the API once that host can be reached.
import { FOODS as EVERYDAY_FOODS, FOOD_DATA_VERSION as EVERYDAY_DATA_VERSION } from "../../../public/app/everyday/foods.js";

export const NUTRITION_DATA_VERSION = "asha-nutrition-v5/2026-11-20";
export const NUTRIENT_KEYS = Object.freeze(["kcal", "protein", "fat", "carbohydrate", "fiber", "sodium"]);
export const NUTRIENT_LABEL = Object.freeze({
  kcal: { en: "Energy", bn: "শক্তি", unit: "kcal" },
  protein: { en: "Protein", bn: "প্রোটিন", unit: "g" },
  fat: { en: "Fat", bn: "চর্বি", unit: "g" },
  carbohydrate: { en: "Carbohydrate", bn: "শর্করা", unit: "g" },
  fiber: { en: "Fibre", bn: "আঁশ", unit: "g" },
  sodium: { en: "Sodium", bn: "সোডিয়াম", unit: "mg" },
});

const SR_LEGACY = { publisher: "USDA FoodData Central", type: "SR Legacy", published: "2019-04-01", license: "CC0-1.0" };
// Food state is part of a record's identity: cooked rice is never matched to dry rice.
const EVERYDAY_STATE = {
  "rice-cooked": "cooked",
  "lentils-boiled": "cooked",
  "potato-boiled": "cooked",
  banana: "raw",
  "chicken-roasted": "cooked",
  "tilapia-cooked": "cooked",
  "carrot-raw": "raw",
  "spinach-raw": "raw",
  "soybean-oil": "as_sold",
  salt: "as_sold",
  sugar: "as_sold",
};

const fromEveryday = EVERYDAY_FOODS.map((f) =>
  Object.freeze({
    id: f.id,
    fdcId: f.fdcId,
    en: f.en,
    bn: f.bn,
    description: f.description,
    aliases: f.aliases,
    state: EVERYDAY_STATE[f.id] ?? "as_sold",
    per100g: f.per100g,
    source: f.source,
    databaseSource: "USDA FoodData Central SR Legacy",
    databaseRecordId: `fdc:${f.fdcId}`,
    dataVersion: EVERYDAY_DATA_VERSION,
    verification: { status: "api_verified", note: "Checked against the FoodData Central API when added to ASHA Everyday." },
  }),
);

// SR Legacy CSV release (April 2018, CC0) from fdc.nal.usda.gov, downloaded on the team PC on
// 2026-11-19 and checked value by value with scripts/verify-nutrition-records-csv.mjs. The API host
// is still blocked in the cloud build, so these say "checked against the USDA download", not "API".
const SR_CSV_NOTE = "Checked value by value against the official USDA SR Legacy CSV download (April 2018 release); not yet re-fetched from the FoodData Central API.";
function csvChecked(id, fdcId, en, bn, description, state, [kcal, protein, fat, carbohydrate, fiber, sodium], aliases = []) {
  return Object.freeze({
    id,
    fdcId,
    en,
    bn,
    description,
    aliases: Object.freeze(aliases),
    state,
    // Per 100 g edible food.
    per100g: Object.freeze({ kcal, protein, fat, carbohydrate, fiber, sodium }),
    source: Object.freeze({ ...SR_LEGACY, retrieved: "2026-11-19", url: `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients` }),
    databaseSource: "USDA FoodData Central SR Legacy",
    databaseRecordId: `fdc:${fdcId}`,
    dataVersion: NUTRITION_DATA_VERSION,
    verification: { status: "csv_verified", note: SR_CSV_NOTE },
  });
}

const added = [
  // V5 records (first transcribed from published copies, now matched to the USDA CSV; fibre filled in).
  csvChecked("apple-raw", 171688, "Apple · raw, with skin", "আপেল · কাঁচা, খোসাসহ", "Apples, raw, with skin", "raw", [52, 0.26, 0.17, 13.81, 2.4, 1], ["apple", "apel", "আপেল"]),
  csvChecked("strawberries-raw", 167762, "Strawberries · fresh", "স্ট্রবেরি · তাজা", "Strawberries, raw", "raw", [32, 0.67, 0.3, 7.68, 2.0, 1], ["strawberry", "স্ট্রবেরি"]),
  csvChecked("strawberries-frozen-plain", 168173, "Strawberries · frozen, unsweetened", "স্ট্রবেরি · হিমায়িত, চিনি ছাড়া", "Strawberries, frozen, unsweetened", "frozen", [35, 0.43, 0.11, 9.13, 2.1, 2], ["frozen strawberry"]),
  csvChecked("strawberries-frozen-sweetened", 168174, "Strawberries · frozen, sweetened, sliced", "স্ট্রবেরি · হিমায়িত, চিনিযুক্ত, টুকরো", "Strawberries, frozen, sweetened, sliced", "frozen", [96, 0.53, 0.13, 25.92, 1.9, 3], ["sweetened strawberry"]),
  csvChecked("rice-raw", 168877, "Rice · uncooked (dry), white", "চাল · রান্নার আগে (শুকনো)", "Rice, white, long-grain, regular, raw, enriched", "dried", [365, 7.13, 0.66, 79.95, 1.3, 5], ["chal", "চাল", "dry rice"]),
  // Added 2026-11-20 for foods the camera recognises, plus mango and guava (common in Bangladesh).
  csvChecked("orange-raw", 169097, "Orange or malta · raw", "কমলা / মাল্টা · কাঁচা", "Oranges, raw, all commercial varieties", "raw", [47, 0.94, 0.12, 11.75, 2.4, 0], ["orange", "malta", "komola", "কমলা", "মাল্টা"]),
  csvChecked("pear-raw", 169118, "Pear · raw", "নাশপাতি · কাঁচা", "Pears, raw", "raw", [57, 0.36, 0.14, 15.23, 3.1, 1], ["pear", "nashpati", "নাশপাতি"]),
  csvChecked("peach-raw", 169928, "Peach · raw", "পীচ ফল · কাঁচা", "Peaches, yellow, raw", "raw", [39, 0.91, 0.25, 9.54, 1.5, 0], ["peach", "পীচ"]),
  csvChecked("pomegranate-raw", 169134, "Pomegranate · raw", "ডালিম · কাঁচা", "Pomegranates, raw", "raw", [83, 1.67, 1.17, 18.7, 4.0, 3], ["pomegranate", "dalim", "anar", "ডালিম", "আনার"]),
  csvChecked("tomato-raw", 170457, "Tomato · raw, red", "টমেটো · কাঁচা, লাল", "Tomatoes, red, ripe, raw, year round average", "raw", [18, 0.88, 0.2, 3.89, 1.2, 5], ["tomato", "টমেটো"]),
  csvChecked("mango-raw", 169910, "Mango · ripe, raw", "আম · পাকা", "Mangos, raw", "raw", [60, 0.82, 0.38, 14.98, 1.6, 1], ["mango", "aam", "আম"]),
  csvChecked("guava-raw", 173044, "Guava · raw", "পেয়ারা · কাঁচা", "Guavas, common, raw", "raw", [68, 2.55, 0.95, 14.32, 5.4, 2], ["guava", "peyara", "পেয়ারা"]),
];

export const FOOD_RECORDS = Object.freeze([...fromEveryday, ...added]);
export const getRecord = (id) => FOOD_RECORDS.find((r) => r.id === id) ?? null;

/** USDA SR Legacy food portion weights (edible grams), cross-checked against a published copy. */
export const PORTION_SOURCE = "USDA SR Legacy food portion weights";
export const PORTIONS = Object.freeze({
  banana: [
    { id: "small", en: "Small (6–7 in long)", bn: "ছোট (৬–৭ ইঞ্চি)", grams: 101 },
    { id: "medium", en: "Medium (7–8 in long)", bn: "মাঝারি (৭–৮ ইঞ্চি)", grams: 118 },
    { id: "large", en: "Large (8–9 in long)", bn: "বড় (৮–৯ ইঞ্চি)", grams: 136 },
  ],
  "apple-raw": [
    { id: "small", en: "Small (2¾ in across)", bn: "ছোট (২¾ ইঞ্চি)", grams: 149 },
    { id: "medium", en: "Medium (3 in across)", bn: "মাঝারি (৩ ইঞ্চি)", grams: 182 },
    { id: "large", en: "Large (3¼ in across)", bn: "বড় (৩¼ ইঞ্চি)", grams: 223 },
  ],
  "orange-raw": [
    { id: "small", en: "Small (2⅜ in across)", bn: "ছোট (২⅜ ইঞ্চি)", grams: 96 },
    { id: "medium", en: "Medium (2⅝ in across)", bn: "মাঝারি (২⅝ ইঞ্চি)", grams: 131 },
    { id: "large", en: "Large (3 in across)", bn: "বড় (৩ ইঞ্চি)", grams: 184 },
  ],
  "pear-raw": [
    { id: "small", en: "Small", bn: "ছোট", grams: 148 },
    { id: "medium", en: "Medium", bn: "মাঝারি", grams: 178 },
    { id: "large", en: "Large", bn: "বড়", grams: 230 },
  ],
  "peach-raw": [
    { id: "small", en: "Small (2½ in across)", bn: "ছোট (২½ ইঞ্চি)", grams: 130 },
    { id: "medium", en: "Medium (2⅔ in across)", bn: "মাঝারি (২⅔ ইঞ্চি)", grams: 150 },
    { id: "large", en: "Large (2¾ in across)", bn: "বড় (২¾ ইঞ্চি)", grams: 175 },
  ],
  "tomato-raw": [
    { id: "small", en: "Small (2⅖ in across)", bn: "ছোট (২⅖ ইঞ্চি)", grams: 91 },
    { id: "medium", en: "Medium (2⅗ in across)", bn: "মাঝারি (২⅗ ইঞ্চি)", grams: 123 },
    { id: "large", en: "Large (3 in across)", bn: "বড় (৩ ইঞ্চি)", grams: 182 },
  ],
  // USDA gives one whole-fruit weight for these.
  "pomegranate-raw": [{ id: "whole", en: "Whole (4 in across)", bn: "আস্ত (৪ ইঞ্চি)", grams: 282 }],
  "mango-raw": [{ id: "whole", en: "Whole, edible part", bn: "আস্ত, খাওয়ার অংশ", grams: 336 }],
  "guava-raw": [{ id: "whole", en: "Whole, edible part", bn: "আস্ত, খাওয়ার অংশ", grams: 55 }],
  // SR Legacy food_portion for fdc 168878: 1 cup cooked rice = 158 g.
  "rice-cooked": [{ id: "cup", en: "Cup (about 240 ml)", bn: "কাপ (প্রায় ২৪০ মিলি)", grams: 158 }],
});
/** Spoon weights from the same USDA portion tables: soybean oil, granulated sugar, table salt. */
export const SPOON_GRAMS = Object.freeze({ oil: { tsp: 4.5, tbsp: 13.6 }, sugar: { tsp: 4.2 }, salt: { tsp: 6.0 } });

/**
 * What a person can log. `category` picks the questions (interview.js). Recipe dishes list the
 * whole-pot ingredients the questions fill in; nothing is added that the person didn't confirm,
 * except the ASHA template amounts named in `assumption`, which are shown and editable.
 */
export const DISHES = Object.freeze({
  banana: { id: "banana", category: "whole_fruit", en: "Banana", bn: "কলা", record: "banana", portions: "banana" },
  apple: { id: "apple", category: "whole_fruit", en: "Apple", bn: "আপেল", record: "apple-raw", portions: "apple-raw" },
  orange: { id: "orange", category: "whole_fruit", en: "Orange or malta", bn: "কমলা / মাল্টা", record: "orange-raw", portions: "orange-raw" },
  pear: { id: "pear", category: "whole_fruit", en: "Pear", bn: "নাশপাতি", record: "pear-raw", portions: "pear-raw" },
  peach: { id: "peach", category: "whole_fruit", en: "Peach", bn: "পীচ ফল", record: "peach-raw", portions: "peach-raw" },
  pomegranate: { id: "pomegranate", category: "whole_fruit", en: "Pomegranate", bn: "ডালিম", record: "pomegranate-raw", portions: "pomegranate-raw" },
  tomato: { id: "tomato", category: "whole_fruit", en: "Tomato (raw)", bn: "টমেটো (কাঁচা)", record: "tomato-raw", portions: "tomato-raw" },
  mango: { id: "mango", category: "whole_fruit", en: "Mango", bn: "আম", record: "mango-raw", portions: "mango-raw" },
  guava: { id: "guava", category: "whole_fruit", en: "Guava", bn: "পেয়ারা", record: "guava-raw", portions: "guava-raw" },
  strawberries: { id: "strawberries", category: "frozen_fruit", en: "Strawberries", bn: "স্ট্রবেরি", records: { fresh: "strawberries-raw", frozen_plain: "strawberries-frozen-plain", frozen_sweetened: "strawberries-frozen-sweetened" } },
  rice: { id: "rice", category: "rice", en: "Rice", bn: "ভাত", records: { cooked: "rice-cooked", dry: "rice-raw" } },
  dal: {
    id: "dal",
    category: "curry",
    en: "Dal",
    bn: "ডাল",
    main: "lentils-boiled",
    bowlGrams: 100,
    assumption: { en: "One bowl of dal is taken as 100 g of boiled lentils (ASHA's template, not a measured value). Thin dal has less, thick dal more.", bn: "এক বাটি ডালে ১০০ গ্রাম সেদ্ধ ডাল ধরা হয়েছে (আশার নমুনা, মাপা নয়)। পাতলা ডালে কম, ঘন ডালে বেশি।" },
  },
  fish_curry: {
    id: "fish_curry",
    category: "curry",
    en: "Fish curry",
    bn: "মাছের ঝোল",
    main: "tilapia-cooked",
    side: "potato-boiled",
    assumption: { en: "Fish is counted with USDA's cooked tilapia values. Other fish differ; spices and water add little energy and are not counted.", bn: "মাছ USDA-র রান্না করা তেলাপিয়ার মান দিয়ে গোনা। অন্য মাছে মান আলাদা; মসলা ও পানির শক্তি সামান্য, গোনা হয়নি।" },
  },
  packaged: { id: "packaged", category: "packaged", en: "Packaged food", bn: "প্যাকেটজাত খাবার" },
  other: { id: "other", category: "unknown", en: "Something else", bn: "অন্য কিছু" },
});
export const dishLabel = (id, lang) => (lang === "bn" ? DISHES[id]?.bn : DISHES[id]?.en) ?? id;

/** Foods the "something else" search can find directly (simple foods with a single record). */
export const SIMPLE_FOODS = Object.freeze(["potato-boiled", "chicken-roasted", "tilapia-cooked", "carrot-raw", "spinach-raw", "lentils-boiled", "rice-cooked", "banana", "apple-raw", "strawberries-raw", "orange-raw", "pear-raw", "peach-raw", "pomegranate-raw", "tomato-raw", "mango-raw", "guava-raw"]);

export function searchFoods(query = "") {
  const words = String(query).normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const dishes = Object.values(DISHES)
    .filter((d) => d.id !== "other")
    .filter((d) => words.every((w) => `${d.en} ${d.bn} ${d.id}`.toLocaleLowerCase().includes(w)))
    .map((d) => ({ kind: "dish", id: d.id, en: d.en, bn: d.bn }));
  const records = SIMPLE_FOODS.map(getRecord)
    .filter((r) => words.every((w) => `${r.en} ${r.bn} ${r.description} ${r.aliases.join(" ")}`.toLocaleLowerCase().includes(w)))
    .map((r) => ({ kind: "record", id: r.id, en: r.en, bn: r.bn }));
  return [...dishes, ...records].slice(0, 12);
}

/**
 * ASHA's on-device food recogniser: DINOv2-small (Meta, Apache-2.0; int8 ONNX) with a classification
 * head trained by ASHA on Open Images V7 photos (CC BY 2.0) and two Bangladeshi food photo sets
 * (BD-Food33, CC0; Bangladeshi Street Food, CC BY 4.0) for 65 foods plus "not food", 31 of them
 * Bangladeshi dishes. Held-out results with this int8 file: 97.1% top-1 on 456 Bangladeshi photos and
 * 82.4% on 4,951 Open Images photos (see docs/NUTRITION_PUBLIC_DATA_VALIDATION.md). It replaced an
 * EfficientNetV2-B0 version (82.7% / 75.9%) on 2026-11-26; the file is 24.6 MB instead of 7.2 MB.
 * Public-photo accuracy is not clinical validation.
 *
 * Only the model's single best guess can become a suggestion, and only when it reaches that food's
 * `fillMin` score. ASHA never skips past the best guess to a lower one it happens to have a record for:
 * that is how an orange used to be suggested as "apple" (the old general model's top label was
 * "orange", which ASHA ignored, and its lower "Granny Smith" label became apple).
 * Foods ASHA has no nutrition record for, or doesn't fill in, are named ("Looks like …") but never get
 * numbers until the person picks them.
 */
export const FOOD_VISION = Object.freeze({
  modelId: "asha/food-dinov2s-oi-bd66-int8",
  modelVersion: "2026-11-26",
  sha256: "f9c0d2c691f96cd64eb61a226dfea469f0100f272a11b5090d6f7e18d69a7bb8",
  bytes: 24577140,
  url: "/models/asha-food-dinov2s-66-int8.onnx",
  license: "Backbone Apache-2.0 (Meta DINOv2-small, int8 ONNX from Xenova/dinov2-small); head trained by ASHA on Open Images V7 (CC BY 2.0 images, CC BY 4.0 labels), BD-Food33 (CC0) and Bangladeshi Street Food (CC BY 4.0)",
  experimental: true,
  input: Object.freeze({ size: 224, layout: "NHWC", range: "0-255 RGB" }),
  // A best guess below this is not shown at all.
  minScore: 0.5,
  // Output order of the model's probabilities. Never reorder without retraining.
  classes: Object.freeze(["achar", "apple", "bakarkhani", "banana", "beguni", "bell_pepper", "bhorta", "bread", "cabbage", "cake", "carrot", "cauliflower", "chicken_curry", "chili", "chomchom", "chop", "cucumber", "curry", "dal", "egg_curry", "fish_curry", "french_fries", "fried_chicken", "fried_fish", "fuchka", "grape", "grapefruit_pomelo", "haleem", "hamburger", "jalebi", "jhalmuri", "kabab", "kotkoti", "lemon_lime", "milk", "muglai_paratha", "mutton_roast", "noodles", "not_food", "omelette", "onion", "orange", "paratha", "peach", "pear", "peyaju", "pineapple", "pitha", "pizza", "polao", "pomegranate", "potato", "prawn_curry", "pumpkin", "rasmalai", "rice", "roast_chicken", "salad", "sandesh", "sandwich", "shawarma", "singara_samosa", "strawberry", "tea", "tomato", "watermelon"]),
  // Recognised foods that ASHA has a dish with sourced nutrition for.
  dishFor: Object.freeze({ apple: "apple", banana: "banana", strawberry: "strawberries", rice: "rice", orange: "orange", pear: "pear", peach: "peach", pomegranate: "pomegranate", tomato: "tomato", dal: "dal", fish_curry: "fish_curry" }),
  // Lowest score at which the camera fills a food in by itself. Chosen on held-out photos from the
  // training side only, as the lowest score (0.5 and up) where at least 90% of fills were right
  // (scripts/public-data-validation/nutrition/bd_fill_thresholds.py, BACKBONE=dino). Orange never got
  // there (it is mixed up with grapefruit/pomelo and lemon), and neither did rice with this model (Open
  // Images "rice" photos are often rice with curry), so both are named and offered as "+ add", never
  // filled in by themselves.
  fillMin: Object.freeze({ apple: 0.5, banana: 0.5, strawberry: 0.5, pear: 0.5, peach: 0.65, pomegranate: 0.5, tomato: 0.5, dal: 0.5, fish_curry: 0.5 }),
  labels: Object.freeze({
    apple: { en: "Apple", bn: "আপেল" }, banana: { en: "Banana", bn: "কলা" }, bell_pepper: { en: "Bell pepper (capsicum)", bn: "ক্যাপসিকাম" },
    bread: { en: "Bread", bn: "পাউরুটি" }, cabbage: { en: "Cabbage", bn: "বাঁধাকপি" }, cake: { en: "Cake", bn: "কেক" }, carrot: { en: "Carrot", bn: "গাজর" },
    cauliflower: { en: "Cauliflower", bn: "ফুলকপি" }, chili: { en: "Chilli", bn: "মরিচ" }, cucumber: { en: "Cucumber", bn: "শসা" }, curry: { en: "Curry", bn: "তরকারি" },
    grape: { en: "Grapes", bn: "আঙুর" }, grapefruit_pomelo: { en: "Grapefruit or pomelo (jambura)", bn: "জাম্বুরা" }, hamburger: { en: "Burger", bn: "বার্গার" },
    lemon_lime: { en: "Lemon or lime", bn: "লেবু" }, milk: { en: "Milk", bn: "দুধ" }, noodles: { en: "Noodles or chowmein", bn: "নুডলস / চাউমিন" }, not_food: { en: "Not a food", bn: "খাবার নয়" },
    omelette: { en: "Omelette", bn: "ডিম ভাজি / অমলেট" }, onion: { en: "Onion", bn: "পেঁয়াজ" }, orange: { en: "Orange (or malta)", bn: "কমলা / মাল্টা" }, peach: { en: "Peach", bn: "পীচ ফল" },
    pear: { en: "Pear", bn: "নাশপাতি" }, pineapple: { en: "Pineapple", bn: "আনারস" }, pizza: { en: "Pizza", bn: "পিৎজা" }, pomegranate: { en: "Pomegranate", bn: "ডালিম" },
    potato: { en: "Potato", bn: "আলু" }, pumpkin: { en: "Pumpkin", bn: "মিষ্টি কুমড়া" }, rice: { en: "Rice", bn: "ভাত" }, salad: { en: "Salad", bn: "সালাদ" },
    sandwich: { en: "Sandwich", bn: "স্যান্ডউইচ" }, strawberry: { en: "Strawberries", bn: "স্ট্রবেরি" }, tea: { en: "Tea", bn: "চা" }, tomato: { en: "Tomato", bn: "টমেটো" },
    watermelon: { en: "Watermelon", bn: "তরমুজ" },
    // Bangladeshi dishes
    achar: { en: "Achar (pickle)", bn: "আচার" }, bakarkhani: { en: "Bakarkhani", bn: "বাকরখানি" }, beguni: { en: "Beguni", bn: "বেগুনি" }, bhorta: { en: "Bhorta (mash)", bn: "ভর্তা" },
    chicken_curry: { en: "Chicken curry", bn: "মুরগির তরকারি" }, chomchom: { en: "Chomchom", bn: "চমচম" }, chop: { en: "Chop (fried cutlet)", bn: "চপ" }, dal: { en: "Dal", bn: "ডাল" },
    egg_curry: { en: "Egg curry", bn: "ডিমের তরকারি" }, fish_curry: { en: "Fish curry", bn: "মাছের ঝোল" }, french_fries: { en: "French fries", bn: "ফ্রেঞ্চ ফ্রাই" },
    fried_chicken: { en: "Fried chicken", bn: "ফ্রাইড চিকেন" }, fried_fish: { en: "Fried fish", bn: "মাছ ভাজা" }, fuchka: { en: "Fuchka", bn: "ফুচকা" }, haleem: { en: "Haleem", bn: "হালিম" },
    jalebi: { en: "Jilapi (jalebi)", bn: "জিলাপি" }, jhalmuri: { en: "Jhalmuri", bn: "ঝালমুড়ি" }, kabab: { en: "Kabab", bn: "কাবাব" }, kotkoti: { en: "Kotkoti", bn: "কটকটি" },
    muglai_paratha: { en: "Moglai paratha", bn: "মোগলাই পরোটা" }, mutton_roast: { en: "Mutton roast", bn: "খাসির রোস্ট" }, paratha: { en: "Paratha", bn: "পরোটা" }, peyaju: { en: "Peyaju", bn: "পেঁয়াজু" },
    pitha: { en: "Pitha", bn: "পিঠা" }, polao: { en: "Polao", bn: "পোলাও" }, prawn_curry: { en: "Prawn curry (chingri)", bn: "চিংড়ি ভুনা" }, rasmalai: { en: "Rasmalai", bn: "রসমালাই" },
    roast_chicken: { en: "Chicken roast", bn: "মুরগির রোস্ট" }, sandesh: { en: "Sandesh", bn: "সন্দেশ" }, shawarma: { en: "Shawarma", bn: "শাওয়ারমা" }, singara_samosa: { en: "Singara or samosa", bn: "সিঙ্গারা / সমুচা" },
  }),
});
/** The ASHA dish a recognised label maps to, or null when ASHA has no nutrition record for it. */
export const suggestionFor = (label) => FOOD_VISION.dishFor[label] ?? null;
/** True when the camera may fill this food in by itself at this score (see FOOD_VISION.fillMin). */
export const autoFillFor = (label, score) => FOOD_VISION.fillMin[label] != null && score >= FOOD_VISION.fillMin[label];
/** Display name of a recogniser label (falls back to the raw label). */
export const visionLabel = (label, lang = "en") => FOOD_VISION.labels[label]?.[lang === "bn" ? "bn" : "en"] ?? label;
