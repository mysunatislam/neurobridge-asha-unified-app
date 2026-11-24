-- ASHA knowledge retrieval: pgvector chunks, full-text index, knowledge graph
-- edges and hybrid search with Reciprocal Rank Fusion. Additive only.
-- Only public, version-controlled app guides (okf/*.md) are stored here.
-- Patient messages and confirmed speech pairs never enter these tables.

create extension if not exists vector with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.asha_knowledge_chunks (
  id text primary key,
  concept_id text not null,
  module text not null,
  title text not null,
  header text not null,
  body text not null,
  sentence_from int not null,
  sentence_to int not null,
  provenance text,
  verification text,
  corpus_version text not null,
  embedding extensions.vector(384) not null,
  fts tsvector generated always as (to_tsvector('english', header || ' ' || body)) stored,
  updated_at timestamptz not null default now()
);
create index if not exists asha_knowledge_chunks_embedding_idx
  on public.asha_knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists asha_knowledge_chunks_fts_idx
  on public.asha_knowledge_chunks using gin (fts);
create index if not exists asha_knowledge_chunks_concept_idx
  on public.asha_knowledge_chunks (concept_id);

create table if not exists public.asha_knowledge_edges (
  source_concept text not null,
  target_concept text not null,
  relation text not null check (relation in ('mentions', 'similar')),
  weight real not null check (weight > 0 and weight <= 1),
  corpus_version text not null,
  primary key (source_concept, target_concept, relation)
);

create table if not exists public.asha_knowledge_index_runs (
  id bigint generated always as identity primary key,
  corpus_version text not null,
  model text not null,
  concepts int not null,
  sentences int not null,
  chunks int not null,
  deduplicated int not null,
  edges int not null,
  duration_ms int not null,
  ran_at timestamptz not null default now()
);

alter table public.asha_knowledge_chunks enable row level security;
alter table public.asha_knowledge_edges enable row level security;
alter table public.asha_knowledge_index_runs enable row level security;
revoke all on public.asha_knowledge_chunks, public.asha_knowledge_edges, public.asha_knowledge_index_runs from anon, authenticated;
grant select, insert, update, delete on public.asha_knowledge_chunks, public.asha_knowledge_edges to service_role;
grant select, insert on public.asha_knowledge_index_runs to service_role;

-- Hybrid search: semantic (cosine) and full-text rankings fused with RRF.
-- Weights of 0 turn a side off, which the retrieval eval uses for ablations.
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
        order by pg_catalog.ts_rank_cd(c.fts, pg_catalog.to_tsquery('english', query_tsquery)) desc, c.id
      ) as rank_ix
    from candidates c
    where full_text_weight > 0
      and coalesce(query_tsquery, '') <> ''
      and c.fts @@ pg_catalog.to_tsquery('english', query_tsquery)
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
revoke execute on function public.asha_hybrid_search(text, extensions.vector, int, double precision, double precision, int, text) from public, anon, authenticated;
grant execute on function public.asha_hybrid_search(text, extensions.vector, int, double precision, double precision, int, text) to service_role;

-- A random index token lives only in Vault, so SQL (pg_net) can trigger
-- re-indexing without any key being copied into code or chat.
create or replace function public.asha_index_token_ok(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(token) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'asha_index_token' and s.decrypted_secret = token
  );
$$;
revoke execute on function public.asha_index_token_ok(text) from public, anon, authenticated;
grant execute on function public.asha_index_token_ok(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'asha_index_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'asha_index_token',
      'Lets SQL trigger ASHA knowledge re-indexing (asha-knowledge edge function).'
    );
  end if;
end $$;

comment on table public.asha_knowledge_chunks is
  'ASHA app-guide chunks (semantic chunking, contextual headers, gte-small embeddings). Public guide text only; no patient data.';
comment on table public.asha_knowledge_edges is
  'ASHA knowledge graph between guide concepts: explicit mentions and embedding similarity.';
