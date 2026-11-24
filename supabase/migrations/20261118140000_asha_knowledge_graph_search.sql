-- One round trip for a search: the hybrid passages and the best passage of up
-- to two knowledge-graph neighbours of the top guide. The web app and the
-- database are in different regions, so each extra call from the edge
-- function cost most of a second. Only touches ASHA's own objects.
create or replace function public.asha_hybrid_graph_search(
  query_tsquery text,
  query_embedding extensions.vector,
  match_count int default 3,
  full_text_weight double precision default 1,
  semantic_weight double precision default 1,
  with_graph boolean default true
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
  score double precision,
  via text,
  edge_weight double precision
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  hit record;
  edge record;
  best record;
  seen text[] := '{}';
  top_concept text;
  added int := 0;
begin
  for hit in
    select h.* from public.asha_hybrid_search(
      query_tsquery, query_embedding, match_count,
      full_text_weight, semantic_weight
    ) h
    order by h.score desc, h.id
  loop
    id := hit.id; concept_id := hit.concept_id; module := hit.module;
    title := hit.title; header := hit.header; body := hit.body;
    provenance := hit.provenance; verification := hit.verification;
    semantic_rank := hit.semantic_rank; full_text_rank := hit.full_text_rank;
    score := hit.score; via := 'hybrid'; edge_weight := null;
    return next;
    seen := seen || hit.concept_id;
    if top_concept is null then top_concept := hit.concept_id; end if;
  end loop;

  if not with_graph or top_concept is null then return; end if;

  for edge in
    select e.target_concept, e.relation, e.weight
    from public.asha_knowledge_edges e
    where e.source_concept = top_concept
    order by e.weight desc, e.target_concept
    limit 4
  loop
    exit when added >= 2;
    continue when edge.target_concept = any(seen);
    seen := seen || edge.target_concept;
    select h.* into best from public.asha_hybrid_search(
      query_tsquery, query_embedding, 1, 1, 1, 50, edge.target_concept
    ) h
    limit 1;
    if found then
      id := best.id; concept_id := best.concept_id; module := best.module;
      title := best.title; header := best.header; body := best.body;
      provenance := best.provenance; verification := best.verification;
      semantic_rank := best.semantic_rank; full_text_rank := best.full_text_rank;
      score := best.score; via := 'graph:' || edge.relation;
      edge_weight := edge.weight;
      return next;
      added := added + 1;
    end if;
  end loop;
end;
$$;

revoke execute on function public.asha_hybrid_graph_search(text, extensions.vector, int, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.asha_hybrid_graph_search(text, extensions.vector, int, double precision, double precision, boolean) to service_role;
