// asha-knowledge: embeddings, indexing, hybrid search with graph expansion,
// and the retrieval eval for ASHA's public app guides.
// Deployed with verify_jwt = false: every action is authorized in code with a
// project secret key (apikey header) or the Vault-held index token.
// Request text is never logged or stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  CHUNK_CONTEXTS,
  CONTEXTS_VERSION,
  CORPUS,
  CORPUS_VERSION,
} from "./corpus.ts";
import {
  CHUNKER_VERSION,
  buildEdges,
  dedupChunks,
  scoreRanking,
  semanticChunks,
  splitSentences,
  toTsquery,
} from "./rag.ts";

const MODEL = "gte-small";
const VERSION = `${CORPUS_VERSION}:${CHUNKER_VERSION}-${CONTEXTS_VERSION}:${MODEL}`;
const session = new Supabase.ai.Session(MODEL);

function projectKeys(): string[] {
  const keys: string[] = [];
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const value of Object.values(parsed))
      if (typeof value === "string") keys.push(value);
  } catch {
    // Older projects only have the legacy service role key.
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  return keys.filter((key) => key.length >= 32);
}
const serverKey = projectKeys()[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const digest = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
// Keys the function knows from its own environment are checked first. A key
// it does not hold (for example a second secret key made for the web app) is
// accepted only if the API gateway lets it read a table that only the
// service role can read. Successful checks are cached as hashes for 10 minutes.
const verified = new Map<string, number>();
const kind = (value: string) =>
  !value
    ? "none"
    : value.startsWith("sb_secret_")
      ? "secret"
      : value.startsWith("sb_publishable_")
        ? "publishable"
        : value.startsWith("eyJ")
          ? "jwt"
          : "other";
async function serviceRoleProbe(apikey: string, authorization: string) {
  const hash = Array.from(await digest(`${apikey}|${authorization}`))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const until = verified.get(hash);
  if (until && until > Date.now()) return true;
  const headers: Record<string, string> = {
    apikey: apikey || (Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
  };
  if (authorization) headers.authorization = authorization;
  const response = await fetch(
    new URL(
      "/rest/v1/asha_knowledge_index_runs?select=id&limit=1",
      Deno.env.get("SUPABASE_URL")!,
    ),
    { headers },
  ).catch(() => null);
  await response?.body?.cancel();
  if (response?.status !== 200) return false;
  if (verified.size > 20) verified.clear();
  verified.set(hash, Date.now() + 10 * 60_000);
  return true;
}
async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  for (const presented of [apikey, bearer])
    if (presented)
      for (const key of projectKeys())
        if (await same(presented, key)) return true;
  const token = req.headers.get("x-asha-index-token");
  if (token && token.length >= 32 && token.length <= 200) {
    const { data } = await db.rpc("asha_index_token_ok", { token });
    if (data === true) return true;
  }
  if ((apikey || bearer) && (await serviceRoleProbe(apikey, authorization)))
    return true;
  // Only the kind of credential is logged, never its value.
  console.warn("asha-knowledge refused", {
    apikey: kind(apikey),
    bearer: kind(bearer),
    known: projectKeys().map(kind),
  });
  return false;
}

async function embed(text: string): Promise<number[]> {
  const output = await session.run(text.slice(0, 2000), {
    mean_pool: true,
    normalize: true,
  });
  return Array.from(output as ArrayLike<number>);
}

// Edge functions have a small CPU budget per request, so indexing runs one
// guide per request ("index" with a concept id), then "finalize" removes
// near-duplicate chunks across guides and rebuilds the knowledge graph.
async function indexConcept(conceptId: string, from?: number, to?: number) {
  const concept = CORPUS.find((c) => c.id === conceptId);
  if (!concept) return { status: "unknown-concept" };
  const started = Date.now();
  const window =
    Number.isFinite(from) && Number.isFinite(to)
      ? { from: from!, to: to! }
      : undefined;
  const { chunks, sentences } = await semanticChunks(
    concept,
    embed,
    window,
    CHUNK_CONTEXTS,
  );
  const { kept, removed } = dedupChunks(chunks);
  const rows = kept.map((chunk) => ({
    ...chunk,
    embedding: JSON.stringify(chunk.embedding),
    corpus_version: VERSION,
    updated_at: new Date().toISOString(),
  }));
  const upsert = await db
    .from("asha_knowledge_chunks")
    .upsert(rows, { onConflict: "id" });
  if (upsert.error) throw new Error("chunk upsert failed");
  let cleanup = db
    .from("asha_knowledge_chunks")
    .delete()
    .eq("concept_id", concept.id)
    .not("id", "in", `(${kept.map((k) => `"${k.id}"`).join(",")})`);
  // Only replace chunks inside this window; other windows keep theirs.
  if (window)
    cleanup = cleanup
      .gte("sentence_from", window.from)
      .lte("sentence_from", window.to);
  const stale = await cleanup;
  if (stale.error) throw new Error("stale chunk cleanup failed");
  return {
    status: "indexed",
    concept: concept.id,
    window: window ?? null,
    sentences,
    chunks: kept.length,
    deduplicated: removed,
    ms: Date.now() - started,
  };
}

async function finalize(durationMs: number, priorDeduplicated: number) {
  const { data, error } = await db
    .from("asha_knowledge_chunks")
    .select("id, concept_id, embedding, corpus_version")
    .order("concept_id")
    .order("sentence_from");
  if (error) throw new Error("chunk read failed");
  const known = new Set(CORPUS.map((c) => c.id));
  const stored = (data ?? []).map((row) => ({
    ...row,
    embedding:
      typeof row.embedding === "string"
        ? JSON.parse(row.embedding)
        : row.embedding,
  }));
  const current = stored.filter(
    (row) => row.corpus_version === VERSION && known.has(row.concept_id),
  );
  if (CORPUS.some((c) => !current.some((row) => row.concept_id === c.id)))
    return {
      status: "incomplete",
      missing: CORPUS.filter(
        (c) => !current.some((r) => r.concept_id === c.id),
      ).map((c) => c.id),
    };
  const { kept, removed } = dedupChunks(current as never);
  const keptIds = new Set(kept.map((k: { id: string }) => k.id));
  const drop = stored
    .filter((row) => !keptIds.has(row.id))
    .map((row) => row.id);
  if (drop.length)
    await db.from("asha_knowledge_chunks").delete().in("id", drop);
  const edges = buildEdges([...CORPUS], kept as never);
  const edgeRows = edges.map((edge) => ({ ...edge, corpus_version: VERSION }));
  // The graph is small and rebuilt whole, so edges a rule no longer produces go too.
  const cleared = await db
    .from("asha_knowledge_edges")
    .delete()
    .neq("source_concept", "");
  if (cleared.error) throw new Error("edge reset failed");
  const edgeInsert = await db.from("asha_knowledge_edges").insert(edgeRows);
  if (edgeInsert.error) throw new Error("edge insert failed");
  const run = {
    corpus_version: VERSION,
    model: MODEL,
    concepts: CORPUS.length,
    sentences: CORPUS.reduce(
      (sum, c) => sum + splitSentences(c.text).length,
      0,
    ),
    chunks: kept.length,
    deduplicated: removed + Math.max(0, Math.floor(priorDeduplicated) || 0),
    edges: edges.length,
    duration_ms: Math.max(0, Math.floor(durationMs) || 0),
  };
  await db.from("asha_knowledge_index_runs").insert(run);
  return { status: "finalized", version: VERSION, ...run, edgeList: edges };
}

type SearchInput = {
  query: string;
  terms?: string[];
  limit?: number;
  semanticWeight?: number;
  fullTextWeight?: number;
  graph?: boolean;
  embedding?: number[];
};
const cleanTerms = (terms: unknown) =>
  Array.isArray(terms)
    ? terms
        .filter(
          (t) => typeof t === "string" && /^[\p{L}\p{M}\p{N}]{1,40}$/u.test(t),
        )
        .slice(0, 40)
    : [];

async function search(input: SearchInput) {
  const query = String(input.query ?? "").slice(0, 1200);
  const terms = cleanTerms(input.terms);
  const limit = Math.max(1, Math.min(5, Math.floor(Number(input.limit) || 3)));
  // Query rewriting: the caller adds canonical English terms for Bangla and
  // colloquial words, so an English-only embedder and index can match them.
  const embedding =
    input.embedding ?? (await embed(`${query} ${terms.join(" ")}`.trim()));
  // One database round trip: the hybrid passages, then the best passage of up
  // to two knowledge-graph neighbours of the top guide.
  const { data, error } = await db.rpc("asha_hybrid_graph_search", {
    query_tsquery: toTsquery(terms),
    query_embedding: JSON.stringify(embedding),
    match_count: limit,
    full_text_weight: input.fullTextWeight ?? 1,
    semantic_weight: input.semanticWeight ?? 1,
    with_graph: input.graph !== false,
  });
  if (error) throw new Error("search failed");
  const passages = [];
  const related = [];
  for (const { edge_weight, ...row } of (data ?? []) as Record<
    string,
    unknown
  >[]) {
    if (row.via === "hybrid") passages.push(row);
    else
      related.push({
        ...row,
        edgeWeight: Number(Number(edge_weight).toFixed(4)),
      });
  }
  return { version: VERSION, passages, related, embedding };
}

type EvalCase = {
  id: string;
  query: string;
  terms: string[];
  rawTerms: string[];
  expect: string[];
  language: string;
};
async function evaluate(cases: EvalCase[]) {
  const methods = {
    semantic: { semanticWeight: 1, fullTextWeight: 0 },
    fullText: { semanticWeight: 0, fullTextWeight: 1 },
    hybrid: { semanticWeight: 1, fullTextWeight: 1 },
  };
  const rows = [];
  for (const c of cases.slice(0, 6)) {
    const row: Record<string, unknown> = { id: c.id, language: c.language };
    for (const [variant, terms] of [
      ["rewritten", c.terms],
      ["raw", c.rawTerms],
    ] as const) {
      const embedding = await embed(
        `${c.query} ${cleanTerms(terms).join(" ")}`.trim(),
      );
      for (const [name, weights] of Object.entries(methods)) {
        const out = await search({
          query: c.query,
          terms,
          limit: 5,
          graph: false,
          embedding,
          ...weights,
        });
        row[`${name}.${variant}`] = scoreRanking(
          out.passages.map((p: { concept_id: string }) => p.concept_id),
          c.expect,
        );
      }
      // Same budget of three passages: the top two hybrid plus the best graph neighbour.
      const graph = await search({
        query: c.query,
        terms,
        limit: 3,
        embedding,
      });
      const withGraph = [
        ...graph.passages.slice(0, 2),
        ...graph.related.slice(0, 1),
        ...graph.passages.slice(2),
      ].map((p: { concept_id: string }) => p.concept_id);
      row[`hybridGraph.${variant}`] = scoreRanking(withGraph, c.expect);
    }
    rows.push(row);
  }
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k.includes("."));
  const summarize = (subset: typeof rows) =>
    Object.fromEntries(
      keys.map((key) => {
        const scores = subset.map(
          (r) => r[key] as { hit: boolean; reciprocalRank: number },
        );
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
    version: VERSION,
    cases: rows.length,
    all: summarize(rows),
    en: summarize(rows.filter((r) => r.language === "en")),
    bn: summarize(rows.filter((r) => r.language === "bn")),
    rows,
  };
}

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!(await authorized(req))) return reply({ error: "Not authorized" }, 401);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 200_000)
      return reply({ error: "Request too large" }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  try {
    if (body.action === "index")
      return reply(
        await indexConcept(
          String(body.concept ?? ""),
          Number(body.from),
          Number(body.to),
        ),
      );
    if (body.action === "finalize")
      return reply(
        await finalize(Number(body.durationMs), Number(body.deduplicated)),
      );
    if (body.action === "search") {
      // Callers send text only; a client-supplied embedding is never trusted.
      const { embedding: _omit, ...result } = await search({
        ...(body as unknown as SearchInput),
        embedding: undefined,
      });
      return reply(result);
    }
    if (body.action === "eval")
      return reply(await evaluate((body.cases as EvalCase[]) ?? []));
    if (body.action === "status") {
      const { data } = await db
        .from("asha_knowledge_index_runs")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      return reply({
        version: VERSION,
        concepts: CORPUS.map((c) => c.id),
        lastRun: data,
      });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("asha-knowledge failure", (error as Error)?.message);
    return reply({ error: "Knowledge service unavailable" }, 503);
  }
});
