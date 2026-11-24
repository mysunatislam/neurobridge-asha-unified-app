// Pure retrieval logic shared by the edge function and the Node tests.
// No Deno or network APIs here: the embedder is passed in.

export type Concept = {
  id: string;
  module: string;
  title: string;
  text: string;
  provenance?: string;
  verification?: string;
};
export type Embed = (text: string) => Promise<number[]>;
export type Chunk = {
  id: string;
  concept_id: string;
  module: string;
  title: string;
  header: string;
  /** LLM-written context for this chunk (contextual retrieval), or "". */
  context: string;
  body: string;
  sentence_from: number;
  sentence_to: number;
  provenance: string | null;
  verification: string | null;
  embedding: number[];
};
export type Edge = {
  source_concept: string;
  target_concept: string;
  relation: "mentions" | "similar";
  weight: number;
};

export const CHUNKER_VERSION = "semantic-v1-contextual";
const MAX_CHARS = 480;
const MIN_CHARS = 120;
const BREAK_PERCENTILE = 0.3;
export const DEDUP_THRESHOLD = 0.97;
const SIMILAR_THRESHOLD = 0.8;

export const cosine = (a: number[], b: number[]) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export const splitSentences = (text: string) =>
  (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text])
    .map((s) => s.trim())
    .filter(Boolean);

/** A short context line prepended to every chunk before embedding and full-text indexing. */
export const contextHeader = (c: Concept) =>
  `ASHA app guide: ${c.title} (${c.module} module).`;

/**
 * Semantic chunking: embed each sentence (with the guide's header), then start
 * a new chunk where the similarity between neighbouring sentences drops below
 * this guide's 30th percentile, keeping chunks between 120 and 480 characters.
 */
export async function semanticChunks(
  concept: Concept,
  embed: Embed,
  window?: { from: number; to: number },
  contexts: Record<string, string> = {},
): Promise<{ chunks: Chunk[]; sentences: number }> {
  const header = contextHeader(concept);
  const all = splitSentences(concept.text);
  // A window (1-based, inclusive) lets a long guide be chunked in parts that
  // each fit one edge-function request; a window edge is always a boundary.
  const first = Math.max(1, Math.floor(window?.from ?? 1));
  const last = Math.min(all.length, Math.floor(window?.to ?? all.length));
  const offset = first - 1;
  const parts = all.slice(offset, last);
  const vectors: number[][] = [];
  for (const sentence of parts)
    vectors.push(await embed(`${header} ${sentence}`));
  const gaps = parts.slice(1).map((_, i) => cosine(vectors[i], vectors[i + 1]));
  const sorted = [...gaps].sort((a, b) => a - b);
  const threshold = sorted.length
    ? sorted[Math.floor(sorted.length * BREAK_PERCENTILE)]
    : 1;
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= parts.length; i++) {
    const current = parts.slice(start, i).join(" ");
    const end =
      i === parts.length ||
      current.length + 1 + parts[i].length > MAX_CHARS ||
      (gaps[i - 1] <= threshold && current.length >= MIN_CHARS);
    if (end) {
      spans.push([start, i - 1]);
      start = i;
    }
  }
  const chunks: Chunk[] = [];
  for (const [from, to] of spans) {
    const body = parts.slice(from, to + 1).join(" ");
    const id = `${concept.id}#${offset + from + 1}-${offset + to + 1}`;
    // Contextual retrieval: the chunk's own context goes between the guide
    // header and the text, for both the embedding and full-text search.
    const context = String(contexts[id] ?? "").slice(0, 400);
    chunks.push({
      id,
      concept_id: concept.id,
      module: concept.module,
      title: concept.title,
      header,
      context,
      body,
      sentence_from: offset + from + 1,
      sentence_to: offset + to + 1,
      provenance: concept.provenance ?? null,
      verification: concept.verification ?? null,
      embedding: await embed([header, context, body].filter(Boolean).join(" ")),
    });
  }
  return { chunks, sentences: parts.length };
}

/** Sentence windows of at most `size` sentences covering a guide. */
export function sentenceWindows(concept: Concept, size = 6) {
  const total = splitSentences(concept.text).length;
  const windows: Array<{ from: number; to: number }> = [];
  for (let from = 1; from <= total; from += size)
    windows.push({ from, to: Math.min(total, from + size - 1) });
  return windows;
}

/** Semantic dedup: drop a chunk that is nearly identical to one already kept. */
export function dedupChunks(chunks: Chunk[], threshold = DEDUP_THRESHOLD) {
  const kept: Chunk[] = [];
  let removed = 0;
  for (const chunk of chunks) {
    if (kept.some((k) => cosine(k.embedding, chunk.embedding) >= threshold))
      removed++;
    else kept.push(chunk);
  }
  return { kept, removed };
}

const NAMES: Record<string, RegExp> = {
  companion: /\bcheck-ins?\b|\bcompanion\b/i,
  assessment: /\bassessment\b/i,
  facespeak: /\bFaceSpeak\b/,
  fingerspeak: /\bFingerSpeak\b/,
  senseassist: /\bSenseAssist\b/,
  vitalsense: /\bVitalSense\b/,
  // "pose" alone also names FingerSpeak's hand poses, so only "posture" counts.
  posture: /\bposture\b/i,
  caregiver: /\bcaregiver\b/i,
};

/**
 * Knowledge graph between guide concepts: "mentions" when one guide names
 * another module, "similar" for each concept's two closest neighbours by
 * mean chunk embedding (cosine >= 0.8).
 */
export function buildEdges(concepts: Concept[], chunks: Chunk[]): Edge[] {
  const edges: Edge[] = [];
  for (const a of concepts)
    for (const b of concepts) {
      if (a.id === b.id || !NAMES[b.module]) continue;
      if (NAMES[b.module].test(a.text))
        edges.push({
          source_concept: a.id,
          target_concept: b.id,
          relation: "mentions",
          weight: 1,
        });
    }
  const centroid = new Map<string, number[]>();
  for (const c of concepts) {
    const own = chunks
      .filter((k) => k.concept_id === c.id)
      .map((k) => k.embedding);
    if (!own.length) continue;
    centroid.set(
      c.id,
      own[0].map((_, i) => own.reduce((s, v) => s + v[i], 0) / own.length),
    );
  }
  for (const [id, vector] of centroid) {
    const neighbours = [...centroid]
      .filter(([other]) => other !== id)
      .map(([other, v]) => ({ other, sim: cosine(vector, v) }))
      .filter((n) => n.sim >= SIMILAR_THRESHOLD)
      .sort((x, y) => y.sim - x.sim)
      .slice(0, 2);
    for (const n of neighbours)
      edges.push({
        source_concept: id,
        target_concept: n.other,
        relation: "similar",
        weight: Number(Math.min(1, n.sim).toFixed(4)),
      });
  }
  return edges;
}

/** Query terms the English full-text index can use, as an OR tsquery. */
export const toTsquery = (terms: string[]) =>
  [
    ...new Set(
      terms
        .map((t) => String(t).toLowerCase())
        .filter((t) => /^[a-z][a-z0-9]{1,30}$/.test(t)),
    ),
  ]
    .slice(0, 30)
    .join(" | ");

/**
 * ranked: the concept id of each returned passage, in order.
 * hit: a relevant concept is among the first k passages (recall@k);
 * reciprocalRank: 1 / position of the first relevant passage within maxRank.
 */
export function scoreRanking(
  ranked: string[],
  expected: string[],
  k = 3,
  maxRank = 5,
) {
  const firstHit = ranked
    .slice(0, maxRank)
    .findIndex((c) => expected.includes(c));
  return {
    hit: ranked.slice(0, k).some((c) => expected.includes(c)),
    reciprocalRank: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
  };
}
