# Retrieval for ASHA's app guides

ASHA answers "how does the app work" questions from eight short app guides (`okf/`). Patient speech pairs that a caregiver confirmed are also used as evidence, but they never leave the ASHA server.

## Pipeline

1. **Corpus.** `scripts/build-knowledge-corpus.mjs` turns the OKF guides into `supabase/functions/asha-knowledge/corpus.ts` (8 concepts, 52 sentences, corpus version `3b618589e5fbfe47`). Each guide keeps its provenance and verification note.
2. **Semantic chunking.** Sentences are embedded with `gte-small` (384 dimensions, mean pooled, normalised). A chunk ends where the similarity between neighbouring sentences drops below that guide's 30th percentile, within 120 to 480 characters. Long guides are embedded in windows of 6 sentences to stay inside the edge function's compute limit.
3. **Contextual chunk headers.** Every chunk is embedded and indexed with a header such as "ASHA app guide: Caregiver (caregiver module)." so that a short passage still carries its topic.
4. **Contextual retrieval.** Each of the 20 chunks also carries one sentence that places it within its guide (172 characters on average), in [`okf/retrieval/chunk-contexts.json`](../okf/retrieval/chunk-contexts.json). Claude wrote them from the whole guide with the prompt stored in that file. The sentence goes between the header and the chunk text, both for the embedding and for full-text search (`fts_context`). Contexts apply only to the corpus version they were written for, so a changed guide is indexed without them until they are rewritten.
5. **Deduplication.** Chunks with cosine similarity of 0.97 or more across guides are merged. None were found in this corpus.
6. **Knowledge graph.** `asha_knowledge_edges` holds 28 edges: 12 "mentions" edges (one guide names another module) and 16 "similar" edges (guide centroids with cosine of 0.8 or more, top two per guide).
7. **Index.** Supabase Postgres with pgvector (HNSW, cosine) and a full-text GIN index (`english` configuration), in tables prefixed `asha_knowledge_` with row-level security on and no anon access.
8. **Query rewriting.** `rewriteQuery` in `src/server/lib/retrieval.js` maps Bangla and colloquial words to the canonical English terms of the app's existing curated lexicon (for example জেগে → wake, অনুরোধ → request). The English-only embedder and full-text index then see the English terms.
9. **Hybrid search.** `asha_hybrid_search` fuses the semantic and full-text rankings with reciprocal rank fusion (k = 50).
10. **Graph expansion.** The app serves the top two hybrid passages, then the best passage from a graph neighbour of the top guide. `asha_hybrid_graph_search` returns both in one database call.
11. **Fallback.** The app calls the `asha-knowledge` edge function with a 2.5 second timeout and a 10 minute cache. Any error, timeout or missing configuration falls back to the in-app BM25 ranking over the same guides. `ASHA_HYBRID_RETRIEVAL=0` keeps everything local.

The database is in Tokyo (`ap-northeast-1`) and the web app runs on Vercel in the US. By default Supabase runs an edge function near its caller, and each call from the US function to the Tokyo database took about 0.7 seconds. On 18 November 2026 a warm search took about 0.86 seconds inside the function and the 1.5 second timeout often fell back to BM25. The app now sends `x-region: ap-northeast-1` (change it with `ASHA_KNOWLEDGE_REGION`, or set it empty to let Supabase choose) and the search makes one database call.

Last index run, 2026-11-18, index `3b618589e5fbfe47:semantic-v1-contextual-1333de97:gte-small`: 8 guides, 52 sentences, 20 chunks (205 characters of text on average, each with its context), 0 merged duplicates, 28 edges, 13.2 seconds of embedding time in total.

## Evaluation

`okf/eval/retrieval-cases.json` holds 34 paraphrased questions (23 English, 11 Bangla), each with the guides that answer it. `node scripts/retrieval-eval.mjs` scores every method at passage level: recall@3 counts a question as answered when one of the top three passages comes from an expected guide, and MRR uses the first such passage within the top five. Full results are in [`retrieval-eval.json`](retrieval-eval.json).

| Method                              | All recall@3 | All MRR   | English MRR | Bangla recall@3 | Bangla MRR |
| ----------------------------------- | ------------ | --------- | ----------- | --------------- | ---------- |
| In-app BM25 with lexicon (fallback) | 0.941        | 0.882     | 0.826       | **1.000**       | **1.000**  |
| Full text only, rewritten           | 0.941        | 0.882     | 0.855       | **1.000**       | 0.939      |
| Semantic only, rewritten            | **1.000**    | **0.980** | **1.000**   | **1.000**       | 0.939      |
| Hybrid RRF, rewritten               | **1.000**    | 0.966     | 0.978       | **1.000**       | 0.939      |
| Hybrid + graph, rewritten (served)  | 0.971        | 0.978     | **1.000**   | 0.909           | 0.932      |
| Hybrid + graph, no rewriting        | 0.794        | 0.755     | **1.000**   | 0.364           | 0.242      |

The same eval on the index without chunk contexts (`3b618589e5fbfe47:semantic-v1:gte-small`, kept in [`retrieval-eval-no-context.json`](retrieval-eval-no-context.json)):

| Method, rewritten       | All MRR without → with context | English MRR   | Bangla recall@3 |
| ----------------------- | ------------------------------ | ------------- | --------------- |
| Full text only          | 0.877 → 0.882                  | 0.841 → 0.855 | 1.000 → 1.000   |
| Semantic only           | 0.966 → 0.980                  | 0.978 → 1.000 | 1.000 → 1.000   |
| Hybrid RRF              | 0.941 → 0.966                  | 0.935 → 0.978 | 1.000 → 1.000   |
| Hybrid + graph (served) | 0.956 → 0.978                  | 0.957 → 1.000 | 1.000 → 0.909   |

What the numbers say:

- Semantic search and hybrid RRF with rewriting find an answering passage in the top three for all 34 questions. The served ordering does so for 33 of 34, full text alone for 32, and the in-app BM25 fallback for 32.
- Chunk contexts improve English ranking: with them, the served ordering ranks an answering passage first for every English question (MRR 1.000, up from 0.957). The contexts were written after the eval questions existed, by a writer who had seen them, so treat this gain as indicative, not as a measured improvement on unseen questions.
- They cost one Bangla question. For "আশা কি আমার ছেলেকে ফোন করতে পারে?" (can Asha phone my son?) the answering passage is third in the hybrid ranking, and the served ordering puts a graph neighbour third, so it drops to fourth.
- Query rewriting matters most. Without it, the served ranking answers only 4 of 11 Bangla questions, because `gte-small` and the `english` full-text configuration do not understand Bangla. English results do not change.
- Full text misses two English paraphrases entirely ("My father cannot see the screen" and "slumping in my chair"), with or without contexts.
- On Bangla, the in-app BM25 scores 1.000 because both it and the rewriting use the same curated lexicon. The hybrid index gives no gain there yet.

Limits of this evaluation: the questions were written by the ASHA team and not by patients, the set is small, and the eight guides are short. Treat the numbers as a check that the pipeline works, not as a benchmark. A larger set of real, consented caregiver questions is the next step.

## Reproducing

```bash
node scripts/build-knowledge-corpus.mjs          # rebuild corpus.ts from okf/
node scripts/retrieval-eval.mjs --payloads       # print the eval batches
SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/retrieval-eval.mjs
node scripts/retrieval-eval.mjs --rows rows.json # score saved rows from the edge function
```

The edge function runs at most 6 cases per request. The 18 November run sent batches of 5, one at a time; larger batches, or several in parallel, can hit the Supabase worker compute limit. Indexing runs one guide per request (FaceSpeak in sentence windows 1 to 6 and 7 to 11), then `finalize` rebuilds the graph.
