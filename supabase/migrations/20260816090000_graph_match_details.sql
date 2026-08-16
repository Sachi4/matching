-- 共鳴マップで「誰と誰が、どの感情で、どれくらい共鳴したか」を出せるようにする。
-- 成立したペアの辺に、matches の共鳴度（score）と決め手のトーン（decisive_tone_id）を載せる。
-- 配置ロジック（tone_weights）は 20260816060000 のまま変えていない。

create or replace function public.refresh_resonance_graph()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thr float8;
  top_k int;
  temp float8;
  result jsonb;
begin
  select coalesce((select value from app_settings where key = 'match_threshold'), 0.55)::float8 into thr;
  select coalesce((select value from app_settings where key = 'graph_top_k'), 8)::int into top_k;
  select coalesce((select value from app_settings where key = 'tone_map_temperature'), 12)::float8 into temp;

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
  bounds as (
    select min(resonance) as lo, max(resonance) as hi from scored
  ),
  normalized as (
    select s.*,
      case when b.hi - b.lo < 1e-6 then 0.5
        else (s.resonance - b.lo) / (b.hi - b.lo) end as proximity
    from scored s cross join bounds b
  ),
  ranked as (
    select n.*, m.id as match_id, m.reaction_phrase,
      m.score as match_score, m.decisive_tone_id,
      row_number() over (partition by n.pa order by n.resonance desc) as rk_a,
      row_number() over (partition by n.pb order by n.resonance desc) as rk_b
    from normalized n
    left join matches m
      on m.participant_id_a = n.pa and m.participant_id_b = n.pb
  ),
  kept as (
    select * from ranked
    where rk_a <= top_k or rk_b <= top_k or match_id is not null
  ),
  -- 参加者×トーン: そのトーンの刺激で他の人とどれだけ響き合ったか
  answered as (
    select distinct l.participant_id, s.tone_id
    from latest l
    join stimuli s on s.id = l.stimulus_id
  ),
  tone_sim as (
    select mine.participant_id, s.tone_id,
      avg(1 - (mine.embedding <=> others.embedding))::float8 as sim
    from latest mine
    join stimuli s on s.id = mine.stimulus_id
    join latest others
      on others.stimulus_id = mine.stimulus_id
     and others.participant_id <> mine.participant_id
    group by mine.participant_id, s.tone_id
  ),
  tone_mean as (
    select tone_id, avg(sim)::float8 as mean_sim
    from tone_sim
    group by tone_id
  ),
  -- 類似度がまだ出せない人（そのトーンに一人しか答えていない等）は rel = 0 として均等に置く
  tone_rel as (
    select a.participant_id, a.tone_id,
      coalesce(ts.sim - tm.mean_sim, 0)::float8 as rel,
      ts.sim
    from answered a
    left join tone_sim ts on ts.participant_id = a.participant_id and ts.tone_id = a.tone_id
    left join tone_mean tm on tm.tone_id = a.tone_id
  ),
  tone_exp as (
    select participant_id, tone_id, sim, exp(least(30, greatest(-30, rel * temp))) as w
    from tone_rel
  ),
  tone_weights as (
    select participant_id, tone_id, sim,
      w / sum(w) over (partition by participant_id) as weight
    from tone_exp
  )
  select jsonb_build_object(
    'tones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'label', t.label,
        'sort_order', t.sort_order
      ) order by t.sort_order)
      from tones t
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nickname', p.nickname,
        'is_test', p.is_test,
        'response_count', coalesce(rc.c, 0),
        'tone_weights', coalesce((
          select jsonb_object_agg(tw.tone_id, round(tw.weight::numeric, 4))
          from tone_weights tw
          where tw.participant_id = p.id
        ), '{}'::jsonb),
        'dominant_tone_id', (
          select tw.tone_id from tone_weights tw
          where tw.participant_id = p.id
          order by tw.weight desc limit 1
        )
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
        'proximity', round(k.proximity::numeric, 4),
        'shared_stimuli', k.shared,
        'matched', k.match_id is not null,
        'reaction_phrase', k.reaction_phrase,
        -- 成立したペアだけ: カードと同じ共鳴度と、決め手になった感情
        'score', round(coalesce(k.match_score, k.resonance)::numeric, 4),
        'decisive_tone_id', k.decisive_tone_id
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

select public.refresh_resonance_graph();
