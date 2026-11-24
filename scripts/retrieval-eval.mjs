#!/usr/bin/env node
// Retrieval eval for ASHA's app guides (okf/eval/retrieval-cases.json).
// Compares the in-app BM25 baseline with the Supabase hybrid index
// (semantic only, full text only, hybrid RRF, hybrid + knowledge graph),
// each with and without bilingual query rewriting.
//
//   node scripts/retrieval-eval.mjs --payloads          print the eval request batches
//   node scripts/retrieval-eval.mjs --rows rows.json    score saved edge-function rows
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/retrieval-eval.mjs
import { readFile, writeFile } from "node:fs/promises";
import {
  retrieveKnowledge,
  rewriteQuery,
} from "../src/server/lib/retrieval.js";

const { cases } = JSON.parse(
  await readFile(
    new URL("../okf/eval/retrieval-cases.json", import.meta.url),
    "utf8",
  ),
);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const BATCH = 6;

export function payloads() {
  const enriched = cases.map((c) => {
    const { terms, rawTerms } = rewriteQuery(c.query);
    return { ...c, terms, rawTerms };
  });
  const batches = [];
  for (let i = 0; i < enriched.length; i += BATCH)
    batches.push({ action: "eval", cases: enriched.slice(i, i + BATCH) });
  return batches;
}

const conceptOf = (id) => String(id).replace(/:\d+$/, "");
function score(ranked, expected, k = 3, maxRank = 5) {
  const first = ranked.slice(0, maxRank).findIndex((c) => expected.includes(c));
  return {
    hit: ranked.slice(0, k).some((c) => expected.includes(c)),
    reciprocalRank: first >= 0 ? 1 / (first + 1) : 0,
  };
}

function bm25Rows() {
  return cases.map((c) => ({
    id: c.id,
    language: c.language,
    "bm25.local": score(
      retrieveKnowledge({ query: c.query, limit: 5 }).map((p) =>
        conceptOf(p.id),
      ),
      c.expect,
    ),
  }));
}

function summarize(rows) {
  const keys = [
    ...new Set(
      rows.flatMap((r) => Object.keys(r).filter((k) => k.includes("."))),
    ),
  ];
  const group = (subset) =>
    Object.fromEntries(
      keys.map((key) => {
        const scores = subset.map((r) => r[key]).filter(Boolean);
        return [
          key,
          {
            recallAt3: Number(
              (scores.filter((s) => s.hit).length / scores.length).toFixed(3),
            ),
            mrr: Number(
              (
                scores.reduce((sum, s) => sum + s.reciprocalRank, 0) /
                scores.length
              ).toFixed(3),
            ),
          },
        ];
      }),
    );
  return {
    all: group(rows),
    en: group(rows.filter((r) => r.language === "en")),
    bn: group(rows.filter((r) => r.language === "bn")),
  };
}

async function remoteRows() {
  const url = process.env.SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  const headers = { "content-type": "application/json", apikey: secret };
  if (!secret.startsWith("sb_secret_"))
    headers.authorization = `Bearer ${secret}`;
  const rows = [];
  for (const body of payloads()) {
    const response = await fetch(new URL("/functions/v1/asha-knowledge", url), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(`eval batch failed: ${response.status}`);
    rows.push(...(await response.json()).rows);
  }
  return rows;
}

if (process.argv.includes("--payloads")) {
  console.log(JSON.stringify(payloads()));
} else {
  const file = arg("--rows");
  const hybrid = file
    ? JSON.parse(await readFile(file, "utf8"))
    : await remoteRows();
  const local = bm25Rows();
  const rows = local.map((row) => ({
    ...row,
    ...(hybrid?.find((h) => h.id === row.id) || {}),
  }));
  const report = {
    ranAt: new Date().toISOString(),
    cases: rows.length,
    languages: {
      en: rows.filter((r) => r.language === "en").length,
      bn: rows.filter((r) => r.language === "bn").length,
    },
    metric:
      "recall@3 and MRR@5 at passage level: a passage counts when its guide is one the question expects",
    ...(arg("--index") ? { hybridIndex: arg("--index") } : {}),
    methods: {
      "bm25.local":
        "in-app BM25 over the same guides, with the bilingual lexicon (the offline fallback)",
      semantic: "pgvector cosine on gte-small embeddings only",
      fullText: "Postgres full text (english config) only",
      hybrid: "semantic and full text fused with reciprocal rank fusion (k=50)",
      hybridGraph:
        "what the app serves: top two hybrid passages, then the best knowledge-graph neighbour",
      ".raw / .rewritten": "without / with bilingual query rewriting",
    },
    summary: summarize(rows),
    rows,
  };
  const out = arg("--out") || "docs/retrieval-eval.json";
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  console.error(
    `Wrote ${out}${hybrid ? "" : " (BM25 only: no Supabase credentials or rows given)"}`,
  );
}
