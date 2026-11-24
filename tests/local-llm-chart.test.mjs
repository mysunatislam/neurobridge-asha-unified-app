import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDER, SUMMARY_PATH, SVG_PATH, chartSpec, renderSvg } from "../scripts/local-llm-chart.mjs";

const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));

test("the reply-time chart on /ai matches the committed eval summary", async () => {
  assert.equal(readFileSync(SVG_PATH, "utf8"), await renderSvg(summary), "run node scripts/local-llm-chart.mjs");
});

test("every model in the summary is drawn, in the table's order, in seconds", () => {
  const values = chartSpec(summary).data.values;
  assert.deepEqual(values.map((v) => v.model), ORDER);
  assert.equal(values.length, summary.models.length);
  for (const v of values) {
    const m = summary.models.find((x) => x.model === v.model);
    assert.equal(v.median, Math.round(m.medianMs / 100) / 10);
    assert.ok(v.p95 >= v.median);
  }
});
