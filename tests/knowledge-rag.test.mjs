import test from "node:test";
import assert from "node:assert/strict";
import {
  semanticChunks,
  dedupChunks,
  buildEdges,
  toTsquery,
  scoreRanking,
  splitSentences,
  contextHeader,
} from "../supabase/functions/asha-knowledge/rag.ts";
import { CORPUS } from "../supabase/functions/asha-knowledge/corpus.ts";
import { okfDocuments } from "../okf/generated.js";

// Deterministic stand-in for gte-small: hashed bag of words, L2-normalized.
const fakeEmbed = async (text) => {
  const v = new Array(64).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 64] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

test("The edge function corpus matches the OKF guides exactly", () => {
  const live = okfDocuments.filter((c) => c.status !== "deprecated");
  assert.deepEqual(
    CORPUS.map((c) => [c.id, c.text]),
    live.map((c) => [c.id, c.text]),
  );
});

test("Semantic chunking keeps whole sentences, covers every sentence once and adds a context header", async () => {
  for (const concept of CORPUS) {
    const { chunks, sentences } = await semanticChunks(concept, fakeEmbed);
    assert.equal(sentences, splitSentences(concept.text).length);
    const covered = chunks.flatMap((c) =>
      Array.from(
        { length: c.sentence_to - c.sentence_from + 1 },
        (_, i) => c.sentence_from + i,
      ),
    );
    assert.deepEqual(
      covered,
      Array.from({ length: sentences }, (_, i) => i + 1),
    );
    for (const chunk of chunks) {
      assert.equal(chunk.header, contextHeader(concept));
      assert.ok(
        chunk.body.length <= 480 || chunk.sentence_from === chunk.sentence_to,
      );
      assert.ok(concept.text.includes(chunk.body));
    }
    if (concept.text.length > 600) assert.ok(chunks.length >= 2, concept.id);
  }
});

test("Semantic dedup removes a near-identical chunk and keeps distinct ones", async () => {
  const { chunks } = await semanticChunks(CORPUS[0], fakeEmbed);
  const copy = { ...chunks[0], id: "copy" };
  const { kept, removed } = dedupChunks([...chunks, copy]);
  assert.equal(removed, 1);
  assert.equal(kept.length, chunks.length);
});

test("The knowledge graph links guides that name each other", async () => {
  const all = [];
  for (const c of CORPUS)
    all.push(...(await semanticChunks(c, fakeEmbed)).chunks);
  const edges = buildEdges([...CORPUS], all);
  const has = (a, b) =>
    edges.some(
      (e) =>
        e.source_concept === a &&
        e.target_concept === b &&
        e.relation === "mentions",
    );
  assert.ok(has("guide:assessment", "guide:fingerspeak"));
  assert.ok(has("guide:fingerspeak", "guide:facespeak"));
  assert.ok(!edges.some((e) => e.source_concept === e.target_concept));
  assert.ok(edges.every((e) => e.weight > 0 && e.weight <= 1));
});

test("Full-text queries keep only safe English lexemes, and scoring counts passages in order", () => {
  assert.equal(
    toTsquery(["blink", "পলক", "request", "x", "drop;table", "Blink"]),
    "blink | request",
  );
  assert.deepEqual(scoreRanking(["a", "b", "c"], ["b"]), {
    hit: true,
    reciprocalRank: 0.5,
  });
  assert.deepEqual(scoreRanking(["a", "a", "a", "b"], ["b"]), {
    hit: false,
    reciprocalRank: 0.25,
  });
  assert.deepEqual(scoreRanking([], ["b"]), { hit: false, reciprocalRank: 0 });
});

test("Long guides can be chunked in sentence windows that together cover every sentence once", async () => {
  const { sentenceWindows } = await import(
    "../supabase/functions/asha-knowledge/rag.ts"
  );
  const facespeak = CORPUS.find((c) => c.id === "guide:facespeak");
  const windows = sentenceWindows(facespeak, 6);
  assert.deepEqual(windows, [
    { from: 1, to: 6 },
    { from: 7, to: 11 },
  ]);
  const parts = [];
  for (const w of windows)
    parts.push(...(await semanticChunks(facespeak, fakeEmbed, w)).chunks);
  const covered = parts.flatMap((c) =>
    Array.from(
      { length: c.sentence_to - c.sentence_from + 1 },
      (_, i) => c.sentence_from + i,
    ),
  );
  assert.deepEqual(
    covered,
    Array.from({ length: 11 }, (_, i) => i + 1),
  );
  assert.ok(
    parts.every(
      (c) => c.id === `guide:facespeak#${c.sentence_from}-${c.sentence_to}`,
    ),
  );
});

test("A hand pose in FingerSpeak is not read as a mention of the posture guide", async () => {
  const all = [];
  for (const c of CORPUS)
    all.push(...(await semanticChunks(c, fakeEmbed)).chunks);
  const edges = buildEdges([...CORPUS], all);
  assert.ok(
    !edges.some(
      (e) =>
        e.source_concept === "guide:fingerspeak" &&
        e.target_concept === "guide:posture" &&
        e.relation === "mentions",
    ),
  );
});

test("Contextual retrieval: a chunk's own context is embedded between the header and the text", async () => {
  const concept = CORPUS.find((c) => c.id === "guide:caregiver");
  const seen = [];
  const recording = async (text) => {
    seen.push(text);
    return fakeEmbed(text);
  };
  const { chunks: plain } = await semanticChunks(concept, fakeEmbed);
  const id = plain[0].id;
  const context = "From the caregiver guide: how requests are acknowledged.";
  const { chunks } = await semanticChunks(concept, recording, undefined, {
    [id]: context,
    "guide:other#1-1": "unused",
  });
  assert.deepEqual(
    chunks.map((c) => c.id),
    plain.map((c) => c.id),
  );
  assert.equal(chunks[0].context, context);
  assert.ok(chunks.slice(1).every((c) => c.context === ""));
  assert.ok(seen.includes(`${chunks[0].header} ${context} ${chunks[0].body}`));
});

test("Every committed chunk context names a chunk the chunker can produce for the current corpus", async () => {
  const { CHUNK_CONTEXTS } = await import(
    "../supabase/functions/asha-knowledge/corpus.ts"
  );
  const ids = Object.keys(CHUNK_CONTEXTS);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const [conceptId, span] = id.split("#");
    const concept = CORPUS.find((c) => c.id === conceptId);
    assert.ok(concept, id);
    const [from, to] = span.split("-").map(Number);
    assert.ok(
      from >= 1 && to >= from && to <= splitSentences(concept.text).length,
      id,
    );
    assert.ok(
      CHUNK_CONTEXTS[id].length > 20 && CHUNK_CONTEXTS[id].length <= 400,
      id,
    );
  }
});
