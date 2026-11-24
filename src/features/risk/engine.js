// Smart risk alerts and a prevention plan for today.
//
// Rules only, no model: every alert lists the readings that raised it, the
// threshold it crossed and where that threshold comes from, so a patient,
// caregiver or clinician can check it. Camera readings are experimental
// estimates, so on their own they can raise at most a "watch"; an "act" needs
// two independent sources that agree (for example heat and a raised pulse), or
// a non-camera source such as unanswered requests. This is decision support,
// not a diagnosis.

export const RULES_VERSION = "risk-rules-2026-11-18";

export const THRESHOLDS = Object.freeze({
  // NOAA/NWS heat index bands ("feels like"), in °C: 27 caution, 32 extreme caution, 41 danger.
  heatCaution: 27,
  heatWatch: 32,
  heatAct: 41,
  // US EPA AQI: 101-150 unhealthy for sensitive groups, 151+ unhealthy for everyone.
  aqiWatch: 101,
  aqiAct: 151,
  // WHO UV index: 8-10 very high.
  uvHigh: 8,
  humidHigh: 80,
  humidLow: 30,
  // Resting adult ranges: pulse 60-100 bpm, breathing 12-20 per minute.
  pulseHigh: 100,
  pulseLow: 50,
  pulseOverReference: 0.15,
  breathingHigh: 20,
  breathingLow: 10,
  // A reading counts only with fair or good camera signal quality.
  minQuality: 0.45,
  vitalsWindowH: 6,
  stretchWindowH: 24,
  requestsWindowH: 24,
  waterGapH: 4,
  moveGapDays: 3,
  lowIntakeKcal: 1000,
});

export const SOURCES = Object.freeze({
  heat: "NOAA National Weather Service heat index bands",
  aqi: "US EPA Air Quality Index categories",
  uv: "WHO Global Solar UV Index",
  vitals: "Typical resting adult ranges (pulse 60-100 bpm, breathing 12-20/min)",
  fast: "Stroke warning signs: BE FAST (balance, eyes, face, arm, speech, time)",
  weather: "Open-Meteo forecast and air-quality API",
});

const HOUR = 3600e3;
const T = THRESHOLDS;
const round = (n) => Math.round(n);
const ago = (now, at) => {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const LEVEL_ORDER = { act: 0, watch: 1, info: 2 };

function aqiBand(aqi) {
  if (aqi == null) return null;
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for sensitive groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very unhealthy";
  return "hazardous";
}

function heatBand(feels) {
  if (feels == null) return null;
  if (feels >= T.heatAct) return "danger";
  if (feels >= T.heatWatch) return "extreme caution";
  if (feels >= T.heatCaution) return "caution";
  return "comfortable";
}

/** The best hour left today for movement: coolest "feels like" with acceptable air. */
export const localHour = (env, now) =>
  Number.isFinite(env?.utcOffsetSeconds)
    ? new Date(now + env.utcOffsetSeconds * 1000).getUTCHours()
    : new Date(now).getHours();

export function bestMoveHour(env, now) {
  const hours = env?.hourly || [];
  const nowHour = localHour(env, now);
  const candidates = hours.filter(
    (h) => h.hour >= Math.max(6, nowHour + 1) && h.hour <= 20 && h.feels != null,
  );
  if (!candidates.length) return null;
  const okAir = candidates.filter((h) => h.aqi == null || h.aqi < T.aqiWatch);
  const pool = okAir.length ? okAir : candidates;
  return pool.reduce((best, h) => (h.feels < best.feels ? h : best));
}

const clockHour = (h) => {
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12} ${suffix}`;
};

/** Summaries of the inputs, also shown to the person as "signals used". */
export function summarize({ now = Date.now(), env, vitals = [], stretch = [], requests = [], move = {}, meals = [] }) {
  const recentVitals = vitals
    .filter((v) => now - v.at <= T.vitalsWindowH * HOUR && (v.quality ?? 0) >= T.minQuality)
    .sort((a, b) => a.at - b.at);
  const pulses = recentVitals.filter((v) => Number.isFinite(v.bpm));
  const breaths = recentVitals.filter((v) => Number.isFinite(v.breathing));
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const reference = [...vitals].reverse().find((v) => Number.isFinite(v.reference))?.reference ?? null;
  const windowRequests = requests.filter((r) => now - r.at <= T.requestsWindowH * HOUR);
  const missed = windowRequests.filter((r) => ["expired", "failed", "local"].includes(r.outcome));
  const lastWater = [...requests].filter((r) => r.kind === "water").sort((a, b) => b.at - a.at)[0];
  const history = Array.isArray(move.history) ? move.history : [];
  const lastMove = history
    .map((h) => Date.parse(h.endedAt || h.startedAt || ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const safetyStop = history
    .filter((h) => h.safety && ["emergency", "stop_rest", "stop_exercise"].includes(h.safety.action))
    .map((h) => ({ at: Date.parse(h.endedAt || h.startedAt || ""), reasons: h.safety.reasons || [] }))
    .filter((h) => Number.isFinite(h.at) && now - h.at <= 7 * 24 * HOUR)
    .sort((a, b) => b.at - a.at)[0];
  const dayMeals = meals.filter((m) => now - Date.parse(m.loggedAt) <= 24 * HOUR);
  const kcal = dayMeals.reduce((sum, m) => sum + (m.eaten?.kcal?.min ?? m.total?.kcal?.min ?? 0), 0);
  return {
    pulse: pulses.length ? { median: round(median(pulses.map((v) => v.bpm))), count: pulses.length, latestAt: pulses.at(-1).at } : null,
    breathing: breaths.length ? { median: round(median(breaths.map((v) => v.breathing))), count: breaths.length, latestAt: breaths.at(-1).at } : null,
    reference,
    stretch: stretch.filter((s) => now - s.at <= T.stretchWindowH * HOUR),
    requests: { total: windowRequests.length, missed, lastWaterAt: lastWater?.at ?? null },
    move: {
      planned: !!move.plan,
      lastAt: lastMove ?? null,
      lockout: move.lockout && !move.lockout.cleared && move.lockout.until > now ? move.lockout : null,
      safetyStop: safetyStop || null,
    },
    meals: { count: dayMeals.length, kcal: round(kcal) },
    env: env || null,
  };
}

/**
 * @param {{now?: number, env?: object|null, vitals?: object[], stretch?: object[], requests?: object[], move?: object, meals?: object[]}} input
 */
export function assessRisk(input) {
  const now = input.now ?? Date.now();
  const s = summarize({ ...input, now });
  const env = s.env;
  const alerts = [];
  const add = (a) => alerts.push({ sources: [], actions: [], ...a });

  const feels = env?.current?.feels ?? null;
  const temp = env?.current?.temp ?? null;
  const humidity = env?.current?.humidity ?? null;
  const aqi = env?.current?.aqi ?? null;
  const pm25 = env?.current?.pm25 ?? null;
  const uv = env?.current?.uv ?? null;
  const place = env?.place ? ` in ${env.place}` : "";
  const envReason = (text) => ({ text, source: SOURCES.weather });

  // Pulse: against the person's own resting reference when there is one.
  let pulseHigh = null;
  if (s.pulse) {
    const ref = s.reference;
    if (ref && s.pulse.median > ref * (1 + T.pulseOverReference))
      pulseHigh = `Pulse estimate ${s.pulse.median} bpm is ${round((s.pulse.median / ref - 1) * 100)}% above your resting reference of ${ref} bpm (${s.pulse.count} readings in the last ${T.vitalsWindowH} h).`;
    else if (s.pulse.median > T.pulseHigh)
      pulseHigh = `Pulse estimate ${s.pulse.median} bpm is above the resting range of 60-100 bpm (${s.pulse.count} readings in the last ${T.vitalsWindowH} h).`;
  }
  const breathingHigh =
    s.breathing && s.breathing.median > T.breathingHigh
      ? `Breathing estimate ${s.breathing.median}/min is above the resting range of 12-20/min (${s.breathing.count} readings in the last ${T.vitalsWindowH} h).`
      : null;

  const heatWatch = feels != null && feels >= T.heatWatch;
  const heatAct = feels != null && feels >= T.heatAct;
  const heatText = feels != null ? `It feels like ${round(feels)}°C${place} (air ${round(temp)}°C, humidity ${round(humidity)}%): NOAA band "${heatBand(feels)}".` : null;
  const airWatch = aqi != null && aqi >= T.aqiWatch;
  const airAct = aqi != null && aqi >= T.aqiAct;
  const airText = aqi != null ? `Air quality index ${round(aqi)}${place}${pm25 != null ? `, PM2.5 ${round(pm25)} µg/m³` : ""}: EPA band "${aqiBand(aqi)}".` : null;
  const best = bestMoveHour(env, now);

  // 1. Heat, combined with pulse or breathing.
  if (heatWatch && (pulseHigh || breathingHigh)) {
    add({
      id: "heat-strain",
      level: "act",
      title: "Heat strain risk",
      summary: "Hot weather and a raised pulse or breathing estimate at the same time.",
      because: [envReason(heatText), ...[pulseHigh, breathingHigh].filter(Boolean).map((text) => ({ text, source: SOURCES.vitals }))],
      actions: [
        "Move to the coolest room now; use a fan or wet cloth on the neck and arms.",
        "Sip water every 15-20 minutes, unless a clinician has limited your fluids.",
        "Recheck VitalSense after 30 minutes of rest.",
        "Call your caregiver or a clinician if you feel dizzy, confused, very weak or stop sweating.",
      ],
      sources: [SOURCES.heat, SOURCES.vitals, SOURCES.weather],
      ask: "It is hot and my pulse is raised. How can I stay cool and safe right now?",
    });
  } else if (heatWatch) {
    add({
      id: "heat",
      level: heatAct ? "act" : "watch",
      title: heatAct ? "Dangerous heat today" : "Hot weather today",
      summary: "People with limited movement or speech cool down less easily and may not be able to say they feel unwell.",
      because: [envReason(heatText)],
      actions: [
        "Stay in the coolest room between 11 AM and 4 PM.",
        "Offer water regularly instead of waiting to be asked.",
        "Do a VitalSense check this afternoon so a raised pulse is noticed early.",
      ],
      sources: [SOURCES.heat, SOURCES.weather],
      ask: "How do I stay safe in hot weather?",
    });
  }

  // 2. Air quality, combined with breathing.
  if (airWatch && breathingHigh) {
    add({
      id: "air-breathing",
      level: "act",
      title: "Poor air and faster breathing",
      summary: "Polluted air and a raised breathing estimate at the same time.",
      because: [envReason(airText), { text: breathingHigh, source: SOURCES.vitals }],
      actions: [
        "Stay indoors with windows closed; run an air purifier if you have one.",
        "Use any inhaler or plan your clinician gave you.",
        "Get urgent help if breathing is hard, lips look blue, or speaking is difficult.",
      ],
      sources: [SOURCES.aqi, SOURCES.vitals, SOURCES.weather],
      ask: "The air is poor and I am breathing faster. What should I do?",
    });
  } else if (airWatch) {
    add({
      id: "air",
      level: airAct ? "act" : "watch",
      title: airAct ? "Unhealthy air today" : "Air unhealthy for sensitive people",
      summary: "Older adults and people with heart, lung or neurological conditions are more sensitive to polluted air.",
      because: [envReason(airText)],
      actions: [
        "Keep windows closed during the worst hours and move exercise indoors.",
        "Wear a well-fitted N95/KN95 mask if you must go out.",
        "Watch for coughing or faster breathing; a VitalSense check can help.",
      ],
      sources: [SOURCES.aqi, SOURCES.weather],
      ask: "The air quality is poor today. How can I protect myself?",
    });
  }

  // 3. Vitals alone (camera estimate, so at most "watch").
  if (!heatWatch && pulseHigh)
    add({
      id: "pulse",
      level: "watch",
      title: "Pulse estimate above your usual",
      summary: "A camera estimate only. Rest and measure again before deciding anything.",
      because: [{ text: pulseHigh, source: SOURCES.vitals }],
      actions: ["Rest for 10 minutes, then take a new VitalSense reading in steady light.", "If it stays high, check with a validated device or a clinician."],
      sources: [SOURCES.vitals],
      ask: "My pulse estimate is higher than usual. What should I do?",
    });
  if (!(airWatch || heatWatch) && breathingHigh)
    add({
      id: "breathing",
      level: "watch",
      title: "Breathing estimate faster than usual",
      summary: "A camera estimate only. Rest and measure again.",
      because: [{ text: breathingHigh, source: SOURCES.vitals }],
      actions: ["Sit upright, rest and take a new reading.", "Get urgent help if breathing is hard or you cannot speak in full sentences."],
      sources: [SOURCES.vitals],
      ask: "My breathing estimate is faster than usual. What should I do?",
    });
  if (s.pulse && s.pulse.median < T.pulseLow)
    add({
      id: "pulse-low",
      level: "watch",
      title: "Pulse estimate below the usual range",
      summary: "A camera estimate only. Low light or movement can cause this.",
      because: [{ text: `Pulse estimate ${s.pulse.median} bpm is below 50 bpm (${s.pulse.count} readings).`, source: SOURCES.vitals }],
      actions: ["Take a new reading in steady light.", "If you also feel faint or dizzy, contact a clinician."],
      sources: [SOURCES.vitals],
      ask: "My pulse estimate is low. What should I do?",
    });

  // 4. FaceSpeak abnormal stretch (held 60 s on one side).
  if (s.stretch.length) {
    const last = s.stretch.at(-1);
    add({
      id: "face-stretch",
      level: "watch",
      title: "One-sided face pull logged",
      summary: "FaceSpeak saw the lips pulled to one side for over a minute. This can be a deliberate movement; it is shown so it is not missed.",
      because: [
        {
          text: `${s.stretch.length} abnormal-stretch log${s.stretch.length > 1 ? "s" : ""} in the last 24 h, latest ${ago(now, last.at)} on the ${last.side || "one"} side.`,
          source: "FaceSpeak abnormal stretch (60-second hold, compared with your resting face)",
        },
      ],
      actions: [
        "If this is new, or comes with arm weakness, a drooping face, slurred speech or a sudden severe headache, call emergency services now and note the time.",
        "If it is a known, usual movement, tell your caregiver so they can note it.",
        "Mention repeated logs at your next visit (Care journal).",
      ],
      sources: [SOURCES.fast],
      ask: "FaceSpeak logged a one-sided face pull. What does that mean and what should I do?",
    });
  }

  // 5. Missed requests (not a camera estimate).
  if (s.requests.missed.length) {
    const n = s.requests.missed.length;
    const kinds = [...new Set(s.requests.missed.map((r) => r.kind))].join(", ");
    const count = (o) => s.requests.missed.filter((r) => r.outcome === o).length;
    const parts = [
      count("failed") && `${count("failed")} failed to send`,
      count("local") && `${count("local")} stayed on this device because no caregiver is linked`,
      count("expired") && `${count("expired")} timed out before they were confirmed`,
    ].filter(Boolean);
    add({
      id: "missed-requests",
      level: n >= 3 ? "act" : "watch",
      title: n >= 3 ? "Requests are going unanswered" : "A request was not answered",
      summary: "A need that is not answered can become a risk, more so in heat.",
      because: [{ text: `${n} of ${s.requests.total} request${s.requests.total > 1 ? "s" : ""} in the last 24 h did not reach a caregiver (${kinds}): ${parts.join(", ")}.`, source: "Asha request log on this device" }],
      actions: [
        ...(count("local") ? ["Link a caregiver (Caregiver view) so requests reach a person."] : []),
        "Caregiver: check that notifications from Asha are on and the phone is nearby.",
        "Agree a back-up: a second caregiver, or a bell for when the app cannot reach anyone.",
        "Send a test request from Ask for help.",
      ],
      sources: ["Asha request log"],
      ask: "Some of my requests were not answered. What can my caregiver and I do?",
    });
  }

  // 6. Hydration in heat: no water request for a while.
  if ((feels != null && feels >= T.heatCaution) || (humidity != null && humidity <= T.humidLow)) {
    const gapH = s.requests.lastWaterAt ? (now - s.requests.lastWaterAt) / HOUR : null;
    if (gapH == null || gapH >= T.waterGapH)
      add({
        id: "hydration",
        level: heatWatch ? "watch" : "info",
        title: "Time for water",
        summary: "People who rely on others for drinks often drink less than they need.",
        because: [
          gapH == null
            ? { text: "No water request is logged on this device yet.", source: "Asha request log" }
            : { text: `The last water request was ${ago(now, s.requests.lastWaterAt)}.`, source: "Asha request log" },
          envReason(
            humidity != null && humidity <= T.humidLow && !(feels >= T.heatCaution)
              ? `Humidity is low (${round(humidity)}%), which dries the mouth and airways.`
              : heatText,
          ),
        ],
        actions: ["Offer a drink now and then every hour, unless a clinician has limited fluids."],
        sources: [SOURCES.heat, "Asha request log"],
        ask: "How much should I drink on a hot day?",
      });
  }

  // 7. Movement.
  if (s.move.lockout)
    add({
      id: "move-lockout",
      level: "watch",
      title: "Exercise is paused for safety",
      summary: "Move stopped a session because of warning symptoms.",
      because: [{ text: `Move paused exercise: ${(s.move.lockout.reasons || []).join(", ") || "warning symptoms"}.`, source: "ASHA Move safety check" }],
      actions: ["Rest today.", "Talk to your clinician before exercising again if symptoms return."],
      sources: ["ASHA Move safety check"],
      ask: "Move paused my exercise. What should I do?",
    });
  else if (s.move.safetyStop)
    add({
      id: "move-safety-stop",
      level: "watch",
      title: "A recent workout stopped for safety",
      summary: "Warning symptoms during exercise are worth telling a clinician about.",
      because: [{ text: `Move stopped a session ${ago(now, s.move.safetyStop.at)}: ${s.move.safetyStop.reasons.join(" ") || "warning symptoms"}`, source: "ASHA Move safety check" }],
      actions: ["Keep today's movement gentle, or rest.", "Tell your clinician what happened before the next workout."],
      sources: ["ASHA Move safety check"],
      ask: "My workout stopped for safety recently. Is it safe to exercise today?",
    });
  else if (s.move.lastAt == null || now - s.move.lastAt >= T.moveGapDays * 24 * HOUR) {
    const when = best ? `${clockHour(best.hour)} (feels ${round(best.feels)}°C${best.aqi != null ? `, AQI ${round(best.aqi)}` : ""})` : null;
    add({
      id: "move-gap",
      level: "info",
      title: "A short movement session would help",
      summary: "Regular gentle movement helps circulation, skin and mood.",
      because: [
        { text: s.move.lastAt ? `The last Move session was ${ago(now, s.move.lastAt)}.` : "No Move session is logged on this device.", source: "ASHA Move history" },
        ...(when ? [envReason(`The coolest hour with acceptable air left today is ${when}.`)] : []),
      ],
      actions: [when ? `Plan a 10-minute Move routine at ${clockHour(best.hour)}${airWatch ? ", indoors" : ""}.` : "Plan a 10-minute Move routine at a cool time of day."],
      sources: ["ASHA Move history", SOURCES.weather],
      ask: "What gentle exercise can I do today?",
    });
  }

  // 8. Food.
  if (s.meals.count >= 2 && s.meals.kcal > 0 && s.meals.kcal < T.lowIntakeKcal)
    add({
      id: "low-intake",
      level: "info",
      title: "Low food intake logged",
      summary: "The logged meals add up to less than usual for a day.",
      because: [{ text: `${s.meals.count} meals in the last 24 h add up to at least ${s.meals.kcal} kcal (sourced estimate).`, source: "ASHA Nutrition log" }],
      actions: ["Offer a small snack or drink with energy.", "If eating is hard (chewing, swallowing, tiredness), tell your clinician."],
      sources: ["ASHA Nutrition log"],
      ask: "I am not eating much. What can help?",
    });

  // 9. UV.
  if (uv != null && uv >= T.uvHigh)
    add({
      id: "uv",
      level: "info",
      title: "Very high UV",
      summary: "Skin burns quickly at this level.",
      because: [envReason(`UV index ${round(uv)}${place}.`)],
      actions: ["Avoid direct sun around midday; use shade, a hat and sunscreen outdoors."],
      sources: [SOURCES.uv, SOURCES.weather],
      ask: "The UV index is very high. How do I protect my skin?",
    });

  alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return { alerts, plan: preventionPlan({ alerts, summary: s, now, best, heatWatch, airWatch }), summary: s, rulesVersion: RULES_VERSION };
}

const FIXED = { Now: -3, "Every hour": -2, "All day": -1, Lunch: 13, Dinner: 19, "Before bed": 22 };
function planOrder(label) {
  if (label in FIXED) return FIXED[label];
  const m = /^(\d{1,2}) (AM|PM)/.exec(label);
  return m ? (Number(m[1]) % 12) + (m[2] === "PM" ? 12 : 0) : 99;
}

/** A short, ordered plan for the rest of today, built from the alerts. */
export function preventionPlan({ alerts, summary, now, best, heatWatch, airWatch }) {
  const has = (id) => alerts.some((a) => a.id === id);
  const hour = localHour(summary.env, now);
  const steps = [];
  const step = (id, time, text, because) => steps.push({ id, time, text, because });
  if (has("heat-strain") || has("air-breathing"))
    step("now-rest", "Now", "Rest somewhere cool with clean air, then recheck VitalSense in 30 minutes.", "Raised by the top alert.");
  if (has("face-stretch"))
    step("now-face", "Now", "Check for new arm weakness, face droop or speech change. If any are new, call emergency services.", "FaceSpeak logged a one-sided pull.");
  if (has("missed-requests"))
    step("now-requests", "Now", "Caregiver: check Asha notifications, then send a test request together.", "Requests went unanswered.");
  if (heatWatch || has("hydration"))
    step("water", "Every hour", "Offer a drink, unless a clinician has limited fluids.", heatWatch ? "Hot weather today." : "No recent water request.");
  if (heatWatch)
    step("cool", "11 AM - 4 PM", "Stay in the coolest room; keep curtains closed on the sunny side.", "Hottest hours of the day.");
  if (airWatch)
    step("air", "All day", "Keep windows closed during poor air; exercise indoors.", "Air quality index is high.");
  if (!summary.move.lockout && best)
    step("move", clockHour(best.hour), `10-minute Move routine${airWatch ? " indoors" : ""}.`, "Coolest hour with acceptable air.");
  step(
    "check",
    hour < 17 ? "5 PM" : "Before bed",
    summary.pulse ? "Take a VitalSense reading at rest and compare with this morning." : "Take a first VitalSense reading at rest so changes can be noticed.",
    "A routine reading makes later changes meaningful.",
  );
  if (!summary.meals.count) step("meal", hour < 14 ? "Lunch" : "Dinner", "Log one meal in Nutrition.", "No meals logged in the last 24 h.");
  return steps.sort((a, b) => planOrder(a.time) - planOrder(b.time));
}
