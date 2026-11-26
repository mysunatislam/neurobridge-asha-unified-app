# Public-data validation scripts (Nutrition and Move)

Research scripts behind `docs/NUTRITION_PUBLIC_DATA_VALIDATION.md` and `docs/MOVE_PUBLIC_VIDEO_VALIDATION.md`. They were run in a scratch folder (`/tmp/w/...`); paths are hard-coded for that layout. Nothing here runs in the app.

## Nutrition (`nutrition/`)

1. `classes.py`: ASHA food classes mapped to Open Images V7 label ids.
2. `sample.py`: picks human-verified positives (cropped to the labelled box for fruit and vegetables) from the Open Images train split (training) and validation + test splits (testing), plus "not food" photos. Needs the Open Images V7 label CSVs from `storage.googleapis.com/openimages/v7/` and box CSVs.
3. `fetch.py`: downloads the images from the Open Images S3 mirror, crops and resizes them.
4. `feats.py` (old ImageNet model + MobileNetV3 embedder), `kfeats.py` (Keras EfficientNetV2-B0 / ConvNeXt-Tiny embeddings).
5. `eval1.py`: trains the logistic-regression head on train embeddings and reports test metrics. `evalcore.py`: metrics, Wilson and bootstrap intervals.
6. `export.py`: backbone + head to ONNX. `quant.py`: int8 static quantisation with 300 training photos for calibration.
7. `final_eval.py`: evaluates the first (35-class) ONNX file on the test photos, writes `docs/validation/nutrition-public-photo-results.json`.
8. Bangladeshi update (2026-11-20): `bd_feats.py` (class mapping, embeddings), `bd_split.py` (near-duplicate scenes, grouped split), `bd_train.py` (head on Open Images + Bangladeshi), `bd_export.py` (ONNX + int8), `bd_fill_thresholds.py` (per-food fill-in scores from the training-side holdout), `bd_final_eval.py` (shipped file on both test sets, writes the data behind `docs/validation/nutrition-bangladeshi-results.json`).
9. DINOv2-small update (2026-11-26): `dino_feats.py` (DINOv2-small int8 embeddings for both photo sets; it reads `onnx/model_quantized.onnx` from huggingface.co/Xenova/dinov2-small, copied to `/mnt/user-data/uploads/datasets/dinov2-small/`), then `EMB_OI=/tmp/w/nut/dino/emb_oi.npy EMB_BD=/tmp/w/nut/dino/emb_bd.npy HEAD_OUT=/tmp/w/nut/dino/head.pkl EVAL_OUT=/tmp/w/nut/dino/train_eval.json python3 bd_train.py`, `BACKBONE=dino python3 bd_fill_thresholds.py`, `dino_export.py` (one ONNX with input scaling, pooling and head), `BACKBONE=dino python3 bd_final_eval.py` (data behind `docs/validation/nutrition-dinov2-results.json`).
10. `scripts/verify-nutrition-records-csv.mjs` (in the repo's scripts folder) checks every food record against the USDA SR Legacy CSV download.

## Move (`move/`)

1. `extract.py`: MediaPipe Pose Landmarker Lite (the app's model and options) on Kinetics-700 clips that have Countix counts, at 15 fps.
2. `grid.mjs`: loads the app's `detectors.js` (optionally patched) and scores counted vs true reps.
3. `tune3.mjs`, `tune4.mjs`: threshold and timing searches on Countix train clips.
4. `final.mjs`: before/after on held-out clips and false counts on other exercises; writes `docs/validation/move-public-video-results.json`.
5. `robust.mjs`: mirror, slow movement, low frame rate, landmark noise and missed frames on the held-out clips (`DETECTORS=<file>` to test another version); data behind `docs/validation/move-robustness-results.json`.
