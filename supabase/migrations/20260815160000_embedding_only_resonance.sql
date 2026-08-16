-- 診断質問を体験フローから外したことに合わせて、共鳴度を感想文embeddingの類似度だけで
-- 判定するように変更する。diagnosis_questions / diagnosis_answers テーブルは残すが、
-- 共鳴度の計算からは参照しない。

-- 計算式が「重み付き平均」から「類似度そのもの」に変わるため、閾値も引き直す。
-- 本番データ（参加者10人・共通刺激ペア45組）の類似度分布は median 0.18 / p90 0.51 / max 0.59。
-- 0.55 だと45組中3組（約7%）が成立し、「めったに起きないが確かに起きる」バランスになる。
update public.app_settings
set value = 0.55,
    description = '共鳴度（感想文embeddingの類似度）がこの値を超えたらマッチ成立'
where key = 'match_threshold';

update public.app_settings
set value = 1.0, description = '共鳴度における感想文embedding類似度の重み'
where key = 'text_weight';

update public.app_settings
set value = 0, description = '未使用（診断質問を廃止したため0固定）'
where key = 'type_weight';

-- 共鳴候補の探索:
-- 共鳴度 = 同じ刺激に両者が回答したペアのembeddingコサイン類似度の平均
-- decisive_tone_id は感想文の類似度が最も高かったトーン
create or replace function public.find_resonance_candidates(p_participant_id uuid)
returns table (
  other_participant_id uuid,
  text_similarity double precision,
  diagnosis_closeness double precision,
  resonance double precision,
  decisive_tone_id uuid
)
language sql
stable
as $$
  with my_resp as (
    select distinct on (r.stimulus_id) r.stimulus_id, s.tone_id, r.embedding
    from public.stimulus_responses r
    join public.stimuli s on s.id = r.stimulus_id
    where r.participant_id = p_participant_id and r.embedding is not null
    order by r.stimulus_id, r.created_at desc
  ),
  other_resp as (
    select distinct on (r.participant_id, r.stimulus_id)
      r.participant_id, r.stimulus_id, r.embedding
    from public.stimulus_responses r
    where r.participant_id <> p_participant_id and r.embedding is not null
    order by r.participant_id, r.stimulus_id, r.created_at desc
  ),
  text_pairs as (
    select o.participant_id, m.tone_id,
      1 - (o.embedding <=> m.embedding) as sim
    from my_resp m
    join other_resp o on o.stimulus_id = m.stimulus_id
  ),
  text_agg as (
    select participant_id, avg(sim) as text_sim
    from text_pairs
    group by participant_id
  ),
  decisive as (
    select distinct on (participant_id) participant_id, tone_id
    from text_pairs
    order by participant_id, sim desc
  )
  select
    t.participant_id,
    t.text_sim,
    null::double precision as diagnosis_closeness,
    t.text_sim as resonance,
    dec.tone_id
  from text_agg t
  left join decisive dec on dec.participant_id = t.participant_id
  order by resonance desc;
$$;

-- 星座UIのキャッシュも同じ式（embedding類似度のみ）で作り直す
create or replace function public.refresh_resonance_graph()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thr float8;
  top_k int;
  result jsonb;
begin
  select coalesce((select value from app_settings where key = 'match_threshold'), 0.55)::float8 into thr;
  select coalesce((select value from app_settings where key = 'graph_top_k'), 8)::int into top_k;

  with latest as (
    select distinct on (r.participant_id, r.stimulus_id)
      r.participant_id, r.stimulus_id, r.embedding
    from stimulus_responses r
    where r.embedding is not null
    order by r.participant_id, r.stimulus_id, r.created_at desc
  ),
  response_counts as (
    select participant_id, count(*)::int as c
    from stimulus_responses
    group by participant_id
  ),
  scored as (
    select x.participant_id as pa, y.participant_id as pb,
      avg(1 - (x.embedding <=> y.embedding))::float8 as resonance,
      count(*)::int as shared
    from latest x
    join latest y on y.stimulus_id = x.stimulus_id and x.participant_id < y.participant_id
    group by x.participant_id, y.participant_id
  ),
  ranked as (
    select s.*, m.id as match_id, m.reaction_phrase,
      row_number() over (partition by s.pa order by s.resonance desc) as rk_a,
      row_number() over (partition by s.pb order by s.resonance desc) as rk_b
    from scored s
    left join matches m
      on m.participant_id_a = s.pa and m.participant_id_b = s.pb
  ),
  kept as (
    select * from ranked
    where rk_a <= top_k or rk_b <= top_k or match_id is not null
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nickname', p.nickname,
        'is_test', p.is_test,
        'response_count', coalesce(rc.c, 0)
      ) order by p.created_at)
      from participants p
      left join response_counts rc on rc.participant_id = p.id
      where coalesce(rc.c, 0) > 0
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'a', k.pa,
        'b', k.pb,
        'text_similarity', round(k.resonance::numeric, 4),
        'resonance', round(k.resonance::numeric, 4),
        'shared_stimuli', k.shared,
        'matched', k.match_id is not null,
        'reaction_phrase', k.reaction_phrase
      ))
      from kept k
    ), '[]'::jsonb),
    'match_threshold', thr,
    'generated_at', now()
  ) into result;

  update resonance_graph
  set payload = result, updated_at = now()
  where id = 1;

  return result;
end;
$$;

drop trigger if exists diagnosis_answers_refresh_graph on public.diagnosis_answers;

select public.refresh_resonance_graph();
