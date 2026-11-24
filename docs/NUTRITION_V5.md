# ASHA Nutrition V5: live scan, photo upload, adaptive questions, sourced estimate

Dashboard route: `/dashboard/patient/nutrition` (Wellbeing › Nutrition, and a card on the patient home). Bangla and English throughout. Data version `asha-nutrition-v5/2026-11-10`, calculator `asha-nutrition-engine/1.0.0`.

**What this is not:** ASHA does not recognise meals from photos. The camera model is a general ImageNet classifier that is not trained on food. ASHA uses it only to *suggest* banana, apple or strawberries, always labelled experimental, and the person confirms or removes the suggestion. Every other food is chosen by the person from a list. Calories come from USDA food records and the person's answers, never from the picture.

## Flow

`Home › Nutrition › Scan food live | Upload a photo | Enter food without a photo › check the foods › a few questions › check answers › estimate › log, improve, discard or ask ASHA`

| Step | What happens |
| --- | --- |
| Scan food live | The back camera opens only after the tap (`facingMode: environment`, its own stream). Frames are sampled about every 400 ms, never on the main thread: a worker classifies the centre square (the viewfinder box, 224 px), checks light and blur on it, and looks for faces in the frame. A small "Possible: Banana · experimental" label can appear. No calories are shown while scanning. |
| Steady freeze | Starting rule from the spec (to be tuned on real data): the same suggestion in **4 of the last 6** sampled frames, with the newest frame itself usable (no quality warning, no face). It fires once, the video pauses, and sampling stops until Retake. Retake re-arms it; **Continue scanning** resumes with automatic freeze off for that try; the round shutter button always captures by hand; a switch turns automatic freeze off altogether (remembered). |
| Upload a photo | The file's first bytes decide its type (JPEG, PNG, WebP, HEIC; GIF refused). Over 15 MB, under 160 px, or over 40 megapixels is refused with a plain message. The image is decoded with EXIF rotation applied and redrawn onto a canvas of at most 1280 px, so location, camera and time metadata are left behind. Rotate left/right and a centre crop are offered. |
| Same pipeline | The frozen live frame, a manual shutter photo and an upload all go through one function (`analyzeStill`) and the same worker message; their foods then go through the same questions and calculator. |
| Check the foods | Each food is its own chip: "Camera suggestion (experimental, score 0.81, not a probability)" or "Added by you". Remove any; add rice, dal, fish curry, banana, apple, strawberries, a packaged food or something else. A plate of rice, dal and fish curry is three foods, each counted once. |
| Questions | One at a time with a progress bar, large buttons, "I don't know", "Skip", "Back: edit previous answer" and "Read aloud". Order: identity, portion, preparation, additions, optional. Only questions that change the estimate are asked (two for a banana). |
| Check answers | Every answer listed with "Change". |
| Estimate | Meal total with its status, per-food cards (energy, protein, fat, carbohydrate, fibre, sodium, each "unknown" where not known, with the reason), "Where these numbers come from" (record, FDC link, data version, verification status, your share of the pot), "What ASHA assumed", and optional storage tips. |
| Energy you ate | Shown only after the person says how much of each food they ate (all, most, half, a little, none, or "I ate all of it"). Logging needs this answer, so a log never says "you ate X" unconfirmed. |
| Log | Written once (double taps and retries can't write twice), on this device only, with every canonical field, source id and answer. No photo is stored. Export as JSON, delete one, or delete all from the meal log. |
| Last 7 days | A bar per local calendar day above the meal log: dark to the lowest estimate of energy eaten, light up to the highest. A day with an "at least" meal gets a dashed top, and a meal without an energy estimate is listed as unknown in the tooltip, never added as zero (`src/features/nutrition/week.js`, Recharts, 4 tests). Drawn from the local log only. |
| Ask ASHA about this meal | Opens Talk to Asha with a question about this estimate typed in. Nothing is sent until the person presses Send, and the existing cloud consent applies. |

## Questions by food

| Food | Questions (in order) | Never asked or claimed |
| --- | --- | --- |
| Banana, apple | Size (USDA small/medium/large with grams, or a weight) · how many | No added-sugar or dish questions for a plain fruit |
| Strawberries | Fresh / frozen plain / frozen with sugar or syrup · grams · added sugar · optional: storage tips? (then how long frozen, stayed frozen solid?) | Freezer time never changes the calories; no spoilage judgement from a photo |
| Rice | Cooked amount on the plate or dry weight before cooking · cups (1 cup = 158 g, USDA) or grams / dry grams · plain or with oil/ghee · oil in the portion | Cooked and dry rice use different records and are never mixed |
| Dal | Masoor or another dal · bowls (1 bowl = 100 g boiled lentils, ASHA's stated template) or grams · oil in the whole pot · salt in the whole pot · servings in the pot and yours (only if oil or salt) | No salt guessed from the picture |
| Fish curry | Fish type (tilapia; rui/katla; ilish; other) · fish grams without bones · potato · oil in the pot · salt in the pot · servings | Oil absorption not inferred; other fish are counted with tilapia and marked |
| Packaged food | Product name · energy per serving from the label (kcal or kJ) · servings · optional label protein, fat, carbohydrate, sodium, serving size | Nothing inferred from the brand or logo |
| Something else | Search ASHA's foods (or pick a dish, which switches to its questions) · grams. Or keep a name only. | No invented food identity or numbers |

## Calculator

Per component: `grams × value_per_100 g / 100`, from the record matching the food's state. Shared pots: `pot grams × servings you had / servings in the pot`. Packaged: `label value × servings`. Each value is a range `{min, max}`:

| Status | When | Shown as |
| --- | --- | --- |
| Estimate | Every needed answer known | "about 120 kcal" (nearest 5 kcal above 50) |
| Range | An answer is bounded by sourced data, e.g. banana size unknown (USDA small to large) or strawberries' sugar unknown (plain to sweetened record) | "90–120 kcal" |
| At least | Something that adds energy is there but its amount isn't known (pot oil, sugar, potato, number of pieces), or ilish counted as tilapia | "at least 210 kcal", with "each tablespoon in the pot adds about N kcal to your share" |
| Estimate uncertain | The main amount is unknown | No number; the per-100 g value is shown for reference |
| No estimate | No record (name only) or no label energy | No number |

A meal whose foods can't all be counted shows "Estimate uncertain" and, separately, what the counted foods come to; the uncounted foods are listed, never added as zero. Unknown nutrients stay `null` and display "unknown": sodium when salt is unknown, fibre for the five records not yet re-verified, label nutrients not entered. There is no "accuracy" figure anywhere because none has been measured.

Canonical item fields (spec §4), stored in each log entry: `foodId, label, databaseSource, databaseRecordId, state, edibleGrams, servingUnit, servingCount, recipeIngredients[{foodId, grams, potGrams, scope, state, kcalPer100g, sourceId}], recipeTotalYieldGrams, portionOfRecipeGrams, recipeServingsMade, recipeServingsEaten, addedFatGrams, addedSugarGrams, packagedServings, assumptions[], missingInputs[], qualityFlags[], manualCorrections[], modelId, modelVersion, dataVersion, engineVersion, captureMethod`. Two deliberate differences: ingredient weights are `grams` in the record's own state (boiled lentils are weighed boiled), not `rawGrams`; and shared pots are divided by servings, which people know, so `recipeTotalYieldGrams` and `portionOfRecipeGrams` stay `null` unless a pot weight is ever asked.

## Screen states (spec §6)

`src/features/nutrition/state.js` holds the transition table: `IDLE → MODE_SELECTED → (SCANNING | IMAGE_SELECTED)`, `SCANNING ↔ QUALITY_WAIT → CANDIDATE_STABLE → SNAPSHOT_FROZEN`, `IMAGE_SELECTED → IMAGE_VALIDATED → ANALYZING`, `SNAPSHOT_FROZEN | ANALYZING → FOOD_REVIEW → QUESTIONNAIRE → INGREDIENT_REVIEW → CALCULATING → RESULT → EDIT_ANSWERS | LOGGED | DISCARDED`, and any capture state `→ ERROR | PERMISSION_DENIED → RETRY | MANUAL`. A move that isn't in the table is refused, so a second freeze while frozen, a late worker result after Retake (dropped by an epoch counter) or a second log can't happen. Live inference runs only in `SCANNING` and `QUALITY_WAIT`.

Camera release: the stream stops when the photo is confirmed, on manual entry, cancel, discard, log, start-over, when the page is hidden (scanning returns to the start with a note), on `pagehide`, and on leaving Nutrition. If the shared front camera (used for face and hand requests) was on, it pauses while scanning and comes back when Nutrition's own camera stops.

## On-device model

| Item | Value |
| --- | --- |
| Model | MediaPipe Image Classifier EfficientNet-Lite0 int8, `public/models/efficientnet_lite0_int8.tflite`, 5,434,517 bytes, SHA-256 `bc2ffe19c1118de0c0c2a9088992da5589722656e0fba81421385300a4a34b16`, published 2023-04-26, downloaded 2026-11-10 from `storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/latest/` |
| Licence | Apache-2.0, stated in the model's embedded metadata. ImageNet-1k classes. Not a food model. |
| Classes used | `banana` → banana, `Granny Smith` → apple, `strawberry` → strawberries, score ≥ 0.3. All other classes give no suggestion. |
| Face check | The already shipped MediaPipe Face Landmarker (3.76 MB), image mode, up to 3 faces, on a 640 px copy of the frame. |
| Worker | `public/engine/food-classifier-worker.js`, CPU (WASM) delegate, one image at a time, ImageBitmaps transferred and closed. A call over 3 s (live) or 20 s (still) is treated as "no suggestion"; two slow calls show "Suggestions are slow on this phone". If the worker can't load, scanning still works with the shutter and the person picks the foods. |
| First load | About 9.2 MB of models (classifier + face), cached by the browser afterwards. |

Measured with `node scripts/nutrition-vision-check.mjs <folder>` on 2026-11-10 (cloud container, 4-core Xeon 2.1 GHz, headless Chromium 153, CPU delegate; **not a phone**). Worker ready in about 1.1–1.2 s. Per still (classify + quality + face check), median of 6: 37–62 ms, first call up to 190 ms.

| Photo | Top labels | ASHA suggestion | Faces |
| --- | --- | --- | --- |
| ImageNet sample, banana | banana 0.88 | banana | 0 |
| ImageNet sample, Granny Smith | Granny Smith 0.86 | apple | 0 |
| ImageNet sample, strawberry | strawberry 0.94 | strawberries | 0 |
| MediaPipe test photo, burger | cheeseburger 0.93 | none | 0 |
| OpenCV sample, mixed fruit | lemon 0.55, orange 0.38 | none | 0 |
| MediaPipe test photo, portrait | suit 0.70 | none | 1 |
| MediaPipe test photo, full-height person | suit 0.50 | none | 0 (face too small to detect) |

The three fruit photos are ImageNet samples, which this model was trained on, so they show the pipeline works and nothing about accuracy on real meals. They are not committed (ImageNet terms). The face check misses small or distant faces.

## Tests

- `node --test tests/nutrition-v5.test.mjs` (15 tests, part of `npm test`): records and sources; the three-label mapping; the 4-of-6 rule, firing once and re-arming; the state table, no second capture, one log write; acceptance items 2–8, 10 and 11 with hand-worked numbers; question order, "I don't know", "Skip", "Back", corrections after a result; spoon weights and display rounding; file type, size and dimension checks.
- `node tests/nutrition-browser.mjs` (dev server running): a canvas camera and a stand-in worker with scripted labels.
  1. Live: a face in view blocks the freeze; a steady banana freezes once and live inference stops; Retake re-arms; Continue scanning never freezes by itself; the shutter captures; the camera is released on confirm; Back restores the earlier answer; 136 g banana → "about 120 kcal"; logging is blocked until the eaten amount is given; a double tap logs once; the log holds `fdc:173944`, the model id, the capture method and no photo; "Ask ASHA" prefills the assistant.
  2. Upload: rotation changes the working copy; no suggestion, no invented food; rice + dal + fish curry kept separate (205 + 175 + 160 → about 540 kcal); dal salt unknown → meal sodium "unknown"; raising dal pot oil from 2 to 4 tbsp moves only the dal (175 → 235 kcal) and is kept as a correction; eating half the rice lowers "energy you ate".
  3. Bad files: text renamed .jpg, HEIC Chromium can't decode, 16 MB, 120 px; manual entry from the error; packaged food from a kJ label (418 kJ × 2 → about 200 kcal, sodium unknown); Discard saves nothing.
  4. Bangla at 390 px with camera permission refused: manual entry, Bangla search "আলু", 150 g → "প্রায় ১৩০ কিলোক্যালরি"; frozen strawberries with unknown grams → "অনুমান অনিশ্চিত"; no horizontal overflow on any screen.

## Acceptance tests (spec §9)

| # | Status |
| --- | --- |
| 1 Freeze once, inference paused, Retake resumes | Done (unit + browser) |
| 2 Upload and live share one pipeline | Done (one `analyzeStill`, same questions and calculator; unit test) |
| 3 Multiple foods separate, editable, not double-counted | Done |
| 4 Freezer time doesn't change kcal; sugar does | Done |
| 5 Curry oil and ingredient changes update totals | Done |
| 6 Cooked vs dry rice never mixed | Done |
| 7 Unknown size → size question or clearly uncertain | Done (range from USDA sizes, or "Estimate uncertain") |
| 8 Low confidence → manual correction, nothing fabricated | Done (only three labels can suggest; everything is confirmable and removable) |
| 9 Blank/low light/permission/HEIC/huge/offline/slow | Low light, blur, face, permission, HEIC, huge, tiny, invalid and slow are handled and tested. A blank frame gets no suggestion (it can't pass 4-of-6). **Offline**: works once the models are cached; a first visit offline gets no suggestions, and manual entry and upload still work. Not tested on a phone. |
| 10 No "you consumed X" until eaten amount confirmed | Done |
| 11 Source/version ids on every figure; unknown sodium stays unknown | Done |
| 12 Validation against weighed meals, MAE/MAPE, device cost | **Not done.** No weighed-meal data, no phones measured. No accuracy figure is claimed. |
| 13 Camera respects choices, ends on exit, nothing uploaded | Done (no network call carries images; camera stops on every exit path) |
| 14 B2B consent and tenant isolation | **Not implemented.** Logs stay on the device; there is no clinician view of nutrition logs yet, so nothing is shared. |

## Gaps and blockers

- **No food-trained model.** Bangladeshi dishes, mixed plates and portions are not recognised; there is no segmentation. Needs a licensed, Bangladesh-focused dataset, a fine-tuned model and an evaluation before any of it can be switched on.
- **USDA API blocked here.** The five new records (apple, three strawberry records, dry rice) and the new portion weights were transcribed from two published copies of the USDA data that agree, and are marked `cross_checked` with fibre unknown. Run `FDC_API_KEY=… node scripts/verify-nutrition-records.mjs` where `api.nal.usda.gov` is reachable, then mark them `api_verified`.
- **FAO/INFOODS Bangladesh table** not imported: reuse terms are not confirmed (see `NUTRITION_SOURCES.md`).
- **HEIC** opens only where the browser can decode it (Safari). Elsewhere the person is told how to switch the iPhone camera to "Most Compatible". No HEIC decoder is bundled.
- Not built: second side-view photo, barcode or label scanning, beverages, remembered preferences, clinician review of logs.
- Phones, battery, heat and real-world camera conditions are unmeasured.
