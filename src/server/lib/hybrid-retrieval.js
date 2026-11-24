import { retrieveKnowledge, rewriteQuery } from "./retrieval.js";

// The edge function is pinned to the database's region (see below), so a cold
// start (model load plus one query) fits; a warm search takes well under 1 s.
const TIMEOUT_MS = 2500;
// Supabase runs an edge function near the caller unless told otherwise. ASHA's
// database is in Tokyo and Vercel runs in the US, so running the search next
// to the database saves a cross-Pacific round trip per query.
const DEFAULT_FUNCTION_REGION = "ap-northeast-1";
const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 200;
const MAX_EXCERPT = 560;

/**
 * Hybrid retrieval for app guides: the asha-knowledge Supabase edge function
 * embeds the rewritten query (gte-small) and fuses pgvector and full-text
 * rankings with RRF, then adds knowledge-graph neighbours. Confirmed speech
 * pairs never leave this server: they are ranked locally with BM25 and merged
 * in. Any failure or timeout falls back to the local BM25 result.
 */
export function createHybridRetriever({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const url = env.SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const enabled = Boolean(url && secret && env.ASHA_HYBRID_RETRIEVAL !== "0");
  // An empty ASHA_KNOWLEDGE_REGION lets Supabase choose the nearest region.
  const region = env.ASHA_KNOWLEDGE_REGION ?? DEFAULT_FUNCTION_REGION;
  const cache = new Map();

  async function remote(query, limit) {
    const key = `${limit}\u0000${query}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const { terms } = rewriteQuery(query);
    const headers = { "content-type": "application/json", apikey: secret };
    // Legacy service_role keys are JWTs; new sb_secret keys go in apikey only.
    if (!secret.startsWith("sb_secret_"))
      headers.authorization = `Bearer ${secret}`;
    if (/^[a-z]{2}-[a-z]+-\d$/.test(region)) headers["x-region"] = region;
    const response = await fetchImpl(
      new URL("/functions/v1/asha-knowledge", url),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "search", query, terms, limit }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) throw Error("hybrid retrieval unavailable");
    const data = await response.json();
    if (!Array.isArray(data?.passages))
      throw Error("hybrid retrieval malformed");
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    cache.set(key, { value: data, until: now() + CACHE_MS });
    return data;
  }

  const toSource = (row) => ({
    id: String(row.id),
    title: String(row.title || "ASHA app guide").slice(0, 120),
    text: String(row.body || "").slice(0, MAX_EXCERPT),
    score: Number(Number(row.score || 0).toFixed(4)),
    source: "app-guide",
    retrieval: String(row.via || "hybrid"),
    ...(row.provenance ? { provenance: String(row.provenance) } : {}),
    ...(row.verification ? { verification: String(row.verification) } : {}),
  });

  async function retrieve({
    query,
    module = "companion",
    memories = [],
    limit = 3,
  } = {}) {
    const local = retrieveKnowledge({ query, module, memories, limit });
    if (!enabled || typeof query !== "string" || !query.trim()) return local;
    let data;
    try {
      data = await remote(query.slice(0, 1200), limit);
    } catch {
      return local;
    }
    const speech = local
      .filter((s) => s.source === "confirmed-speech")
      .slice(0, 2);
    const guides = data.passages.filter((p) => p?.body).map(toSource);
    const related = (data.related || []).filter((p) => p?.body).map(toSource);
    // Patient pairs first (they are the strongest evidence when they match),
    // then the top two hybrid passages, then the best knowledge-graph
    // neighbour, then the rest. This is the "hybridGraph" ordering measured in
    // docs/RETRIEVAL.md (best recall@3 and second-best MRR of the hybrid runs).
    const merged = [
      ...speech,
      ...guides.slice(0, 2),
      ...related.slice(0, 1),
      ...guides.slice(2),
      ...related.slice(1),
    ].slice(0, limit);
    return merged.length ? merged : local;
  }

  return { retrieve, enabled };
}
