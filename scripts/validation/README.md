# Public-data validation harness

Results and caveats: `docs/validation/PUBLIC_DATA_VALIDATION.md`.

1. Put the datasets in a folder (default `../validation-data` next to the repo, or set
   `VALIDATION_DATA`): `SubhiH_HandsDataset/` (git clone of SubhiH/HandsDataset),
   `rps/rps_data_sample/` (storage.googleapis.com/mediapipe-tasks/gesture_recognizer/rps_data_sample.zip),
   `genki/GENKI-R2009a/` (GENKI-R2009a with GENKI-4K).
2. `node scripts/validation/server.mjs` (serves the app's models and the data on :8765).
3. Make a list of image URLs (`http://127.0.0.1:8765/data/...`, one per line) and run
   `node scripts/validation/run.mjs hand image hands.list hands.jsonl` (or `face`). It saves
   landmarks per image and resumes if stopped.
4. From the folder holding the `.jsonl` files: `node scripts/validation/final-hands.mjs`,
   `eval-genki.mjs`, `tune-stretch.mjs`, `cond-genki.mjs` (after `python3 cond.py genki.jsonl genki.list genki-cond.json`).

`eval-gaze.mjs` (MPIIFaceGaze) and `lib/blink.mjs` (Eyeblink8 / TalkingFace) are ready for the eye
datasets.
