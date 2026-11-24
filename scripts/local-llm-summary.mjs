#!/usr/bin/env node
// Counts behind docs/LOCAL_LLM_EVAL.md and the /ai page, from a report written
// by scripts/local-llm-eval.mjs. It separates what the model did from what
// Asha's own checks did: a caregiver request is only proposed when Asha's
// request rules agree, and those rules can add a request the model left out.
//
//   node scripts/local-llm-summary.mjs [docs/local-llm-eval.json]
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CASES } from "./local-llm-cases.mjs";

// What `ollama show` reported on the machine that produced the 18 Nov 2026
// report, which predates the script recording it.
const KNOWN_DETAILS = {
  "qwen2.5:1.5b": { quantization: "Q4_K_M", parameters: "1.5B" },
  "llama3.2:1b": { quantization: "Q8_0", parameters: "1.2B" },
  "gemma2:2b": { quantization: "Q4_0", parameters: "2.6B" },
  "deepseek-r1:1.5b": { quantization: "Q4_K_M", parameters: "1.8B" },
};

const count = (rows, test) => rows.filter(test).length;

export function summarize(report, cases = CASES) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return {
    ranAt: report.ranAt,
    machine: report.machine,
    ollama: report.ollama,
    cases: cases.length,
    models: report.results
      .filter((r) => !r.skipped)
      .map((r) => {
        const rows = r.rows.map((row) => ({ row, c: byId.get(row.case) }));
        const chat = rows.filter(({ c }) => (c.mode || "chat") === "chat");
        const asked = chat.filter(({ c }) => c.expect);
        const notAsked = chat.filter(({ c }) => c.expect === null);
        const speech = rows.filter(({ c }) => c.mode === "interpret");
        const bnChat = chat.filter(({ c }) => c.language === "bn");
        const grounded = chat.filter(({ c }) => c.grounded);
        const injection = chat.filter(({ c }) => c.injection);
        const pair = (list, test) => [count(list, test), list.length];
        return {
          model: r.model,
          ...(r.details || KNOWN_DETAILS[r.model] || {}),
          loadMs: r.loadMs,
          medianMs: r.medianMs,
          p95Ms: r.p95Ms,
          validJson: pair(rows, ({ row }) => row.json),
          errors: pair(rows, ({ row }) => Boolean(row.error)),
          // The right request, or none, after Asha's checks.
          rightRequest: pair(
            chat,
            ({ row, c }) => !row.error && row.finalProposal === c.expect,
          ),
          // The model itself returned the right propose_caregiver_request call.
          modelCalledTool: pair(
            asked,
            ({ row, c }) => row.modelTool === c.expect,
          ),
          noRequestWhenNotAsked: pair(
            notAsked,
            ({ row }) => !row.error && row.finalProposal === null,
          ),
          injectionSafe: pair(injection, ({ row }) => row.safe === true),
          speechCorrect: pair(speech, ({ row }) => row.correct),
          banglaReplies: pair(
            bnChat,
            ({ row }) => (row.banglaShare || 0) >= 0.5,
          ),
          citedSource: pair(grounded, ({ row }) => row.cited === true),
        };
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const input = process.argv[2] || "docs/local-llm-eval.json";
  const report = JSON.parse(await readFile(input, "utf8"));
  const out = input.replace(/\.json$/, "") + "-summary.json";
  await writeFile(out, JSON.stringify(summarize(report), null, 2) + "\n");
  console.log(`Wrote ${out}`);
}
