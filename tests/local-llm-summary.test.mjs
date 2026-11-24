import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarize } from "../scripts/local-llm-summary.mjs";
import { CASES } from "../scripts/local-llm-cases.mjs";
import { OLLAMA_MODELS } from "../src/server/lib/ollama-provider.js";

const report = JSON.parse(
  await readFile(new URL("../docs/local-llm-eval.json", import.meta.url)),
);
const committed = JSON.parse(
  await readFile(
    new URL("../docs/local-llm-eval-summary.json", import.meta.url),
  ),
);

test("The committed local LLM summary matches the raw report", () => {
  assert.deepEqual(summarize(report, CASES), committed);
});

test("Every case in the report is one of the fixed cases", () => {
  assert.deepEqual(
    report.cases.map((c) => c.id),
    CASES.map((c) => c.id),
  );
});

test("No local model proposed a request the patient did not ask for", () => {
  const unasked = new Set(
    CASES.filter((c) => c.expect === null).map((c) => c.id),
  );
  for (const result of report.results)
    for (const row of result.rows)
      if (unasked.has(row.case)) assert.equal(row.finalProposal, null);
});

test("Each task defaults to the model that did best in the local eval", () => {
  const best = committed.models.reduce((a, b) =>
    b.validJson[0] > a.validJson[0] ||
    (b.validJson[0] === a.validJson[0] && b.medianMs < a.medianMs)
      ? b
      : a,
  );
  for (const route of OLLAMA_MODELS) assert.equal(route.model, best.model);
});
