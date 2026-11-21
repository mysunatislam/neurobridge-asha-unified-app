// ASHA Nutrition V5: food records, calculator, adaptive questions, steady-freeze rule, screen states
// and photo checks. Numbers are worked out by hand from the cited USDA records.
import assert from "node:assert/strict";
import test from "node:test";
import { DISHES, FOOD_RECORDS, FOOD_VISION, getRecord, NUTRIENT_KEYS, PORTIONS, searchFoods, suggestionFor, visionLabel } from "../src/features/nutrition/catalog.js";
import { approx, estimateItem, estimateMeal, formatValue, spoonGrams } from "../src/features/nutrition/engine.js";
import { checkDimensions, checkFile, fitWithin, sniffImageType } from "../src/features/nutrition/image.js";
import { answer, applicable, back, nextQuestion, newItem, progress, questionsFor, reopen, storageTips, validAnswer } from "../src/features/nutrition/interview.js";
import { readSample, recognisedFrom, SCAN_RULE, StabilityTracker, suggestionsFrom } from "../src/features/nutrition/scan.js";
import { canGo, NutritionFlow, TRANSITIONS } from "../src/features/nutrition/state.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const fill = (dishId, pairs, capture) => pairs.reduce((it, [q, a]) => answer(it, q, a), newItem(dishId, capture));
const kcal = (it) => estimateItem(it).nutrients.kcal;

test("every food record names its source, state and verification; unknown values are null, never zero", () => {
  for (const r of FOOD_RECORDS) {
    assert.match(r.databaseRecordId, /^fdc:\d+$/);
    assert.ok(r.source.url.includes(String(r.fdcId)));
    assert.ok(["raw", "cooked", "frozen", "dried", "as_sold"].includes(r.state), r.id);
    assert.ok(["api_verified", "cross_checked", "csv_verified"].includes(r.verification.status));
    for (const k of NUTRIENT_KEYS) assert.ok(r.per100g[k] === null || Number.isFinite(r.per100g[k]), `${r.id}.${k}`);
    if (r.verification.status === "cross_checked") assert.equal(r.per100g.fiber, null, "fibre left unknown until verified");
    if (r.verification.status === "csv_verified") assert.ok(Number.isFinite(r.per100g.fiber), `${r.id}: fibre filled in from the USDA CSV`);
  }
  // Cooked and dry rice are different records with different states.
  assert.equal(getRecord("rice-cooked").state, "cooked");
  assert.equal(getRecord("rice-raw").state, "dried");
  assert.notEqual(getRecord("rice-cooked").fdcId, getRecord("rice-raw").fdcId);
  for (const d of ["banana", "apple", "orange", "pear", "peach", "pomegranate", "tomato", "mango", "guava", "strawberries", "rice", "dal", "fish_curry", "packaged"]) assert.ok(DISHES[d], d);
});

test("only the recogniser's best guess can become a suggestion, and only foods with records", () => {
  assert.equal(suggestionFor("banana"), "banana");
  assert.equal(suggestionFor("apple"), "apple");
  assert.equal(suggestionFor("strawberry"), "strawberries");
  assert.equal(suggestionFor("rice"), "rice");
  assert.equal(suggestionFor("orange"), "orange");
  for (const label of ["lemon_lime", "grapefruit_pomelo", "pizza", "not_food", "Granny Smith"]) assert.equal(suggestionFor(label), null, label);
  // Every recognised food with a dish points at a real dish whose record exists.
  for (const [label, dish] of Object.entries(FOOD_VISION.dishFor)) {
    assert.ok(FOOD_VISION.classes.includes(label), label);
    assert.ok(DISHES[dish], dish);
  }
  const s = suggestionsFrom([{ label: "banana", score: 0.8 }, { label: "banana", score: 0.4 }, { label: "strawberry", score: 0.1 }]);
  assert.deepEqual(s.map((x) => x.dishId), ["banana"]);
  assert.equal(s[0].experimental, true);
  assert.equal(s[0].modelId, FOOD_VISION.modelId);
  // The orange bug: best guess "orange" never falls through to the lower "apple". Orange has a dish but
  // is never filled in by the camera (too often confused with pomelo and lemon), only named.
  assert.deepEqual(suggestionsFrom([{ label: "orange", score: 0.95 }, { label: "apple", score: 0.04 }]), []);
  assert.equal(recognisedFrom([{ label: "orange", score: 0.62 }, { label: "apple", score: 0.31 }])[0].dishId, "orange");
  // Per-food fill-in thresholds: apple needs 0.75, rice 0.85; dal and fish curry 0.5.
  assert.deepEqual(suggestionsFrom([{ label: "apple", score: 0.7 }]), []);
  assert.deepEqual(suggestionsFrom([{ label: "apple", score: 0.8 }]).map((x) => x.dishId), ["apple"]);
  assert.deepEqual(suggestionsFrom([{ label: "rice", score: 0.8 }]), []);
  assert.deepEqual(suggestionsFrom([{ label: "rice", score: 0.9 }]).map((x) => x.dishId), ["rice"]);
  assert.deepEqual(suggestionsFrom([{ label: "dal", score: 0.55 }]).map((x) => x.dishId), ["dal"]);
  assert.deepEqual(suggestionsFrom([{ label: "fish_curry", score: 0.6 }]).map((x) => x.dishId), ["fish_curry"]);
  for (const label of Object.keys(FOOD_VISION.fillMin)) assert.ok(FOOD_VISION.dishFor[label], `${label} fills in only with a dish`);
  // A best guess without a record never falls through to a lower food that has one.
  assert.deepEqual(suggestionsFrom([{ label: "lemon_lime", score: 0.55 }, { label: "apple", score: 0.4 }]), []);
  assert.deepEqual(suggestionsFrom([{ label: "apple", score: 0.3 }, { label: "pear", score: 0.25 }]), [], "below minScore");
  assert.deepEqual(suggestionsFrom([{ label: "not_food", score: 0.9 }, { label: "apple", score: 0.05 }]), []);
  // A food without a record is still named for the person.
  const r = recognisedFrom([{ label: "apple", score: 0.4 }, { label: "lemon_lime", score: 0.55 }, { label: "not_food", score: 0.02 }]);
  assert.equal(r[0].label, "lemon_lime");
  assert.equal(r[0].dishId, null);
  assert.equal(visionLabel("orange", "en"), "Orange (or malta)");
  assert.equal(visionLabel("orange", "bn"), "কমলা / মাল্টা");
  // Labels and model metadata agree.
  assert.equal(FOOD_VISION.classes.length, 66);
  for (const c of ["dal", "fish_curry", "bhorta", "polao", "pitha", "fuchka", "singara_samosa", "egg_curry"]) assert.ok(FOOD_VISION.classes.includes(c), c);
  assert.equal(visionLabel("bhorta", "bn"), "ভর্তা");
  for (const c of FOOD_VISION.classes) assert.ok(FOOD_VISION.labels[c], c);
});

test("the shipped food model file matches its recorded size and checksum", async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(new URL(`../public${FOOD_VISION.url}`, import.meta.url));
  assert.equal(buf.length, FOOD_VISION.bytes);
  assert.equal(createHash("sha256").update(buf).digest("hex"), FOOD_VISION.sha256);
});

test("acceptance 1: a steady candidate (4 of the last 6 good frames) fires once; Retake re-arms", () => {
  const t = new StabilityTracker();
  const good = (label = "banana") => ({ categories: [{ label, score: 0.7 }], quality: { warnings: [] }, faceInView: false });
  assert.equal(t.push(good()).state, "SCANNING");
  assert.equal(t.push({ ...good(), faceInView: true }).state, "QUALITY_WAIT", "a face in view never counts");
  assert.equal(t.push({ ...good(), quality: { warnings: ["low_light"] } }).state, "QUALITY_WAIT");
  assert.equal(t.push(good()).tentative, "banana", "a tentative label after 2 matches");
  assert.equal(t.push(good("lemon_lime")).state, "SCANNING");
  assert.equal(t.push(good()).state, "SCANNING", "only 3 of the last 6");
  assert.equal(t.push(good()).state, "SCANNING", "still 3: the oldest banana left the window");
  const fire = t.push(good());
  assert.equal(fire.state, "CANDIDATE_STABLE");
  assert.equal(fire.candidate.dishId, "banana");
  assert.ok(fire.candidate.matches >= SCAN_RULE.need);
  for (let i = 0; i < 5; i++) assert.equal(t.push(good()).state, "FROZEN", "never fires twice");
  t.reset();
  for (let i = 0; i < 3; i++) assert.equal(t.push(good()).state, "SCANNING");
  assert.equal(t.push(good()).state, "CANDIDATE_STABLE", "fires again after Retake");
  // The newest frame must itself be good: a blurry last frame doesn't freeze.
  const u = new StabilityTracker();
  for (let i = 0; i < 4; i++) u.push(good());
  assert.notEqual(u.push({ ...good(), quality: { warnings: ["low_detail_or_blur"] } }).state, "CANDIDATE_STABLE");
  assert.equal(readSample({ categories: [{ label: "not_food", score: 0.99 }], quality: { warnings: [] } }).best, null);
  assert.equal(readSample({ categories: [{ label: "orange", score: 0.9 }], quality: { warnings: [] } }).best.dishId, "orange");
  assert.equal(readSample({ categories: [{ label: "lemon_lime", score: 0.9 }], quality: { warnings: [] } }).best.dishId, null, "recognised, but no record");
});

test("screen states follow the spec; no duplicate capture; a meal is logged once", () => {
  const seen = [];
  const f = new NutritionFlow((to) => seen.push(to));
  assert.equal(f.go("RESULT"), false, "can't jump ahead");
  for (const s of ["MODE_SELECTED", "SCANNING", "QUALITY_WAIT", "CANDIDATE_STABLE", "SNAPSHOT_FROZEN"]) assert.ok(f.go(s), s);
  assert.equal(f.inferring, false, "no live inference once frozen");
  assert.equal(f.go("SNAPSHOT_FROZEN"), false, "no second capture while frozen");
  assert.ok(f.go("SCANNING"), "Retake");
  assert.equal(f.inferring, true);
  assert.ok(f.go("SNAPSHOT_FROZEN"));
  assert.equal(f.captures, 2);
  for (const s of ["FOOD_REVIEW", "QUESTIONNAIRE", "INGREDIENT_REVIEW", "CALCULATING", "RESULT"]) assert.ok(f.go(s), s);
  let writes = 0;
  const first = f.logOnce(() => (writes++, "meal-1"));
  const second = f.logOnce(() => (writes++, "meal-2"));
  assert.deepEqual([first.id, second.id, second.duplicate, writes], ["meal-1", "meal-1", true, 1]);
  assert.equal(f.state, "LOGGED");
  assert.equal(f.go("RESULT"), false, "a logged meal can't be logged again from the result");
  // Upload path and failures.
  const g = new NutritionFlow();
  for (const s of ["MODE_SELECTED", "IMAGE_SELECTED", "IMAGE_VALIDATED", "ANALYZING", "FOOD_REVIEW"]) assert.ok(g.go(s), s);
  assert.ok(canGo("SCANNING", "PERMISSION_DENIED") && canGo("PERMISSION_DENIED", "MANUAL") && canGo("ERROR", "RETRY"));
  assert.ok(canGo("RESULT", "EDIT_ANSWERS") && canGo("EDIT_ANSWERS", "CALCULATING"));
  for (const [from, tos] of Object.entries(TRANSITIONS)) for (const to of tos) assert.ok(TRANSITIONS[to], `${from} -> ${to} is a known state`);
});

test("acceptance 2: live and upload items go through the same questions and calculator", () => {
  const pairs = [["size", { choice: "medium" }], ["count", { choice: "1" }]];
  const live = fill("banana", pairs, { method: "live_scan", modelId: "m", modelVersion: "v" });
  const upload = fill("banana", pairs, { method: "upload", modelId: "m", modelVersion: "v" });
  const manual = fill("banana", pairs, { method: "manual" });
  assert.deepEqual(kcal(live), kcal(upload));
  assert.deepEqual(kcal(live), kcal(manual));
  close(kcal(live).min, (118 * 89) / 100);
  assert.equal(estimateItem(live).canonical.captureMethod, "live_scan");
  assert.equal(estimateItem(upload).canonical.captureMethod, "upload");
  assert.deepEqual(questionsFor("banana").map((q) => q.id), ["size", "count"], "two questions for a banana");
});

test("acceptance 3: foods stay separate, edit independently and are never double-counted", () => {
  const rice = fill("rice", [["form", { choice: "cooked" }], ["cooked", { choice: "grams", value: 200 }], ["prep", { choice: "plain" }]]);
  const dal = fill("dal", [["dalType", { choice: "masoor" }], ["amount", { choice: "one" }], ["oil", { choice: "none" }], ["salt", { choice: "none" }]]);
  const meal = estimateMeal([rice, dal]);
  close(meal.total.kcal.min, 260 + 116);
  assert.equal(meal.items.length, 2);
  assert.throws(() => estimateMeal([rice, rice]), /twice/);
  const dal2 = answer(dal, "amount", { choice: "two" });
  const meal2 = estimateMeal([rice, dal2]);
  close(meal2.items[0].nutrients.kcal.min, 260, 1e-6);
  close(meal2.total.kcal.min, 260 + 232);
  // The dal itself isn't counted again inside the oil or salt.
  assert.equal(estimateItem(dal).components.length, 1);
});

test("acceptance 4: freezer time never changes calories; added or factory sugar does", () => {
  const base = [["kind", { choice: "frozen_plain" }], ["grams", { choice: "grams", value: 150 }], ["sugar", { choice: "none" }]];
  const noTips = fill("strawberries", [...base, ["storageTips", { choice: "no" }]]);
  const short = fill("strawberries", [...base, ["storageTips", { choice: "yes" }], ["frozenFor", { choice: "lt1m" }], ["freezerTemp", { choice: "solid" }]]);
  const long = fill("strawberries", [...base, ["storageTips", { choice: "yes" }], ["frozenFor", { choice: "gt12m" }], ["freezerTemp", { choice: "thawed" }]]);
  assert.deepEqual(kcal(short), kcal(noTips));
  assert.deepEqual(kcal(long), kcal(noTips));
  assert.deepEqual(estimateItem(long).nutrients, estimateItem(short).nutrients);
  close(kcal(noTips).min, 1.5 * 35);
  assert.ok(storageTips(estimateItem(long).storage).length > storageTips(estimateItem(short).storage).length);
  assert.equal(storageTips(estimateItem(noTips).storage).length, 0, "no tips unless asked for");
  // The storage questions are optional and asked only on request.
  assert.equal(nextQuestion(fill("strawberries", base)).id, "storageTips");
  assert.equal(nextQuestion(noTips), null);
  const sweet = fill("strawberries", [["kind", { choice: "frozen_sweetened" }], ["grams", { choice: "grams", value: 150 }], ["sugar", { choice: "none" }]]);
  close(kcal(sweet).min, 1.5 * 96);
  const sugared = answer(noTips, "sugar", { choice: "tsp", value: 2 });
  close(kcal(sugared).min, 1.5 * 35 + (2 * 4.2 * 387) / 100);
  const unsure = answer(noTips, "sugar", { dontKnow: true });
  assert.equal(kcal(unsure).max, null, "unknown sugar -> 'at least'");
  assert.equal(estimateItem(unsure).status, "lower_bound");
});

test("acceptance 5: oil in the pot changes the curry by the person's share; ingredient changes update totals", () => {
  const dal = (tbsp) => fill("dal", [["dalType", { choice: "masoor" }], ["amount", { choice: "one" }], ["oil", { choice: "tbsp", value: tbsp }], ["salt", { choice: "tsp", value: 1 }], ["share", { value: 4, value2: 1 }]]);
  const one = kcal(dal(1)).min, three = kcal(dal(3)).min;
  close(three - one, (2 * 13.6 * 884) / 100 / 4);
  close(one, 116 + (13.6 * 884) / 100 / 4);
  // Sodium: ¼ of 6 g salt (38 800 mg/100 g) plus the lentils' own 2 mg.
  close(estimateItem(dal(1)).nutrients.sodium.min, (1.5 * 38800) / 100 + 2);
  const unknownOil = fill("dal", [["dalType", { choice: "masoor" }], ["amount", { choice: "one" }], ["oil", { dontKnow: true }], ["salt", { choice: "none" }]]);
  const r = estimateItem(unknownOil);
  assert.equal(r.status, "lower_bound");
  assert.equal(r.nutrients.kcal.max, null);
  assert.ok(r.notes.some((n) => /tablespoon/.test(n.en)));
  // Fish curry: potato and pot oil are separate components; hilsa reads as "at least".
  const fish = fill("fish_curry", [["fishType", { choice: "tilapia" }], ["fishGrams", { choice: "grams", value: 100 }], ["potato", { choice: "grams", value: 80 }], ["oil", { choice: "tbsp", value: 2 }], ["salt", { choice: "none" }], ["share", { value: 4, value2: 1 }]]);
  close(kcal(fish).min, 128 + 0.8 * 86 + (2 * 13.6 * 884) / 100 / 4);
  const hilsa = answer(fish, "fishType", { choice: "hilsa" });
  assert.equal(estimateItem(hilsa).status, "lower_bound");
  assert.ok(estimateItem(answer(fish, "fishType", { choice: "river" })).canonical.qualityFlags.includes("stand_in_record"));
  // Share question only appears when the pot had oil or salt.
  const plain = fill("dal", [["dalType", { choice: "masoor" }], ["amount", { choice: "one" }], ["oil", { choice: "none" }], ["salt", { choice: "none" }]]);
  assert.equal(nextQuestion(plain), null);
  assert.ok(!applicable(plain).some((q) => q.id === "share"));
  assert.equal(validAnswer(questionsFor("dal").find((q) => q.id === "share"), { value: 2, value2: 3 }), false, "can't eat more servings than the pot made");
});

test("acceptance 6: cooked and dry rice are never mixed", () => {
  const cooked = fill("rice", [["form", { choice: "cooked" }], ["cooked", { choice: "grams", value: 100 }], ["prep", { choice: "plain" }]]);
  const dry = fill("rice", [["form", { choice: "dry" }], ["dryGrams", { choice: "grams", value: 100 }], ["prep", { choice: "plain" }]]);
  close(kcal(cooked).min, 130);
  close(kcal(dry).min, 365);
  assert.equal(estimateItem(cooked).canonical.databaseRecordId, "fdc:168878");
  assert.equal(estimateItem(dry).canonical.databaseRecordId, "fdc:168877");
  assert.equal(estimateItem(dry).canonical.state, "dried");
  // Switching to dry drops the cooked amount instead of reusing it.
  const switched = answer(cooked, "form", { choice: "dry" });
  assert.equal(switched.answers.cooked, undefined);
  assert.equal(nextQuestion(switched).id, "dryGrams");
  const cups = fill("rice", [["form", { choice: "cooked" }], ["cooked", { choice: "cup", value: 1 }], ["prep", { choice: "plain" }]]);
  close(estimateItem(cups).canonical.edibleGrams.min, PORTIONS["rice-cooked"][0].grams);
  const fried = fill("rice", [["form", { choice: "cooked" }], ["cooked", { choice: "grams", value: 100 }], ["prep", { choice: "fried" }], ["oil", { choice: "tsp", value: 2 }]]);
  close(kcal(fried).min, 130 + (9 * 884) / 100);
  assert.equal(estimateItem(fried).nutrients.sodium, null, "salt in fried rice isn't known");
});

test("acceptance 7 and 8: unknown amounts give a range, 'at least' or 'estimate uncertain', never a made-up number", () => {
  const sizeUnknown = fill("banana", [["size", { dontKnow: true }], ["count", { choice: "1" }]]);
  const r = estimateItem(sizeUnknown);
  assert.equal(r.status, "range");
  close(r.nutrients.kcal.min, (101 * 89) / 100);
  close(r.nutrients.kcal.max, (136 * 89) / 100);
  const noGrams = fill("strawberries", [["kind", { choice: "fresh" }], ["grams", { skipped: true }], ["sugar", { choice: "none" }]]);
  const u = estimateItem(noGrams);
  assert.equal(u.status, "uncertain");
  assert.equal(u.nutrients.kcal, null);
  assert.equal(u.reference.kcal, 32, "per-100 g shown for reference");
  assert.ok(u.canonical.missingInputs.includes("amount"));
  const fish = fill("fish_curry", [["fishType", { choice: "tilapia" }], ["fishGrams", { dontKnow: true }], ["potato", { choice: "none" }], ["oil", { choice: "none" }], ["salt", { choice: "none" }]]);
  assert.equal(estimateItem(fish).status, "uncertain");
  // Name-only food: logged without numbers.
  const other = fill("other", [["whatFood", { text: "Shorshe ilish" }]]);
  assert.equal(estimateItem(other).status, "unavailable");
  const meal = estimateMeal([sizeUnknown, noGrams, other]);
  assert.equal(meal.status, "uncertain");
  assert.deepEqual(meal.counted, [sizeUnknown.uid]);
  assert.equal(meal.excluded.length, 2, "uncounted foods are listed, not added as zero");
  // "Something else" can switch to a dish's own questions.
  const switched = answer(newItem("other"), "whatFood", { dishId: "dal" });
  assert.equal(switched.dishId, "dal");
  assert.equal(nextQuestion(switched).id, "dalType");
  assert.deepEqual(searchFoods("আলু").map((x) => x.id), ["potato-boiled"]);
});

test("acceptance 10: 'energy you ate' exists only after the eaten amount is confirmed", () => {
  const b = fill("banana", [["size", { choice: "large" }], ["count", { choice: "2" }]]);
  const a = fill("apple", [["size", { choice: "small" }], ["count", { choice: "1" }]]);
  const meal = estimateMeal([b, a]);
  assert.equal(meal.eaten, null);
  assert.equal(estimateMeal([b, a], { [b.uid]: "all" }).eaten, null, "every counted food needs an answer");
  const ate = estimateMeal([b, a], { [b.uid]: "half", [a.uid]: "all" });
  close(ate.eaten.kcal.min, (2 * 136 * 89) / 100 / 2 + (149 * 52) / 100);
  close(ate.total.kcal.min, (2 * 136 * 89) / 100 + (149 * 52) / 100);
});

test("acceptance 11: every figure carries source and version ids; unknown sodium stays unknown", () => {
  const dal = fill("dal", [["dalType", { choice: "masoor" }], ["amount", { choice: "one" }], ["oil", { choice: "tbsp", value: 1 }], ["salt", { dontKnow: true }], ["share", { value: 3, value2: 1 }]]);
  const r = estimateItem(dal);
  assert.equal(r.nutrients.sodium, null);
  assert.match(r.unknownWhy.sodium.en, /salt/i);
  assert.equal(formatValue(r.nutrients.sodium, "sodium"), "unknown");
  for (const c of r.components) for (const s of c.sources) assert.ok(s.databaseRecordId && s.databaseSource && s.dataVersion && s.verification, JSON.stringify(s));
  const fields = ["foodId", "label", "databaseSource", "databaseRecordId", "state", "edibleGrams", "servingUnit", "servingCount", "recipeIngredients", "recipeTotalYieldGrams", "portionOfRecipeGrams", "addedFatGrams", "addedSugarGrams", "packagedServings", "assumptions", "missingInputs", "qualityFlags", "manualCorrections", "modelId", "modelVersion", "dataVersion", "captureMethod"];
  for (const f of fields) assert.ok(f in r.canonical, f);
  assert.deepEqual(r.canonical.recipeIngredients.map((x) => x.foodId), ["lentils-boiled", "soybean-oil"], "salt of unknown weight isn't listed with a weight");
  assert.ok(r.canonical.missingInputs.includes("salt"));
  assert.equal(r.canonical.recipeServingsMade, 3);
  close(r.canonical.addedFatGrams, 13.6 / 3);
  // Apple fibre now comes from the USDA SR Legacy CSV (2.4 g per 100 g; medium apple 182 g).
  const apple = estimateItem(fill("apple", [["size", { choice: "medium" }], ["count", { choice: "1" }]]));
  close(apple.nutrients.fiber.min, (182 * 2.4) / 100);
  assert.equal(apple.components[0].sources[0].verification, "csv_verified");
  assert.equal(apple.canonical.databaseRecordId, "fdc:171688");
  // Packaged: label values the person typed, kJ converted; sodium unknown unless entered.
  const pk = fill("packaged", [["productName", { text: "Biscuits" }], ["labelKcal", { choice: "kJ", value: 418.4 }], ["servings", { choice: "two" }], ["labelExtras", { protein: 2, sodium: 90 }]]);
  const p = estimateItem(pk);
  close(p.nutrients.kcal.min, 200);
  close(p.nutrients.sodium.min, 180);
  assert.equal(p.nutrients.fat, null);
  assert.equal(p.components[0].sources[0].databaseSource, "Package label (entered by the person)");
  const noLabel = fill("packaged", [["productName", { text: "Chips" }], ["labelKcal", { dontKnow: true }], ["servings", { choice: "one" }], ["labelExtras", { skipped: true }]]);
  assert.equal(estimateItem(noLabel).status, "unavailable", "no label value, no number from the brand");
});

test("questions: one at a time in order, I don't know / Skip / Back, corrections after a result", () => {
  const order = ["identity", "portion", "preparation", "additions", "optional"];
  for (const d of Object.keys(DISHES)) {
    const stages = questionsFor(d).map((q) => order.indexOf(q.stage));
    assert.deepEqual(stages, [...stages].sort((a, b) => a - b), `${d} asks identity, then portion, preparation, additions`);
  }
  let it = newItem("dal");
  it = answer(it, "dalType", { choice: "masoor" });
  it = answer(it, "amount", { choice: "two" });
  assert.deepEqual(progress(it), { done: 2, total: 4 });
  const b = back(it);
  assert.equal(b.question.id, "amount");
  assert.deepEqual(b.previous, { choice: "two" });
  assert.equal(nextQuestion(b.item).id, "amount");
  assert.throws(() => answer(it, "amount", { choice: "bowls", value: 99 }), /complete/);
  assert.throws(() => answer(it, "nope", {}), /Unknown question/);
  // After a result, changing an answer (directly or through "Change") is recorded.
  it = answer(answer({ ...it, calculated: true }, "oil", { choice: "none" }), "salt", { choice: "none" });
  const changed = answer(it, "amount", { choice: "one" }, Date.UTC(2026, 10, 10));
  assert.equal(changed.manualCorrections.length, 1);
  assert.deepEqual(changed.manualCorrections[0], { question: "amount", before: { choice: "two" }, after: { choice: "one" }, at: "2026-11-10T00:00:00.000Z" });
  const re = reopen(changed, "oil");
  const after = answer(re.item, "oil", { choice: "tbsp", value: 1 });
  assert.equal(after.manualCorrections.length, 2);
  assert.ok(validAnswer(questionsFor("banana")[0], { dontKnow: true }) && validAnswer(questionsFor("banana")[0], { skipped: true }));
});

test("spoons, rounding and display", () => {
  assert.equal(spoonGrams({ choice: "tbsp", value: 2 }, "oil"), 27.2);
  assert.equal(spoonGrams({ choice: "none" }, "oil"), 0);
  assert.equal(spoonGrams({ dontKnow: true }, "oil"), null);
  assert.equal(spoonGrams({ choice: "tbsp", value: 1 }, "salt"), null, "no tablespoon weight for salt in the source");
  assert.equal(approx(121.04), 120);
  assert.equal(approx(23.4), 23);
  assert.equal(formatValue({ min: 90, max: 121 }, "kcal"), "90–120 kcal");
  assert.equal(formatValue({ min: 210, max: null }, "kcal"), "at least 210 kcal");
  assert.equal(formatValue({ min: 129, max: 129 }, "kcal", "bn"), "প্রায় ১৩০ কিলোক্যালরি");
});

test("acceptance 9: photo checks use the file's own bytes, size and dimensions", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0]);
  const gif = new TextEncoder().encode("GIF89a....");
  assert.equal(sniffImageType(jpeg), "image/jpeg");
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(webp), "image/webp");
  assert.equal(sniffImageType(heic), "image/heic");
  assert.equal(sniffImageType(new TextEncoder().encode("<html>not an image")), null);
  assert.deepEqual(checkFile({ bytes: jpeg, size: 1000 }), { ok: true, type: "image/jpeg" });
  assert.equal(checkFile({ bytes: jpeg, size: 0 }).code, "empty");
  assert.equal(checkFile({ bytes: jpeg, size: 16 * 1024 * 1024 }).code, "too_big");
  assert.equal(checkFile({ bytes: new TextEncoder().encode("hello"), size: 5 }).code, "not_image");
  assert.equal(checkFile({ bytes: gif, size: 10 }).code, "gif");
  assert.equal(checkDimensions(120, 900).code, "too_small");
  assert.equal(checkDimensions(9000, 9000).code, "too_many_pixels");
  assert.equal(checkDimensions(0, 0).code, "decode_failed");
  assert.ok(checkDimensions(4032, 3024).ok);
  assert.deepEqual(fitWithin(4032, 3024), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(640, 480), { width: 640, height: 480 });
});

test("fruit added for the camera: USDA SR Legacy values and whole-fruit weights (orange, mango)", () => {
  const orange = estimateItem(fill("orange", [["size", { choice: "medium" }], ["count", { choice: "2" }]]));
  close(orange.nutrients.kcal.min, (2 * 131 * 47) / 100);
  close(orange.nutrients.fiber.min, (2 * 131 * 2.4) / 100);
  assert.equal(orange.canonical.databaseRecordId, "fdc:169097");
  const mango = estimateItem(fill("mango", [["size", { choice: "whole" }], ["count", { choice: "1" }]]));
  close(mango.nutrients.kcal.min, (336 * 60) / 100);
  assert.deepEqual(searchFoods("peyara").map((x) => x.id), ["guava-raw"]);
});
