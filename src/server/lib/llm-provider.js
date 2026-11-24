import { createMairaProvider } from "./maira-provider.js";
import { createOllamaProvider } from "./ollama-provider.js";
import { createGatewayProvider } from "./gateway-provider.js";

// Failures where the cloud never produced an answer; a local model may try.
// Invalid requests, cancellations and refusals are never retried elsewhere.
const RETRY_LOCALLY = new Set([
  "connection_failed",
  "timeout",
  "provider_unavailable",
  "provider_busy",
  "profiles_unavailable",
  "not_configured",
]);

// MAIRA failures the backup cloud route may answer instead (a rejected or
// missing MAIRA key included, since the backup has its own key).
const RETRY_ON_GATEWAY = new Set([...RETRY_LOCALLY, "credentials_rejected", "model_unavailable", "invalid_response"]);

// After MAIRA rejects its key, skip it for a while so each reply does not
// wait on a call that is known to fail.
const SKIP_REJECTED_MS = 10 * 60 * 1000;

/** MAIRA first; Vercel AI Gateway (no key needed on Vercel) when MAIRA could not answer. */
function withGatewayBackup(maira, gateway, now = Date.now) {
  if (!gateway.configured()) return maira;
  let rejectedAt = -Infinity;
  return {
    kind: "maira",
    configured: () => true,
    warm: () => maira.warm(),
    async ask(request) {
      if (!maira.configured() || now() - rejectedAt < SKIP_REJECTED_MS) return gateway.ask(request);
      try {
        return await maira.ask(request);
      } catch (error) {
        if (!RETRY_ON_GATEWAY.has(error?.code) || request?.signal?.aborted) throw error;
        if (error?.code === "credentials_rejected") rejectedAt = now();
        return gateway.ask(request);
      }
    },
  };
}

/**
 * ASHA_LLM_PROVIDER selects who answers:
 *   maira (default)  Gigalogy MAIRA cloud routing (Gemini, Claude, GPT)
 *   ollama           local small models only; nothing leaves the computer
 *   maira-local      cloud first, local model when the cloud is unreachable
 */
export function createLlmProvider({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const mode = String(env.ASHA_LLM_PROVIDER || "maira").toLowerCase();
  const maira = createMairaProvider({ env, fetchImpl, now });
  const cloud = withGatewayBackup(maira, createGatewayProvider({ env, fetchImpl, now }), now);
  if (mode === "maira") return cloud;
  const local = createOllamaProvider({ env, fetchImpl, now });
  if (mode === "ollama") return local;
  if (mode !== "maira-local") return cloud;
  return {
    kind: "maira-local",
    configured: () => true,
    warm: () => cloud.warm(),
    async ask(request) {
      if (!cloud.configured())
        return { ...(await local.ask(request)), fallback: true };
      try {
        return await cloud.ask(request);
      } catch (error) {
        if (!RETRY_LOCALLY.has(error?.code) || request?.signal?.aborted)
          throw error;
        return { ...(await local.ask(request)), fallback: true };
      }
    },
  };
}
