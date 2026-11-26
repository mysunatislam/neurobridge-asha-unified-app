import {
  begin,
  body,
  authenticate,
  store,
  path,
  authFail,
} from "../lib/common.js";
import { clean, hash } from "../lib/logic.js";
import { MairaProviderError } from "../lib/maira-provider.js";
import { createLlmProvider } from "../lib/llm-provider.js";
import { createAshaOrchestrator } from "../lib/asha-orchestrator.js";
import { createHybridRetriever } from "../lib/hybrid-retrieval.js";
import { urgentCompanionResponse } from "../../../public/app/everyday/companion-safety.js";

const provider = createLlmProvider();
const retriever = createHybridRetriever();
const orchestrator = createAshaOrchestrator({
  provider,
  retrieve: retriever.retrieve,
});
// The on-device demo has no care circle. A guest may still ask Asha, with the
// same consent switch, no stored profile and tighter limits: per address in
// this instance, and one shared daily cap in the store.
const GUEST_WINDOW_MS = 10 * 60 * 1000;
const GUEST_PER_WINDOW = 30;
const GUEST_DAILY_CAP = 3000;
const guests = new Map();
function guestAllowed(address, at = Date.now()) {
  if (guests.size > 5000) guests.clear();
  const seen = guests.get(address);
  if (!seen || at - seen.since > GUEST_WINDOW_MS) {
    guests.set(address, { since: at, count: 1, last: at });
    return true;
  }
  if (seen.count >= GUEST_PER_WINDOW || at - seen.last < 1500) return false;
  seen.count++;
  seen.last = at;
  return true;
}
const clientAddress = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim() || "unknown";

const quiet = (promise) => {
  // Prevent an unhandled rejection if another step fails first; callers still
  // await the original promise and receive its error.
  promise.catch(() => {});
  return promise;
};

export default async function handler(req, res) {
  if (!begin(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const started = Date.now();
  try {
    const b = body(req);
    // Public local template: no account, provider discovery, usage read or cloud consent is needed.
    const urgent = urgentCompanionResponse(b.text, {
      language: b.language,
      mode: b.mode,
      region: b.region,
      redFlags: b.redFlags,
    });
    if (urgent) return res.json(urgent);
    const guest = !b.patientId && b.guest === true;
    let profile = null;
    let patientId;
    if (guest) {
      if (b.consent !== true)
        return res
          .status(400)
          .json({ error: "Cloud assistance needs your consent." });
      if (!guestAllowed(clientAddress(req)))
        return res
          .status(429)
          .json({ error: "Please wait a moment before asking again." });
      const day = new Date().toISOString().slice(0, 10);
      // Under asha-live/limits/<day>/, which the daily cleanup removes.
      const dailyKey = `asha-live/limits/${day}/guest-asha.json`;
      const used = (await store.read(dailyKey).catch(() => null)) || {
        count: 0,
      };
      if (used.count >= GUEST_DAILY_CAP)
        return res.status(429).json({
          error:
            "The demo has reached today's limit for AI replies. Link a caregiver for your own allowance.",
        });
      await store
        .write(dailyKey, { count: used.count + 1, last: Date.now() }, true)
        .catch(() => {});
      // A daily, one-way pseudonym: the address itself is never sent or kept.
      patientId = "guest-" + hash(day + clientAddress(req)).slice(0, 20);
    } else {
      const wellFormed = /^[a-f0-9]{24}$/.test(b.patientId || "");
      const daily = wellFormed
        ? path(b.patientId, "usage/" + new Date().toISOString().slice(0, 10))
        : null;
      // Independent setup runs together instead of back-to-back: Maira profile
      // discovery (cached per instance), authentication and the usage read.
      if (wellFormed) provider.warm();
      const usageRead = daily ? quiet(store.read(daily)) : null;
      const auth = await authenticate(req, b.patientId);
      if (!auth) return authFail(res);
      if (b.consent !== true)
        return res
          .status(400)
          .json({ error: "Cloud assistance needs your consent." });
      const usage = (await usageRead) || { count: 0, last: 0 };
      if (usage.count >= 160 || Date.now() - usage.last < 1500)
        return res
          .status(429)
          .json({ error: "Please wait a moment before asking again." });
      await store.write(
        daily,
        { count: usage.count + 1, last: Date.now() },
        true,
      );
      profile = auth.profile;
      patientId = b.patientId;
    }
    if (guest) provider.warm();
    const text = clean(b.text, 600);
    if (!text)
      return res.status(400).json({ error: "Say or type something first." });
    const providerStarted = Date.now();
    const result = await orchestrator.run({
      patientId,
      profile,
      text,
      module: clean(b.module, 30),
      mode: b.mode === "interpret" ? "interpret" : "chat",
      language: ["auto", "en", "bn", "mixed"].includes(b.language)
        ? b.language
        : "auto",
      context: clean(b.context, 180),
      history: Array.isArray(b.history) ? b.history.slice(-6) : [],
      confirmedMemories: Array.isArray(b.confirmedMemories)
        ? b.confirmedMemories.slice(-20)
        : [],
    });
    res.setHeader(
      "Server-Timing",
      `setup;dur=${providerStarted - started}, ${provider.kind === "maira" ? "maira" : "llm"};dur=${Date.now() - providerStarted}, total;dur=${Date.now() - started}`,
    );
    console.info("asha orchestration", {
      task: result.orchestration.task,
      model: result.orchestration.model,
      verified: result.orchestration.verified,
      guest,
      answeredBy: result.answeredBy || "model",
      durationMs: Date.now() - started,
    });
    return res.json(result);
  } catch (error) {
    console.error("asha request failure", error?.name);
    if (error instanceof MairaProviderError)
      return res.status(error.status).json({ error: error.message });
    return res.status(503).json({
      error:
        "Asha could not connect. Your local communication controls remain available.",
    });
  }
}
