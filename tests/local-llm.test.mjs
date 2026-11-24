import test from "node:test";
import assert from "node:assert/strict";
import {
  createOllamaProvider,
  stripReasoning,
  OLLAMA_MODELS,
} from "../src/server/lib/ollama-provider.js";
import { createLlmProvider } from "../src/server/lib/llm-provider.js";
import { createAshaOrchestrator } from "../src/server/lib/asha-orchestrator.js";

const input = {
  query: "A nonidentifying test message.",
  patientId: "demo-test",
};

function fakeOllama(reply, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/api/tags"))
      return Response.json({
        models: [{ name: "qwen2.5:1.5b" }, { name: "gemma2:2b" }],
      });
    return Response.json({
      message: {
        role: "assistant",
        content: typeof reply === "function" ? reply() : reply,
      },
      eval_count: 12,
    });
  };
}

test("The Ollama provider routes each task to its local model with JSON decoding on loopback", async () => {
  const calls = [];
  const provider = createOllamaProvider({
    env: {},
    fetchImpl: fakeOllama('{"reply":"Hi"}', calls),
  });
  for (const { task } of OLLAMA_MODELS) await provider.ask({ ...input, task });
  assert.ok(
    calls.every((c) => c.url.startsWith("http://127.0.0.1:11434/api/chat")),
  );
  assert.deepEqual(
    calls.map((c) => c.body.model),
    OLLAMA_MODELS.map((m) => m.model),
  );
  assert.ok(
    calls.every((c) => c.body.format === "json" && c.body.stream === false),
  );
  const overridden = createOllamaProvider({
    env: {
      OLLAMA_BILINGUAL_MODEL: "llama3.2:1b",
      OLLAMA_BASE_URL: "http://10.0.0.5:11434/",
    },
    fetchImpl: fakeOllama('{"reply":"Hi"}', calls),
  });
  const out = await overridden.ask({ ...input, task: "bilingual" });
  assert.equal(out.model, "llama3.2:1b");
  assert.equal(calls.at(-1).url, "http://10.0.0.5:11434/api/chat");
  assert.deepEqual(await overridden.installed(), ["qwen2.5:1.5b", "gemma2:2b"]);
});

test("Reasoning text is removed and connection failures get a plain local message", async () => {
  assert.equal(
    stripReasoning('<think>steps</think>\n{"reply":"ok"}'),
    '{"reply":"ok"}',
  );
  const down = createOllamaProvider({
    env: {},
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(
    down.ask(input),
    (e) => e.code === "connection_failed" && /Ollama/.test(e.message),
  );
  assert.equal(await down.installed(), null);
  const missing = createOllamaProvider({
    env: {},
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  await assert.rejects(
    missing.ask(input),
    (e) => e.code === "model_unavailable",
  );
  await assert.rejects(
    createOllamaProvider({ env: {}, fetchImpl: fakeOllama("x") }).ask({
      ...input,
      task: "unknown",
    }),
    (e) => e.code === "invalid_request",
  );
});

test("Provider selection: cloud by default, local only, or cloud with a local fallback", async () => {
  const cloudEnv = { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p" };
  assert.equal(createLlmProvider({ env: cloudEnv }).kind, "maira");
  assert.equal(
    createLlmProvider({ env: { ASHA_LLM_PROVIDER: "ollama" } }).kind,
    "ollama",
  );
  assert.equal(createLlmProvider({ env: {} }).configured(), false);

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(url);
    if (url.includes("gigalogy")) throw new TypeError("offline");
    return fakeOllama('{"reply":"Local reply"}')(url, options);
  };
  const hybrid = createLlmProvider({
    env: { ...cloudEnv, ASHA_LLM_PROVIDER: "maira-local" },
    fetchImpl,
  });
  const out = await hybrid.ask({ ...input, task: "conversation" });
  assert.equal(out.fallback, true);
  assert.equal(out.model, "qwen2.5:1.5b");
  assert.ok(
    calls.some((u) => u.includes("gigalogy")) &&
      calls.some((u) => u.includes("11434")),
  );

  // A rejected request is never retried on another model.
  await assert.rejects(
    hybrid.ask({ ...input, task: "conversation", query: "" }),
    (e) => e.code === "invalid_request",
  );
});

test("The orchestrator verifies a local model's tool call exactly as it does the cloud's", async () => {
  const provider = createOllamaProvider({
    env: {},
    fetchImpl: fakeOllama(
      '{"reply":"I can ask your caregiver for water.","source_ids":[],"tool_calls":[{"name":"propose_caregiver_request","arguments":{"kind":"water"}},{"name":"call_ambulance","arguments":{}}]}',
    ),
  });
  const asha = createAshaOrchestrator({ provider });
  const result = await asha.run({
    patientId: "demo-test",
    profile: {},
    text: "I need water please",
    language: "en",
  });
  assert.equal(result.orchestration.model, "qwen2.5:1.5b");
  assert.equal(result.orchestration.provider, "ollama-local");
  assert.equal(result.proposal.kind, "water");
  const steps = Object.fromEntries(
    result.orchestration.steps.map((s) => [s.tool, s]),
  );
  assert.ok(steps.local_generate && !steps.maira_generate);
  // The unknown tool is rejected, the allowed one only opens a confirmation.
  assert.equal(steps.verify_tool_calls.accepted, 1);
  assert.equal(steps.verify_tool_calls.rejected, 1);
});
