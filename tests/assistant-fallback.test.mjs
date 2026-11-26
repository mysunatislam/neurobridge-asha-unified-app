import assert from "node:assert/strict";
import test from "node:test";
import { createAshaOrchestrator } from "../src/server/lib/asha-orchestrator.js";
import { MairaProviderError } from "../src/server/lib/maira-provider.js";
import { guideAnswer } from "../src/lib/guide-answer.js";

const profile = { assessment: {}, supportContext: {} };
const ok = (text, task) => ({ text, model: "m-" + task, task, profileName: "test", elapsedMs: 1, fallback: false });

function scripted(steps) {
  const calls = [];
  return {
    calls,
    ask: async (input) => {
      calls.push(input);
      const step = steps[calls.length - 1];
      if (step instanceof Error) throw step;
      return ok(step, input.task);
    },
  };
}

test("a failed route moves to the other route once and the reply is valid", async () => {
  const provider = scripted([
    new MairaProviderError("timeout", "slow", 504),
    '{"reply":"Hello, I am Asha.","source_ids":[],"tool_calls":[]}',
  ]);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hello" });
  assert.equal(result.reply, "Hello, I am Asha.");
  assert.deepEqual(provider.calls.map((c) => c.task), ["conversation", "bilingual"]);
  assert.equal(result.orchestration.rerouted, true);
  assert.ok(provider.calls[0].timeoutMs <= 24000);
});

test("when every route fails, Asha answers from its guide instead of an error", async () => {
  const provider = scripted([
    new MairaProviderError("provider_unavailable", "down"),
    new MairaProviderError("model_unavailable", "gone", 503),
  ]);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "What can you help me with?" });
  assert.equal(result.answeredBy, "guide");
  assert.match(result.reply, /FaceSpeak|EyeSpeak/);
  assert.match(result.notice, /guide/);
  assert.equal(result.orchestration.model, "asha-guide");
});

test("an explicit need still opens a confirmation when the AI is down", async () => {
  const provider = scripted([new MairaProviderError("connection_failed", "x"), new MairaProviderError("connection_failed", "x")]);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "I need water" });
  assert.equal(result.proposal.kind, "water");
});

test("missing configuration is not retried and still answers", async () => {
  const provider = scripted([new MairaProviderError("not_configured", "no", 503)]);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "how does VitalSense work" });
  assert.equal(provider.calls.length, 1);
  assert.match(result.reply, /VitalSense/);
});

test("JSON wrapped in prose or fences is parsed, and raw JSON is never shown", async () => {
  const wrapped = scripted(['Sure! Here it is:\n```json\n{"reply":"Drink some water now.","source_ids":[]}\n```']);
  const a = await createAshaOrchestrator({ provider: wrapped, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hi" });
  assert.equal(a.reply, "Drink some water now.");
  assert.equal(a.orchestration.verified, true);

  const broken = scripted(['{"reply": "Half an answer", "source_ids": [', '{"reply": "Half an answer", "source_ids": [']);
  const b = await createAshaOrchestrator({ provider: broken, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hi" });
  assert.equal(b.reply, "Half an answer");
  assert.doesNotMatch(b.reply, /source_ids|\{/);
});

test("an unusable answer is retried on the other route", async () => {
  const provider = scripted(['{"tool_calls":[]}', '{"reply":"Second route answer.","source_ids":[]}']);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hi" });
  assert.equal(result.reply, "Second route answer.");
});

test("an invented citation drops the citation but keeps the reply text", async () => {
  const provider = scripted(['{"reply":"FaceSpeak reads blinks.","source_ids":["made:up"]}']);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "what is facespeak" });
  assert.equal(result.reply, "FaceSpeak reads blinks.");
  assert.deepEqual(result.sources, []);
  assert.equal(result.orchestration.verified, false);
});

test("speech clarification keeps the heard words when the AI is down", async () => {
  const provider = scripted([new MairaProviderError("timeout", "x", 504), new MairaProviderError("timeout", "x", 504)]);
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "wed wabbit", mode: "interpret" });
  assert.equal(result.candidate, "wed wabbit");
  assert.match(result.question, /Is this what you said/);
});

test("guide answers never come back empty, in English or Bangla", () => {
  for (const q of ["", "hello", "what is eyespeak", "how do I ask for water", "zzzz", "আপনি কে", "হাত দিয়ে কীভাবে বলব"]) {
    const g = guideAnswer({ query: q });
    assert.ok(g.reply.length > 20, q);
  }
  assert.match(guideAnswer({ query: "আপনি কে" }).reply, /[ঀ-৿]/u);
});

test("with an AI Gateway key, a rejected MAIRA key falls back to the gateway", async () => {
  const { createLlmProvider } = await import("../src/server/lib/llm-provider.js");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    if (String(url).includes("gigalogy")) return new Response("{}", { status: 401 });
    assert.match(init.headers.authorization, /^Bearer gw-test$/);
    return Response.json({ choices: [{ message: { content: '{"reply":"Hi from the backup.","source_ids":[]}' } }] });
  };
  const provider = createLlmProvider({ env: { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p", AI_GATEWAY_API_KEY: "gw-test" }, fetchImpl });
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hello" });
  assert.equal(result.reply, "Hi from the backup.");
  assert.equal(result.orchestration.model, "google/gemini-2.5-flash");
  assert.ok(seen.some((u) => u.includes("ai-gateway.vercel.sh")));
  // Without the key nothing changes: MAIRA only.
  assert.equal(createLlmProvider({ env: { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p" }, fetchImpl }).kind, "maira");
});

test("on Vercel the gateway needs no key: it uses the deployment's OIDC token, and skips a rejected MAIRA key", async () => {
  const { createLlmProvider } = await import("../src/server/lib/llm-provider.js");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    if (String(url).includes("gigalogy")) return new Response("{}", { status: 403 });
    assert.match(init.headers.authorization, /^Bearer oidc-test$/);
    return Response.json({ choices: [{ message: { content: '{"reply":"Hi without a key.","source_ids":[]}' } }] });
  };
  const env = { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p", VERCEL: "1", VERCEL_OIDC_TOKEN: "oidc-test" };
  const provider = createLlmProvider({ env, fetchImpl });
  const o = createAshaOrchestrator({ provider, retrieve: () => [] });
  assert.equal((await o.run({ patientId: "p", profile, text: "Hello" })).reply, "Hi without a key.");
  const mairaCalls = seen.filter((u) => u.includes("gigalogy")).length;
  assert.equal((await o.run({ patientId: "p", profile, text: "Hello again" })).reply, "Hi without a key.");
  assert.equal(seen.filter((u) => u.includes("gigalogy")).length, mairaCalls, "rejected MAIRA key is not retried at once");
  // Off switch, and outside Vercel with no key: no gateway.
  const { createGatewayProvider } = await import("../src/server/lib/gateway-provider.js");
  assert.equal(createGatewayProvider({ env: { ...env, ASHA_GATEWAY: "off" } }).configured(), false);
  assert.equal(createGatewayProvider({ env: {} }).configured(), false);
});

test("a MAIRA outage is skipped for a while so replies do not wait on it", async () => {
  const { createLlmProvider } = await import("../src/server/lib/llm-provider.js");
  let maira = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("gigalogy")) {
      maira += 1;
      return new Response("{}", { status: 503 });
    }
    return Response.json({ choices: [{ message: { content: '{"reply":"Backup reply.","source_ids":[]}' } }] });
  };
  const provider = createLlmProvider({ env: { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p", GEMINI_API_KEY: "g" }, fetchImpl });
  const o = createAshaOrchestrator({ provider, retrieve: () => [] });
  assert.equal((await o.run({ patientId: "p", profile, text: "Hello" })).reply, "Backup reply.");
  const after = maira;
  assert.ok(after >= 1);
  assert.equal((await o.run({ patientId: "p", profile, text: "Hello again" })).reply, "Backup reply.");
  assert.equal(maira, after);
});

test("an exhausted gateway allowance still ends in a guide answer", async () => {
  const { createLlmProvider } = await import("../src/server/lib/llm-provider.js");
  const fetchImpl = async (url) =>
    String(url).includes("gigalogy") ? new Response("{}", { status: 401 }) : new Response("{}", { status: 402 });
  const provider = createLlmProvider({ env: { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p", VERCEL_OIDC_TOKEN: "t" }, fetchImpl });
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "What can you do?" });
  assert.equal(result.orchestration.model, "asha-guide");
  assert.ok(result.reply.length > 20);
});

test("a free Gemini key alone answers through Google's OpenAI-compatible endpoint", async () => {
  const { createLlmProvider } = await import("../src/server/lib/llm-provider.js");
  let body;
  const tried = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("gigalogy")) return new Response("{}", { status: 401 });
    tried.push(JSON.parse(init.body).model);
    if (tried.length === 1) return Response.json([{ error: { code: 503, status: "UNAVAILABLE" } }], { status: 503 });
    assert.match(String(url), /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
    assert.match(init.headers.authorization, /^Bearer gm-test$/);
    body = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: '{"reply":"Hi from Gemini.","source_ids":[]}' } }] });
  };
  const provider = createLlmProvider({ env: { MAIRA_API_KEY: "k", MAIRA_PROJECT_KEY: "p", GEMINI_API_KEY: "gm-test" }, fetchImpl });
  const result = await createAshaOrchestrator({ provider, retrieve: () => [] }).run({ patientId: "p", profile, text: "Hello" });
  assert.equal(result.reply, "Hi from Gemini.");
  assert.deepEqual(tried, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], "an overloaded model falls through to the next");
  assert.equal(result.orchestration.model, "gemini-3.1-flash-lite");
  assert.equal(body.reasoning_effort, "minimal");
});

test("the guide answers everyday wellbeing safely and sends emergencies to a real number", () => {
  const cases = [
    ["Tell me a short tip for staying cool", /water/],
    ["I feel a bit dizzy and the room is hot", /sit or lie down/],
    ["My back hurts", /can't advise on medicines/],
    ["I feel lonely today", /don't have to carry/],
    ["I have chest pain", /emergency number/],
    ["How does Health outlook use heat?", /Health outlook combines/],
  ];
  for (const [query, pattern] of cases) assert.match(guideAnswer({ query }).reply, pattern, query);
  assert.equal(guideAnswer({ query: "I can't breathe" }).urgent, true);
  assert.match(guideAnswer({ query: "আজ আমার খুব ক্লান্ত লাগছে" }).reply, /ক্লান্ত/u);
  assert.match(guideAnswer({ query: "বুকে ব্যথা করছে" }).reply, /৯৯৯/u);
  for (const query of ["I feel dizzy", "My back hurts", "I am tired"])
    assert.doesNotMatch(guideAnswer({ query }).reply, /diagnos|you have|take \d|mg\b/i, query);
});

test("help with one specific need proposes that need, in English and Bangla", async () => {
  const provider = scripted(Array(6).fill('{"reply":"Okay.","source_ids":[],"tool_calls":[]}'));
  const o = createAshaOrchestrator({ provider, retrieve: () => [] });
  for (const [text, kind] of [
    ["Please help me go to the toilet", "toilet"],
    ["I need help getting water", "water"],
    ["আমার টয়লেটে যেতে সাহায্য দরকার", "toilet"],
  ]) {
    const r = await o.run({ patientId: "p", profile, text });
    assert.equal(r.proposal?.kind, kind, text);
  }
  const both = await o.run({ patientId: "p", profile, text: "Please help me with water and food" });
  assert.equal(both.proposal, undefined);
});
