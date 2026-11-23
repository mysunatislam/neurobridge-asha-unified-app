# Public-data validation (virtual, no volunteers)

Asha's own detection code was run headlessly on labelled public research data. This is an
engineering check of the detectors on strangers' faces and hands. It is **not clinical
validation**: nobody in these datasets has the conditions Asha is built for, nobody used the
app, and the labels describe images, not a person's intent. Results with intended users are
still needed (see `docs/VALIDATION_PLAN.md`).

Run 2026-11-19/20 from branch `claude/project-thread-ys3ehz`. Scripts: `scripts/validation/`.
Images are not in the repository; each set's licence asks for research use and citation.

## How it was run

- `scripts/validation/run.mjs` loads the app's bundled MediaPipe models
  (`public/neuroface/models/face_landmarker.task`, `hand_landmarker.task`) in headless Chromium
  with the same detector options as `public/engine/vision-worker.js`, CPU delegate, one image at
  a time, and saves the landmarks.
- The evaluation scripts load the app's own files unchanged (`public/neuroface/utils/metrics.js`,
  `src/vision.js` feature extractor, `fingerspeak-signal.js`, `public/engine/*`) and score them.
- Intervals are 95%: Wilson for proportions, bootstrap (2,000 resamples) otherwise.
- Every tuned value was chosen on one part of the data and reported on a part it never saw.

## Data

| Set | What it is | Labels used | Licence |
| --- | --- | --- | --- |
| HandsDataset (SubhiH, GitHub) | 2,048 photos, 1–2 hands, indoor and outdoor, 800×600 | hand box + number of open fingers (0–5) | Apache-2.0 |
| MediaPipe RPS sample (Google, gesture recognizer tutorial) | 500 photos: rock, paper, scissors, none | class | Google sample for the MediaPipe Model Maker tutorial; no licence file in the archive |
| GENKI-4K (UCSD MPLab) | 4,000 face photos from the web, many people, lights and cameras | smile / no smile, head yaw, pitch, roll | research use with citation |

| MPIIFaceGaze (MPI Informatics, via DaRUS doi 10.18419/darus-3240) | 15 people, first 250 laptop-webcam photos each, taken during everyday laptop use | where on the screen the person was looking | CC BY-NC-SA 4.0 |
| Eyeblink8 and TalkingFace (blinkingmatters.com) | 9 videos with every blink marked frame by frame | blink start and end frames | GPL-3.0 per the site |

The eye sets were run on the project's own computer (`scripts/validation/eyes-pc.mjs`), because the
cloud could not reach them. Only numbers left that computer.

## FingerSpeak pose reader (and gesture → request)

Mapping: open fingers 0 → Closed fingers, 1 → Index, 2 → Two, 3 → Three, 4 and 5 → Open palm
(the reader ignores the thumb). RPS: rock → Closed, paper → Open palm, scissors → Two.

Before, a finger counted as folded only below 30 on the reader's 0–100 openness scale. A loosely
folded ring or little finger reads 30–60, so a quarter of clear poses came back "Other hand
pose". Tuned on the HandsDataset training split (open ≥ 80, folded ≤ 60, and middle-ring-little
also counts as three fingers):

| Held-out set | Right pose named, before | after | Wrong pose named, before | after |
| --- | --- | --- | --- | --- |
| HandsDataset test, 349 hands | 74.5% (69.7–78.8) | **88.5% (84.8–91.5)** | 0.9% (0.3–2.5) | 0.9% (0.3–2.5) |
| RPS sample, 375 hands | 77.9% (73.4–81.8) | **89.1% (85.5–91.8)** | 1.3% (0.6–3.1) | 1.9% (0.9–3.8) |

Per class on HandsDataset test after the change (precision / recall): Closed 97.9 / 84.4,
Index 100 / 78.8, Two 100 / 84.2, Three 97.1 / 91.7, Open palm 100 / 100. Part of the Three
gain is the added middle-ring-little shape, which this dataset uses often. The hand detector
found 94–96% of labelled hands; the rest count as misses above.

On RPS "none" photos (other hand shapes, no single true label) a pose was named on 46% before
and 58% after; many of those photos do show an open palm or one finger, so this is not an
error rate.

Gesture to action: `tests/gesture-request-browser.mjs` checks the request flow with the engine's
hand events. An unpractised pose does nothing; a practised pose proposes its request and asks
first; showing it again while the question is spoken sends nothing; a separate showing after
the question sends one confirmed request; no repeat within 2.5 s. Note that any practised pose
confirms a pending question, not only the one that proposed it.

## EyeSpeak gaze calibration (MPIIFaceGaze)

Each person was put through Asha's calibration as it runs in the app (`public/app/everyday/gaze-engine.js`,
unchanged). Photos nearest to the 9 calibration targets trained the model (8 per target) and
photos nearest to the 3 check targets ran the app's accuracy check (6 per target). Asha then had to
place every remaining photo on the screen. Calibration used each photo's true gaze point, so this
is if anything kinder than real use.

| Measure | Result (current settings) |
| --- | --- |
| Photos with a usable face and both eyes | 13 of 15 people 242–250 of 250; 2 people 178 (mostly "adjust camera distance") |
| Board the app's check would offer | 9 tiles 0 of 15 people, 2 tiles 4 of 15, none 11 of 15 |
| Gaze error on held-out photos, share of the screen | mean 0.19, median 0.17, 90th percentile 0.36 |
| Right tile picked, single photo | 2 halves **93% (92–94)**, 6 tiles 62%, 9 tiles 47% |

What this says: on ordinary laptop-webcam photos, one look at a time, Asha's gaze is good enough to
choose between two halves of the screen and not good enough for 6 or 9 tiles. The app's own
check behaved correctly: it refused the larger boards for everyone, so nobody would have been given
a board that misreads them. People who get no board use touch, switch or blink scanning instead.

Tuning, cross-validated by person (settings picked on even-numbered people, scored on odd, and the
reverse), did not give a clear gain: the best pick (ridge 0.5, 12 photos per target) lowered the
held-out error only from 0.196 to 0.185 and still gave one board, and the other pick (16 targets)
failed calibration for every held-out person. The settings were left unchanged.

Limits of this test: single photos, so no averaging over the 1.1 s dwell the app uses; head
position varies freely between photos; 15 healthy adults; labels are where the person was asked
to look.

## FaceSpeak: abnormal stretch on healthy faces

The lateral lip shift is the mouth centre minus the nose tip, in face widths. On 1,820
non-smiling GENKI faces it followed sin(head yaw) with slope 0.35 (r = 0.94): the nose stands
out from the face, so turning the head reads as a lip pull. Before resting-face reference
(and in live use, any turn away from the resting pose) **37.1% (34.0–40.2)** of held-out healthy
faces read as an active one-sided stretch, rising to 84% at 15–20° yaw.

The shift now subtracts 0.35 × sin(yaw) (fitted on even-numbered images, reported on odd):
**8.2% (6.6–10.2)**, and 5.2% / 8.2% / 16.9% / 17.2% at 0–5 / 5–10 / 10–15 / 15–20° yaw. The
remaining 8% is people's own resting asymmetry, which the live resting-face reference removes;
that case cannot be measured on one photo per person. A real one-sided pull with the head
facing forward is unchanged (`tests/face-analysis.test.mjs`). The 60-second hold still applies.

**Not measured:** how often a real palsy-type stretch is caught. The facial palsy sets found
(YouTube Facial Palsy, AFLFP, MEEI) need an application to the authors.

## Face detection, smile and head pose (GENKI-4K)

| Measure | Result |
| --- | --- |
| Face found | 99.1% (98.7–99.3) of 4,000 |
| Smile score (MediaPipe blendshape) separating smile / no smile | AUC 0.980; at 0.25: sensitivity 95.8%, specificity 90.4% |
| Smiling faces that would pass the "relaxed face" gate and be learnt as resting | 2.9% (2.3–3.7) |
| Head yaw / pitch / roll error vs labels | 3.8° / 6.4° / 1.1° mean absolute (GENKI's labels are themselves estimates) |

By estimated skin tone (individual typology angle from cheek pixels, a colour proxy that
lighting distorts, not a self-reported label) the smile AUC ranged 0.969–0.989 and the
corrected stretch false-activation rate 5.5–9.6% with overlapping intervals; by face
brightness, dim faces (< 90/255) were worst: AUC 0.968 and 11.5% (8.3–15.6). Glasses and age
are not labelled in these sets.

## Limits

- Single photos, not video: no frame-to-frame tracking, no dwell, no hold timers.
- Healthy, mostly young web faces and hands; no motor or facial impairment.
- Labels of HandsDataset and GENKI were made by their authors; their errors are in these numbers.
- Gaze was tested on single photos only. Blink counting and slow-blink clicks are still running on the eye videos.
