// Small, version-controlled retrieval set: only capabilities actually implemented here.
export const guides = {
  companion:
    "The patient uses Start support once to grant camera/audio permission. Details contains every module. A caregiver completes the assessment. No capability locks access. Patient requests are confirmed, then sent to the assigned caregiver, who can acknowledge them. The app does not place telephone calls. Do not announce delivery without a verified receipt.",
  assessment:
    "Recommend FingerSpeak for available hands/fingers, FaceSpeak for available eyes/lips/head, and SenseAssist alongside either when speech is available. All modules can be opened manually. Blind users need spoken guidance, hearing-impaired users need visible text. If no gesture can be captured, caregiver-assisted or touch communication remains necessary.",
  facespeak:
    "Calibrate patient captures neutral followed by three valid cycles of each available selected movement. Skip inaccessible movements. A trained triple deliberate blink proposes water; three left-turn-and-return cycles propose food; three right-turn-and-return cycles propose toilet. A long trained pucker proposes comfort. A separately completed calibrated smile, nod or deliberate blink confirms when prompted. Scores are movement features, not clinical ability. Sustained changes prompt a check-in, never a diagnosis.",
  fingerspeak:
    "Both hands are tracked. Choose a familiar pose and its meaning, then hold, relax and repeat three times to learn. Show the saved pose to propose a request and repeat a mapped pose to confirm. No hand ability assessment blocks opening FingerSpeak. If no usable gesture is captured, suggest FaceSpeak or caregiver assistance without locking the hand interface.",
  senseassist:
    "Two uses: gentle phrase practice and clarification of heard words. Browser recognition produces editable transcripts; AI interpretation proposes candidate wording. Speaker confirmation is necessary. Confirmed words can be spoken aloud or sent through the caregiver request flow. Do not claim that transcript differences are a diagnosis or objective phoneme score.",
  vitalsense:
    "The camera samples forehead color locally for a 20-second pulse-trend window. Motion, lighting changes and weak spectral signals are rejected. It cannot measure blood pressure, oxygen saturation or temperature, and does not trigger emergencies. For health decisions use an appropriate validated device and professional advice.",
  posture:
    "Lightweight pose estimation shares the camera with face and both hands in every patient interface. Optional YOLO provides a second posture estimate. Shoulders must be visible; hips improve lean estimates. A minute of sustained change prompts a comfort check-in. Closed-eye/still-body then open-eye/movement is a possible wake pattern, not a sleep-stage classifier.",
  caregiver:
    "Use the private caregiver link from setup on the second phone. View Requests & updates and acknowledge to let the patient know. Sent means server-stored; received means the dashboard fetched it; acknowledged requires a caregiver action. Push is optional, and on iPhone requires installation to the Home Screen. Keep the dashboard open for foreground live updates. Patient camera sensing stops when the browser is backgrounded or locked.",
};
