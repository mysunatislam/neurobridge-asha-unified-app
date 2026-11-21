# Nutrition food recognition: public-photo validation (2026-11-19, updated 2026-11-20)

This is a "virtual" validation on openly licensed public photos, done before real volunteers. It is **not clinical validation** and it says nothing yet about Bangladeshi home meals, real phone cameras or real lighting. All numbers below come from `docs/validation/nutrition-public-photo-results.json` and can be re-run with `scripts/public-data-validation/nutrition/`.

## Update 2026-11-20: Bangladeshi dishes, USDA records, per-food fill-in

**Shipped model now:** `public/models/asha-food-66-int8.onnx` (7,162,275 bytes, sha256 `5c304684…44ef53`, checked by a unit test). Same EfficientNetV2-B0 backbone; the head was retrained on Open Images train photos **plus** two Bangladeshi photo sets, for **65 foods + "not food"**, 31 of them new Bangladeshi dishes. Results: `docs/validation/nutrition-bangladeshi-results.json`; scripts `scripts/public-data-validation/nutrition/bd_*.py`.

**Bangladeshi data.** BD-Food33 (CC0, 1,236 photos, 33 dishes) and Bangladeshi Street Food (CC BY 4.0, 476 photos, 18 foods), downloaded on the team PC and copied in. Many photos are burst shots of the same plate, so photos whose embeddings are ≥ 0.95 similar were grouped into one "scene", and **a scene never sits on both sides of the split** (1,673 photos, 1,367 scenes). 30% of each dish's scenes are held out for testing (456 photos, 409 scenes). Dishes with fewer than 8 scenes were left out (peanuts, chotpoti, seafood, ice cream, puri, juice). Same-food classes were merged (fuchka/fuska, singara/somusha, Bhapa/Puli pitha, Shami/Tikka/street kabab); rice, tea, pizza, burger and chowmein photos joined the existing classes.

**Training without peeking.** The regularisation and the weight of Bangladeshi photos were picked on a holdout from the training side only (20% of Open Images train, 25% of Bangladeshi training scenes); each burst counts once in total.

| Held-out set | Previous 35-class model | New 66-class model (int8, shipped) |
| --- | --- | --- |
| Bangladeshi photos (456), top-1 | 16.0% (12.9–19.7) | **82.7%** (78.9–85.9) |
| Bangladeshi, one photo per scene (409), top-1 | – | 80.9% (76.8–84.4) |
| Bangladeshi, top-5 | – | 97.1% |
| Open Images photos (4,951), top-1 | 77.2% (76.0–78.3) | 75.9% (74.7–77.1) |
| Open Images, top-5 | 96.8% | 95.4% |
| Oranges suggested as apple | 0 of 186 | 0 of 186 |

The float model scores 84.2% (Bangladeshi) and 76.9% (Open Images); int8 costs about 1 point. Adding 31 dishes cost about 1.3 points on the Western photos.

Bangladeshi dishes, held-out photos (recall 95% CI in brackets; small n, so wide intervals):

| Dish | n | Precision | Recall | Most often confused with |
| --- | ---: | ---: | --- | --- |
| rice | 12 | 63% | 100% (76–100) | – |
| fish curry (shorshe ilish) | 10 | 100% | 100% (72–100) | – |
| egg curry | 9 | 60% | 100% (70–100) | – |
| moglai paratha | 20 | 100% | 100% (84–100) | – |
| haleem | 8 | 100% | 100% (68–100) | – |
| rasmalai | 10 | 91% | 100% (72–100) | – |
| jhalmuri | 15 | 88% | 93% (70–99) | salad 1 |
| tea | 14 | 100% | 86% (60–96) | curry 1, rasmalai 1 |
| fried fish | 12 | 83% | 83% (55–95) | curry 1, mutton roast 1 |
| polao | 10 | 100% | 80% (49–94) | omelette 1, rice 1 |
| pitha | 20 | 76% | 80% (58–92) | potato 1, onion 1 |
| fuchka | 15 | 86% | 80% (55–93) | rice 1, noodles 1 |
| paratha | 9 | 88% | 78% (45–94) | omelette 1, rice 1 |
| singara / samosa | 22 | 94% | 73% (52–87) | fuchka 1, shawarma 1 |
| kabab | 36 | 96% | 72% (56–84) | peyaju 4, prawn curry 2 |
| chicken curry | 7 | 40% | 57% (25–84) | dal 1, salad 1 |
| bhorta | 9 | 83% | 56% (27–81) | salad 2, potato 1 |
| chomchom | 10 | 100% | 50% (24–76) | bhorta 1, bread 1 |
| dal | 14 | 83% | **36%** (16–61) | egg curry 3, chilli 1 |
| prawn curry | 9 | 60% | **33%** (12–65) | chicken curry 4, egg curry 2 |

All 36 classes are in the JSON. The weak spot is **curries that look alike** (dal, chicken, prawn and egg curry): yellow-brown gravy in a bowl.

**Per-food fill-in.** A flat 0.5 score filled in too many wrong foods once more foods had records (oranges were filled in wrongly as often as rightly, because of grapefruit/pomelo). Each food now has its own threshold, chosen on the training-side holdout as the lowest score where at least 90% of fill-ins were right: banana, strawberry, pear, pomegranate, dal and fish curry 0.5; tomato 0.6; apple 0.75; rice 0.85; peach 0.9. **Orange never reached 90%**, so it is named ("Looks like: Orange (or malta)", with a one-tap "+ Orange or malta" button) but never filled in. Below its threshold, any food is named, not added.

| What the app fills in by itself | Previous app | Now |
| --- | --- | --- |
| Open Images test photos: right / wrong | 370 / 33 (91.8% right) | **565 / 55** (91.1% right) |
| Bangladeshi test photos: right / wrong | 11 / 12 (it called many Bangladeshi dishes "rice") | **23 / 0** (rice 10, fish curry 9, dal 4) |

**USDA records.** The SR Legacy CSV download (April 2018, CC0) was copied in from the team PC. `scripts/verify-nutrition-records-csv.mjs` checks every record, portion and spoon weight value by value: **187 of 187 match**. The five records that were only "cross-checked" now say "checked against the USDA download" and have fibre filled in. Seven fruit records were added with USDA portion weights: orange/malta, pear, peach, pomegranate, raw tomato, mango and guava (mango and guava because they are common in Bangladesh; the camera does not recognise them yet). The FoodData Central API itself is still blocked here, so nothing says "API checked".

**Browser parity.** `tests/nutrition-real-model-browser.mjs` on 80 held-out photos (40 Open Images, 40 Bangladeshi): the browser worker gave the same best guess as Python on 77 of 80; median 74 ms, p95 119 ms per photo on a cloud CPU; model load 2.1 s.

**Still not known:** volunteers' own phone photos, mixed plates (bhat + dal + bhorta in one photo; the model names one food), lighting in Bangladeshi kitchens, and portion size. The Bangladeshi sets are small (about 20–80 photos per dish) and scraped from the web, so per-dish numbers have wide intervals.

## First version (2026-11-19, 35 classes; replaced by the update above)

### The orange-detected-as-apple bug

The old camera path used a general ImageNet model (EfficientNet-Lite0) and kept only three of its 1,000 labels: `banana`, `strawberry` and `Granny Smith` (turned into "apple"). Every other label was skipped, so when a photo's best label was `orange` and a lower label was `Granny Smith` at 0.3 or more, the app suggested **apple**. Greenish citrus (malta) makes that more likely. On public photos, the old model's best label for oranges was `orange` 98 times out of 186 and `lemon` 57 times, but the app could never say either.

Fix, in `src/features/nutrition/scan.js`: only the model's **single best guess** can become a suggestion, only when it scores at least 0.5, and never "not food". A best guess without a nutrition record is named on screen ("Looks like: Orange (or malta)") but nothing is added and no numbers are made up. Unit and browser tests cover the exact orange-over-apple case.

### The new recogniser

| Item | Value |
| --- | --- |
| Model | EfficientNetV2-B0 (Keras Applications ImageNet weights, Apache-2.0) + a logistic-regression head trained by ASHA, exported to ONNX and quantised to int8 |
| File | `public/models/asha-food-35-int8.onnx`, 7,122,072 bytes, sha256 `c00a37df…cb31a` (checked by a unit test) |
| Runtime | onnxruntime-web 1.22.0 WASM in `public/engine/food-classifier-worker.js`, on the device; photos are never uploaded |
| Classes | 34 foods + "not food": apple, banana, bell pepper, bread, cabbage, cake, carrot, cauliflower, chilli, cucumber, curry, grapes, grapefruit/pomelo, burger, lemon/lime, milk, noodles, omelette, onion, orange, peach, pear, pineapple, pizza, pomegranate, potato, pumpkin, rice, salad, sandwich, strawberry, tea, tomato, watermelon |
| Foods ASHA can log with sourced numbers | apple, banana, strawberries, rice (the others are named only, until USDA records are added) |

Backbones compared with the same head on the same split (top-1 on the test set): MediaPipe MobileNetV3-Large embedder 76.8%, ConvNeXt-Tiny 77.2%, **EfficientNetV2-B0 78.2% (float) / 77.2% (int8, shipped)**. DINOv2-small was downloaded but could not be moved into the build environment, so it is untested.

### Data

- **Open Images V7** (images CC BY 2.0, labels CC BY 4.0), human-verified image labels. Fruit and vegetable photos are cropped to their labelled box (+15% margin), like a person pointing the camera at one item; dishes use the whole photo with only one target food label. "Not food" = random photos with no food label.
- Train: Open Images *train* split, up to 300 per class (7,532 images). Test: Open Images *validation + test* splits, up to 300 per class (**4,951 images**), never seen in training. The head's regularisation was picked on a holdout from the training split only.
- Preprocessing matches the app: the centre 80% square, resized to 224 × 224.
- 505 of 13,377 sampled images could not be downloaded and were left out.

### Results (35-class int8 model, 4,951 held-out photos)

| Metric | Value (95% CI) |
| --- | --- |
| Top-1 accuracy, 35 classes | **77.2%** (76.0–78.3, Wilson; bootstrap 76.1–78.3) |
| Top-5 accuracy | **96.8%** (96.2–97.2) |
| Macro-average recall | 78.5% |
| Top-1 with orange and grapefruit/pomelo counted as one "citrus" class | 79.8% (78.6–80.9); citrus recall 80.5% (75.9–84.3) |
| Oranges suggested as apple | **0 of 186** (old app: 1 of 186; the old app suggested nothing at all for 185) |
| Apples recognised as orange | 1 of 178 |
| Float vs int8 | 78.2% vs 77.2% top-1 |

When the best guess is confident, it is right more often (top-1 accuracy among photos above each score):

| Score at least | Share of photos | Accuracy |
| --- | --- | --- |
| 0.5 (ASHA's threshold) | 83.4% | 84.1% (82.9–85.2) |
| 0.6 | 74.8% | 87.0% |
| 0.7 | 65.4% | 89.8% |
| 0.8 | 56.2% | 92.2% |
| 0.9 | 43.2% | 95.2% |

**What the app actually does**, old vs new, on the same 4,951 photos:

| | Old app | New app |
| --- | --- | --- |
| A correct food filled in | 217 (4.4%) | 370 (7.4%) |
| A wrong food filled in | 28 (0.6%) | 33 (0.7%) |
| Of the foods filled in, correct | 88.6% | 91.8% (88.7–94.1) |
| Apple / banana / strawberry / rice filled in correctly | 47% / 75% / 41% / 0% | 58% / 82% / 84% / 42% |
| Foods named for the person (no numbers) | 0 | 30 more foods |

Per-class precision and recall (recall 95% CI in brackets) and the two most common mistakes:

| Class | n | Precision | Recall | F1 | Most often confused with |
| --- | ---: | ---: | --- | ---: | --- |
| pomegranate | 50 | 91% | 98% (90–100) | 0.94 | apple 1 |
| milk | 44 | 57% | 98% (88–100) | 0.72 | onion 1 |
| pizza | 223 | 87% | 97% (94–98) | 0.92 | bread 2, omelette 2 |
| pineapple | 61 | 98% | 97% (89–99) | 0.98 | milk 1, potato 1 |
| grape | 107 | 86% | 95% (90–98) | 0.90 | apple 2, chili 1 |
| noodles | 142 | 82% | 94% (88–97) | 0.87 | salad 3, curry 2 |
| pumpkin | 99 | 97% | 92% (85–96) | 0.94 | watermelon 3 |
| carrot | 91 | 85% | 90% (82–95) | 0.87 | potato 3, tomato 2 |
| strawberry | 185 | 88% | 89% (84–93) | 0.89 | tomato 6, cake 4 |
| tea | 218 | 97% | 89% (84–92) | 0.93 | milk 10, cake 6 |
| cucumber | 124 | 83% | 86% (79–91) | 0.85 | watermelon 4, salad 2 |
| bell pepper | 92 | 73% | 85% (76–91) | 0.78 | chili 8, cucumber 2 |
| potato | 81 | 51% | 84% (74–90) | 0.64 | bread 3, curry 2 |
| banana | 79 | 88% | 84% (74–90) | 0.86 | potato 4, onion 2 |
| lemon/lime | 220 | 77% | 83% (78–88) | 0.80 | orange 18, grapefruit 7 |
| cake | 299 | 83% | 82% (77–86) | 0.83 | omelette 10, sandwich 9 |
| omelette | 27 | 40% | 81% (63–92) | 0.54 | rice 2, noodles 1 |
| watermelon | 97 | 80% | 80% (71–87) | 0.80 | cucumber 5, strawberry 2 |
| salad | 81 | 51% | 79% (69–86) | 0.62 | onion 5, cauliflower 2 |
| pear | 49 | 76% | 78% (64–87) | 0.77 | potato 5, apple 3 |
| tomato | 217 | 86% | 77% (71–82) | 0.82 | salad 15, bell pepper 7 |
| peach | 56 | 59% | 77% (64–86) | 0.67 | apple 10, orange 2 |
| sandwich | 202 | 58% | 73% (67–79) | 0.64 | hamburger 17, salad 8 |
| not food | 594 | 98% | 73% (70–77) | 0.84 | onion 39, cake 20 |
| apple | 178 | 84% | 72% (65–79) | 0.78 | peach 17, tomato 6 |
| cabbage | 79 | 82% | 71% (60–80) | 0.76 | salad 14, onion 4 |
| chili | 109 | 65% | 71% (62–78) | 0.68 | bell pepper 18, cucumber 5 |
| bread | 299 | 87% | 70% (64–75) | 0.77 | sandwich 27, potato 22 |
| hamburger | 230 | 89% | 69% (63–75) | 0.78 | sandwich 60, potato 4 |
| onion | 98 | 48% | 68% (59–77) | 0.56 | salad 7, noodles 3 |
| cauliflower | 27 | 72% | 67% (48–81) | 0.69 | cabbage 5, rice 2 |
| curry | 40 | 44% | 60% (45–74) | 0.51 | rice 6, pizza 3 |
| rice | 110 | 70% | 56% (47–65) | 0.62 | curry 16, noodles 9 |
| orange | 186 | 50% | 47% (40–54) | 0.48 | grapefruit/pomelo 69, lemon/lime 15 |
| grapefruit/pomelo | 157 | 40% | 35% (28–43) | 0.38 | orange 60, lemon/lime 31 |

Confusion matrix: `docs/validation/nutrition-confusion-matrix.png`.

**Browser parity.** `tests/nutrition-real-model-browser.mjs` runs the real worker and model in headless Chromium on 70 held-out photos: same best guess as the Python evaluation on 68 of 70 (the two differ only through image resizing), median 53 ms and p95 77 ms per photo on a 4-core cloud CPU, model load 1.4 s. Phone timings are not measured yet.

### Limits, said plainly

- Open Images photos are mostly Western, well lit and taken by enthusiasts. Accuracy on Bangladeshi plates (bhat with dal, bhorta, mixed curries) is **unknown**; "rice" and "curry" are the weakest food classes here (56% and 60% recall) and they matter most for Bangladesh.
- Orange vs grapefruit/pomelo is the biggest confusion; Open Images labels for these are themselves inconsistent. Neither has a nutrition record yet, so the mistake only changes the name shown.
- Only 4 of the 34 foods have USDA nutrition records in ASHA. The rest are named, never given numbers.
- Scores are softmax outputs of a linear head, not calibrated probabilities.
- Bangladeshi datasets BD-Food33 (CC0) and Bangladeshi Street Food (CC BY 4.0), the USDA SR Legacy CSV bundle and DINOv2-small were downloaded to the team PC but could not be transferred into the build environment in this session. Next step: add Bangladeshi dishes as classes, add USDA records for the new foods (orange, lemon, potato, tomato, egg…), and test on volunteers' own phone photos.
