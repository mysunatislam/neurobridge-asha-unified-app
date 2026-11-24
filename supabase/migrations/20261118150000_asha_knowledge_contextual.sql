-- Contextual retrieval: each chunk keeps its LLM-written context, and full-text
-- search covers header, context and body. Additive: a new generated column and
-- index. The older fts column stays in place but is no longer read.
-- Only touches ASHA's own objects.
alter table public.asha_knowledge_chunks
  add column if not exists context text not null default '';
alter table public.asha_knowledge_chunks
  add column if not exists fts_context tsvector generated always as (
    to_tsvector('english', header || ' ' || context || ' ' || body)
  ) stored;
create index if not exists asha_knowledge_chunks_fts_context_idx
  on public.asha_knowledge_chunks using gin (fts_context);

-- Same hybrid search as before, reading the contextual full-text column.
create or replace function public.asha_hybrid_search(
  query_tsquery text,
  query_embedding extensions.vector(384),
  match_count int default 3,
  full_text_weight double precision default 1,
  semantic_weight double precision default 1,
  rrf_k int default 50,
  concept_filter text default null
)
returns table (
  id text,
  concept_id text,
  module text,
  title text,
  header text,
  body text,
  provenance text,
  verification text,
  semantic_rank bigint,
  full_text_rank bigint,
  score double precision
)
language sql
stable
set search_path = ''
as $$
  with candidates as (
    select c.*
    from public.asha_knowledge_chunks c
    where concept_filter is null or c.concept_id = concept_filter
  ),
  full_text as (
    select c.id,
      row_number() over (
        order by pg_catalog.ts_rank_cd(c.fts_context, pg_catalog.to_tsquery('english', query_tsquery)) desc, c.id
      ) as rank_ix
    from candidates c
    where full_text_weight > 0
      and coalesce(query_tsquery, '') <> ''
      and c.fts_context @@ pg_catalog.to_tsquery('english', query_tsquery)
    order by rank_ix
    limit least(match_count, 20) * 2
  ),
  semantic as (
    select c.id,
      row_number() over (
        order by c.embedding operator(extensions.<=>) query_embedding, c.id
      ) as rank_ix
    from candidates c
    where semantic_weight > 0
    order by rank_ix
    limit least(match_count, 20) * 2
  )
  select c.id, c.concept_id, c.module, c.title, c.header, c.body,
    c.provenance, c.verification,
    semantic.rank_ix, full_text.rank_ix,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
      + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight as score
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join public.asha_knowledge_chunks c on c.id = coalesce(full_text.id, semantic.id)
  order by score desc, c.id
  limit least(match_count, 20);
$$;
