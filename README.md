# NeuroBridge Asha · Unified app

A new application built from the preserved `neurobridge-asha-unified-web` assets. Original repositories are not modified.

## Live application

- Patient / caregiver setup: https://neurobridge-asha-live.vercel.app/
- Caregiver dashboard: https://neurobridge-asha-live.vercel.app/?role=caregiver
- New source repository: https://github.com/mysunatislam/neurobridge-asha-unified-app

## Two-phone walkthrough

1. Open the main link and choose **Set up with a caregiver**. On **Tell Asha about you**, optionally choose support needs or skip. Next select actual capabilities, including vision, hearing and speech. Speech support is suggested alongside other viable modes, not instead of them.
2. Select **Next**, review the recommendation, and create a private care circle.
3. Copy the **patient link** to the patient's phone and the **caregiver link** to the caregiver's phone. An ID alone cannot authorize access.
4. On the patient phone choose **Start support**. Open **Details → Calibrate patient** for real measured facial calibration; unsupported movements can be skipped. FingerSpeak has its own three-hold gesture learning on the same camera.
5. Tap Water, confirm, then acknowledge on the caregiver phone. The patient sees Sent → Received → Acknowledged. The same request flow is used for trained gestures and confirmed speech.
6. The caregiver can enable push notifications. On iOS, install the page to the Home Screen first. Foreground dashboard polling works without push. Allow sound on the patient device with an initial touch.

## Implemented

- Clean light/dark responsive UI and installable PWA. Large controls, visible labels, keyboard focus, reduced-motion support, live status, movable floating Asha companion.
- Capability assessment and recommendations without module access restrictions. Manual interface choice is always possible.
- Optional “Tell Asha about you” setup: accident-related voice loss, ALS, stroke recovery, cerebral palsy, older-adult support, locked-in syndrome, autism, temporary voice loss or another reason. Multiple choices, goals, and skip are supported. This self-described context is editable by the caregiver and is never used to infer or limit capabilities.
- NeuroFace Sense (including FaceSpeak calibration), FingerSpeak, VitalSense and posture remain enabled together on the shared camera, regardless of the open details tab. Live status distinguishes tracked signals from searching or weak signals. Facial expression values are model signals, never a percentage of the patient's ability.
- One camera stream shared by face, two independent hands, local forehead color-pulse sampling, and body pose. Face processing gets priority; hand/pose inference is staggered in a classic web worker with GPU where supported and CPU/foreground fallbacks.
- FaceSpeak: measured neutral baseline; three observed repetitions per selected blink/smile/pucker/nod/head-turn skill; only captured skills enabled; no timer-only gesture enrollment. Triple deliberate blink proposes water. Three left-return cycles propose food; right-return cycles propose toilet. A long trained pucker proposes comfort. Confirmation is a separately completed, trained gesture or touch.
- FingerSpeak: two-hand pose recognition, openness indicators, personalized gesture-to-need mapping with three independent holds. Assessment never blocks this module.
- Body posture: MediaPipe Pose Landmarker Lite in every patient view. Optional YOLO26n-pose ONNX cross-check in its own worker. Actual body landmarks, not a decorative overlay.
- Rest-like to awake-like check-in: continuous valid closed-eye/still-body observations for 60 seconds, then open eyes and movement. Occlusion or tracking gaps reset evidence. This does **not** measure sleep stages.
- Sustained posture or baseline-relative asymmetric lip cues prompt the patient to confirm a caregiver request. They do not declare a medical abnormality or place an emergency call.
- VitalSense: local CHROM-style signal and spectral pulse-trend estimate with motion/lighting/signal rejection. No fabricated blood pressure, SpO2 or temperature values.
- SenseAssist: browser transcription/dictation, editable heard text, server-powered AI interpretation with alternatives and explicit speaker confirmation, spoken output, caregiver sending, and AI practice guidance.
- Asha server-side intelligence from every module. Device voice selection and recorded caregiver phrases; confirmed local preferences and optional needs scanning. No voice-cloning claim.
- Patient-scoped caregiver requests, separate hashed role tokens, idempotent retries, received/acknowledged receipts, current status, multiple assigned patients, and optional web push. Notification bodies contain no patient details.
- API keys are server environment variables only. Private storage namespace, rate limits, origin checks, consent, no-store responses, and daily expired-session cleanup.

## Important current limits

This is a functioning demonstration application, **not a validated clinical or emergency monitoring device**. Camera-derived posture, facial asymmetry and pulse are engineering observations. Do not rely on it as the only means of obtaining assistance.

Browser camera monitoring works only while the patient page remains open and active. A locked/backgrounded phone may stop the camera. Web push is best-effort and OS-dependent; it is not an emergency dispatch service.

The supplied provider key successfully supports text reasoning and speech interpretation. Its dedicated `/v1/voice-typing/session` returned **401** in the integration check. Therefore the shipped microphone transcript comes from browser speech recognition (or keyboard dictation), **not a falsely labeled provider audio transcription service**. No clinical dysarthric-speech accuracy or speaker-identification claim is made. Direct provider audio requires the supported audio endpoint/protocol and corresponding entitlement.

Camera-model tests use official MediaPipe fixtures, not patient validation. Mobile performance and real gesture accuracy depend on device, lighting and positioning; calibrate on the actual patient's phone.

## Development

```sh
npm install
npm test
npm start
```

Local preview: http://127.0.0.1:4180. The development server proxies API requests to the deployed backend; it never embeds secrets. Browser tests are in `tests/`, and use the desktop's bundled Playwright/Chrome paths; adapt these paths for another machine. Test artifacts are ignored by Git and deployment.

`api/` contains Vercel serverless functions; `server/` contains persistence and validation. `app/` is the unified frontend and camera pipeline. The original static export remains in Git history and supporting assets are reused. Legacy frontend routes are redirected/excluded on Vercel to avoid multiple independent camera applications.

Server secrets: `MAIRA_API_KEY`, `MAIRA_PROJECT_KEY`, `BLOB_READ_WRITE_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. Never set them in frontend code or a public repository. `scripts/provision.mjs` is an operator helper for this workstation; it transfers credentials in memory.

## Verification

- Automated state-machine, calibration, role, signal rejection and YOLO decoder tests.
- Two isolated browser contexts with real cloud storage: create care circle → patient request → caregiver receipt → acknowledgment → patient confirmation.
- Real cloud interpretation of `wed wabbit wghreen` produced `red rabbit green` with a confirmation question and alternatives.
- Actual MediaPipe/YOLO initialization and real-image pose inference; separate face/two-hand fixtures.
- Responsive screenshots, no horizontal overflow, no application JavaScript exceptions in the browser flow.

Model sources, licenses and hashes: `models/README.md`, `models/manifest.json`, and `neuroface/vendor/manifest.json`. YOLO's AGPL license requires attention before proprietary commercial distribution.
