import { MairaProviderError } from "./maira-provider.js";

// Local LLM mode: the same ask() contract as the Maira provider, answered by
// small open models in Ollama on the clinic's or family's own computer. No
// message leaves that machine. Defaults come from scripts/local-llm-eval.mjs
// (docs/LOCAL_LLM_EVAL.md); each task can be overridden per deployment.
export const OLLAMA_MODELS = Object.freeze([
  Object.freeze({
    task: "conversation",
    model: "qwen2.5:1.5b",
    envKey: "OLLAMA_CHAT_MODEL",
    use: "English chat with verified JSON tool calls",
  }),
  Object.freeze({
    task: "bilingual",
    // qwen2.5 kept 4 of 4 Bangla replies in Bangla and valid JSON; gemma2:2b
    // kept 3 of 4 at about twice the time (docs/LOCAL_LLM_EVAL.md).
    model: "qwen2.5:1.5b",
    envKey: "OLLAMA_BILINGUAL_MODEL",
    use: "Bangla and mixed Bangla-English chat",
  }),
  Object.freeze({
    task: "speech",
    model: "qwen2.5:1.5b",
    envKey: "OLLAMA_SPEECH_MODEL",
    use: "Clarifying heard words for the patient to confirm",
  }),
]);
export const OLLAMA_CANDIDATES = Object.freeze([
  "qwen2.5:1.5b",
  "llama3.2:1b",
  "gemma2:2b",
  "deepseek-r1:1.5b",
]);
const DEFAULT_BASE = "http://127.0.0.1:11434";
const ASK_TIMEOUT_MS = 90000;
const PROBE_TIMEOUT_MS = 3000;

const cancelled = () =>
  new MairaProviderError("cancelled", "The Asha request was cancelled.", 499);

// Reasoning models print their chain of thought first; only the answer counts.
export const stripReasoning = (text) =>
  String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

export function createOllamaProvider({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const base = String(env.OLLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const modelFor = (task) => {
    const route =
      OLLAMA_MODELS.find((m) => m.task === task) || OLLAMA_MODELS[0];
    return env[route.envKey] || route.model;
  };

  async function call(pathname, payload, timeoutMs, signal) {
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    try {
      const response = await fetchImpl(base + pathname, {
        method: payload ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      });
      if (response.status === 404)
        throw new MairaProviderError(
          "model_unavailable",
          "The local model for this task is not installed. Run 'ollama pull' for it on this computer.",
          503,
        );
      if (!response.ok)
        throw new MairaProviderError(
          "provider_unavailable",
          "Asha's local AI is temporarily unavailable.",
        );
      return await response.json();
    } catch (error) {
      if (error instanceof MairaProviderError) throw error;
      if (signal?.aborted) throw cancelled();
      if (controller.signal.aborted)
        throw new MairaProviderError(
          "timeout",
          "Asha's local AI is taking longer than expected. Please try again.",
          504,
        );
      throw new MairaProviderError(
        "connection_failed",
        "Asha's local AI is not running on this computer. Start Ollama and try again.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  async function ask({
    task = "conversation",
    query,
    patientId,
    language = "auto",
    module = "companion",
    signal,
  } = {}) {
    const started = now();
    if (
      !OLLAMA_MODELS.some((m) => m.task === task) ||
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 20000 ||
      typeof patientId !== "string" ||
      !patientId.trim()
    )
      throw new MairaProviderError(
        "invalid_request",
        "Asha needs a valid task, message, and session.",
        400,
      );
    const model = modelFor(task);
    const data = await call(
      "/api/chat",
      {
        model,
        messages: [{ role: "user", content: query }],
        stream: false,
        // Both orchestrator prompts require one JSON object; constrained
        // decoding keeps small models inside that contract.
        format: "json",
        keep_alive: "15m",
        options: { temperature: 0.2, num_ctx: 4096, num_predict: 320 },
      },
      ASK_TIMEOUT_MS,
      signal,
    );
    const text = stripReasoning(data?.message?.content ?? "");
    if (!text)
      throw new MairaProviderError(
        "invalid_response",
        "Asha's local AI returned no usable reply. Please try again.",
      );
    return {
      text,
      model,
      profileName: "ollama-local",
      task,
      language,
      module,
      elapsedMs: Math.max(0, now() - started),
      evalCount: Number(data?.eval_count) || 0,
      fallback: false,
    };
  }

  /** Installed models, or null when Ollama is not reachable. */
  async function installed() {
    try {
      const data = await call("/api/tags", null, PROBE_TIMEOUT_MS);
      return Array.isArray(data?.models)
        ? data.models.map((m) => String(m.name))
        : [];
    } catch {
      return null;
    }
  }

  return {
    ask,
    installed,
    warm() {},
    configured: () => true,
    kind: "ollama",
    modelFor,
  };
}
