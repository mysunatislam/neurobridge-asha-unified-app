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

// After MAIRA fails, skip it for a while so each reply does not wait on a call
// that is likely to fail again: 10 minutes for a rejected key, 2 for an outage.
const SKIP_REJECTED_MS = 10 * 60 * 1000;
const SKIP_UNAVAILABLE_MS = 2 * 60 * 1000;
const SKIP_UNAVAILABLE = new Set(["timeout", "connection_failed", "provider_unavailable", "profiles_unavailable"]);
// With a backup ready, MAIRA gets a shorter wait so the backup still has time to answer.
const MAIRA_MS_WITH_BACKUP = 10000;

/** MAIRA first; the backup route (Gemini or Vercel AI Gateway) when MAIRA could not answer. */
function withGatewayBackup(maira, gateway, now = Date.now) {
  if (!gateway.configured()) return maira;
  let skipUntil = -Infinity;
  return {
    kind: "maira",
    configured: () => true,
    warm: () => maira.warm(),
    async ask(request) {
      if (!maira.configured() || now() < skipUntil) return gateway.ask(request);
      try {
        const timeoutMs = Math.min(Number(request?.timeoutMs) || MAIRA_MS_WITH_BACKUP, MAIRA_MS_WITH_BACKUP);
        return await maira.ask({ ...request, timeoutMs });
      } catch (error) {
        if (!RETRY_ON_GATEWAY.has(error?.code) || request?.signal?.aborted) throw error;
        // Only the error code: no prompt, no key.
        console.warn("maira failed, using backup", error?.code);
        if (error?.code === "credentials_rejected") skipUntil = now() + SKIP_REJECTED_MS;
        else if (SKIP_UNAVAILABLE.has(error?.code)) skipUntil = now() + SKIP_UNAVAILABLE_MS;
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
