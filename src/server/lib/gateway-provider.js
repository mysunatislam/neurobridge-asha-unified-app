import { getVercelOidcToken } from "@vercel/oidc";
import { MairaProviderError } from "./maira-provider.js";

// Backup cloud route, OpenAI-compatible: Vercel AI Gateway, or Google Gemini
// directly when only GEMINI_API_KEY is set (a free Google AI Studio key, no card).
// Used when MAIRA could not answer. It needs no key of its own on Vercel: the
// deployment's OIDC token authenticates it (AI_GATEWAY_API_KEY wins if set).
// ASHA_GATEWAY=off turns it off. Same
// ask() contract and error type as the MAIRA provider; the prompt is the same
// app-built prompt, so retrieval, tool verification and safety are unchanged.
const ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Fast, free-tier Gemini models; the next one is tried when one is overloaded (503).
const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];
const MAX_MS = 15000;

async function defaultToken(env) {
  if (env.AI_GATEWAY_API_KEY) return env.AI_GATEWAY_API_KEY;
  try {
    return await getVercelOidcToken();
  } catch {
    return env.VERCEL_OIDC_TOKEN || "";
  }
}

export function createGatewayProvider({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  token = defaultToken,
} = {}) {
  const gemini = Boolean(env.GEMINI_API_KEY) && !env.AI_GATEWAY_API_KEY;
  const models = gemini
    ? env.GEMINI_MODEL
      ? [env.GEMINI_MODEL]
      : GEMINI_MODELS
    : [env.AI_GATEWAY_MODEL || DEFAULT_MODEL];
  const endpoint = gemini ? GEMINI_ENDPOINT : ENDPOINT;
  const configured = () =>
    String(env.ASHA_GATEWAY || "").toLowerCase() !== "off" &&
    Boolean(
      env.AI_GATEWAY_API_KEY ||
        env.GEMINI_API_KEY ||
        env.VERCEL_OIDC_TOKEN ||
        env.VERCEL === "1",
    );
  async function ask({
    task = "conversation",
    query,
    signal,
    timeoutMs = MAX_MS,
  } = {}) {
    const bearer = !configured()
      ? ""
      : gemini
        ? env.GEMINI_API_KEY
        : await token(env);
    if (!bearer)
      throw new MairaProviderError(
        "not_configured",
        "The backup AI route is not configured.",
        503,
      );
    if (typeof query !== "string" || !query.trim() || query.length > 20000)
      throw new MairaProviderError(
        "invalid_request",
        "Asha needs a valid task, message, and session.",
        400,
      );
    const started = now();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(
      stop,
      Math.max(1000, Math.min(MAX_MS, Number(timeoutMs) || MAX_MS)),
    );
    try {
      let response;
      let model;
      for (model of models) {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: query }],
            max_tokens: 400,
            temperature: 0.3,
            // Gemini models think by default, which is slow and uses up the reply's tokens.
            ...(gemini ? { reasoning_effort: "minimal" } : {}),
          }),
          signal: controller.signal,
        });
        if (response.status !== 503) break;
      }
      if (!response.ok) {
        // The gateway's own reason (no prompt, no token) so a refusal can be fixed.
        const raw = await response
          .clone()
          .json()
          .catch(() => null);
        const body = Array.isArray(raw) ? raw[0] : raw;
        console.warn(
          gemini ? "gemini refused" : "ai-gateway refused",
          response.status,
          String(body?.error?.type || body?.error?.code || ""),
          String(body?.error?.message || "").slice(0, 200),
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new MairaProviderError(
          "credentials_rejected",
          "Asha's AI connection needs its server credentials checked.",
          503,
        );
      if (response.status === 402)
        throw new MairaProviderError(
          "provider_busy",
          "Asha's backup AI has used its free allowance for now.",
          429,
        );
      if (response.status === 429)
        throw new MairaProviderError(
          "provider_busy",
          "Asha's AI service is busy. Please try again shortly.",
          429,
        );
      if (!response.ok)
        throw new MairaProviderError(
          "provider_unavailable",
          "Asha's selected AI service is temporarily unavailable.",
        );
      const data = await response.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim())
        throw new MairaProviderError(
          "invalid_response",
          "Asha returned no usable reply. Please try again.",
        );
      return {
        text: text.trim(),
        model,
        profileName: gemini ? "gemini" : "ai-gateway",
        task,
        elapsedMs: Math.max(0, now() - started),
        fallback: true,
      };
    } catch (error) {
      if (error instanceof MairaProviderError) throw error;
      if (signal?.aborted)
        throw new MairaProviderError(
          "cancelled",
          "The Asha request was cancelled.",
          499,
        );
      if (controller.signal.aborted)
        throw new MairaProviderError(
          "timeout",
          "Asha is taking longer than expected. Please try again.",
          504,
        );
      throw new MairaProviderError(
        "connection_failed",
        "Asha's AI service could not be reached. Please try again.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
  return { ask, warm() {}, configured, kind: "ai-gateway" };
}
