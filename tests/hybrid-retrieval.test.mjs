import test from "node:test";
import assert from "node:assert/strict";
import { createHybridRetriever } from "../src/server/lib/hybrid-retrieval.js";
import { rewriteQuery } from "../src/server/lib/retrieval.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "x".repeat(40),
};
const row = (id, concept, body, via = "hybrid") => ({
  id,
  concept_id: concept,
  title: "Guide",
  body,
  score: 0.03,
  via,
  provenance: "okf",
});

test("Bangla questions are rewritten to the lexicon's English terms before hybrid search", async () => {
  const { terms, rewrites } = rewriteQuery("সাধারণ পলকে কি অনুরোধ চলে যায়?");
  assert.ok(terms.includes("blink") && terms.includes("request"));
  assert.deepEqual(
    rewrites.map(([, en]) => en),
    ["blink", "request"],
  );
  let sent;
  const retriever = createHybridRetriever({
    env,
    fetchImpl: async (url, options) => {
      sent = { url: String(url), options, body: JSON.parse(options.body) };
      return Response.json({
        passages: [
          row(
            "guide:companion#7-9",
            "guide:companion",
            "Ordinary blinks never initiate or confirm requests.",
          ),
        ],
        related: [],
      });
    },
  });
  const out = await retriever.retrieve({
    query: "সাধারণ পলকে কি অনুরোধ চলে যায়?",
  });
  assert.equal(
    sent.url,
    "https://example.supabase.co/functions/v1/asha-knowledge",
  );
  assert.equal(sent.options.headers.apikey, env.SUPABASE_SECRET_KEY);
  assert.equal(sent.options.headers.authorization, undefined);
  // Runs next to the Tokyo database unless ASHA_KNOWLEDGE_REGION says otherwise.
  assert.equal(sent.options.headers["x-region"], "ap-northeast-1");
  assert.ok(sent.body.terms.includes("blink"));
  assert.equal(out[0].id, "guide:companion#7-9");
  assert.equal(out[0].retrieval, "hybrid");
});

test("Confirmed speech pairs stay on the server and are merged ahead of guide passages", async () => {
  let body;
  const retriever = createHybridRetriever({
    env,
    fetchImpl: async (_url, options) => {
      body = options.body;
      return Response.json({
        passages: [
          row(
            "guide:senseassist#1-2",
            "guide:senseassist",
            "Two uses: gentle phrase practice.",
          ),
        ],
        related: [
          row(
            "guide:assessment#1-2",
            "guide:assessment",
            "Recommend SenseAssist.",
            "graph:mentions",
          ),
        ],
      });
    },
  });
  const memories = [{ confirmed: true, heard: "wawa", confirmedText: "water" }];
  const out = await retriever.retrieve({ query: "wawa", memories, limit: 3 });
  assert.ok(!body.includes("confirmedText") && !body.includes("water"));
  assert.equal(out[0].source, "confirmed-speech");
  assert.equal(out[1].id, "guide:senseassist#1-2");
  assert.equal(out[2].retrieval, "graph:mentions");
});

test("The best graph neighbour takes the third slot, after the top two hybrid passages", async () => {
  const retriever = createHybridRetriever({
    env,
    fetchImpl: async () =>
      Response.json({
        passages: [
          row(
            "guide:caregiver#1-3",
            "guide:caregiver",
            "Use the private caregiver link.",
          ),
          row(
            "guide:caregiver#4-6",
            "guide:caregiver",
            "Acknowledge a request from the alert.",
          ),
          row(
            "guide:companion#1-2",
            "guide:companion",
            "Confirm before sending.",
          ),
        ],
        related: [
          row(
            "guide:companion#7-9",
            "guide:companion",
            "Ordinary blinks never confirm.",
            "graph:mentions",
          ),
        ],
      }),
  });
  const out = await retriever.retrieve({
    query: "How does the caregiver acknowledge a request?",
    limit: 3,
  });
  assert.deepEqual(
    out.map((p) => p.id),
    ["guide:caregiver#1-3", "guide:caregiver#4-6", "guide:companion#7-9"],
  );
});

test("Any hybrid failure, timeout or missing configuration falls back to local BM25", async () => {
  const query = "Do ordinary blinks confirm a request?";
  const offline = createHybridRetriever({ env: {} });
  assert.equal(offline.enabled, false);
  const local = await offline.retrieve({ query });
  assert.ok(local.length && local.every((p) => !p.retrieval));
  for (const fetchImpl of [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => new Response("{}", { status: 503 }),
    async () => Response.json({ nope: true }),
  ]) {
    const out = await createHybridRetriever({ env, fetchImpl }).retrieve({
      query,
    });
    assert.deepEqual(out, local);
  }
  const slow = createHybridRetriever({
    env,
    timeoutMs: 20,
    // A stalled network request; the ref'd timer stands in for its open socket.
    fetchImpl: (_url, { signal }) =>
      new Promise((_, reject) => {
        const socket = setTimeout(() => {}, 5000);
        signal.addEventListener("abort", () => {
          clearTimeout(socket);
          reject(signal.reason);
        });
      }),
  });
  assert.deepEqual(await slow.retrieve({ query }), local);
  const disabled = createHybridRetriever({
    env: { ...env, ASHA_HYBRID_RETRIEVAL: "0" },
  });
  assert.equal(disabled.enabled, false);
});

test("Repeated questions reuse the cached hybrid result", async () => {
  let calls = 0;
  const retriever = createHybridRetriever({
    env,
    fetchImpl: async () => {
      calls++;
      return Response.json({
        passages: [
          row(
            "guide:caregiver#1-3",
            "guide:caregiver",
            "Use the private caregiver link.",
          ),
        ],
        related: [],
      });
    },
  });
  await retriever.retrieve({ query: "How does my daughter see requests?" });
  await retriever.retrieve({ query: "How does my daughter see requests?" });
  assert.equal(calls, 1);
});

test("An empty ASHA_KNOWLEDGE_REGION lets Supabase pick the region", async () => {
  let headers;
  const retriever = createHybridRetriever({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_" + "x".repeat(40),
      ASHA_KNOWLEDGE_REGION: "",
    },
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return Response.json({ passages: [], related: [] });
    },
  });
  await retriever.retrieve({ query: "How do caregivers acknowledge?" });
  assert.equal(headers["x-region"], undefined);
});
