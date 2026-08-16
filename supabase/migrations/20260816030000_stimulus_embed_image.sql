-- マルチモーダルembedding用のラスタ画像。表示用のSVGはGeminiが受け付けないため、
-- 同じ絵のPNGを埋め込み用に持たせる（未設定なら image_url がPNG/JPEGのときだけ使われる）
alter table public.stimuli
  add column if not exists embed_image_url text;

update public.stimuli
set embed_image_url = regexp_replace(image_url, '\.svg$', '.png')
where embed_image_url is null and image_url like '%.svg';

-- embeddingモデルを変えると共鳴度の分布ごと変わるため、閾値を引き直すための分布を返す
create or replace function public.resonance_similarity_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (r.participant_id, r.stimulus_id)
      r.participant_id, r.stimulus_id, r.embedding
    from stimulus_responses r
    where r.embedding is not null
    order by r.participant_id, r.stimulus_id, r.created_at desc
  ),
  scored as (
    select avg(1 - (x.embedding <=> y.embedding))::float8 as resonance
    from latest x
    join latest y on y.stimulus_id = x.stimulus_id and x.participant_id < y.participant_id
    group by x.participant_id, y.participant_id
  )
  select jsonb_build_object(
    'pairs', count(*),
    'min', round(min(resonance)::numeric, 3),
    'median', round(percentile_cont(0.5) within group (order by resonance)::numeric, 3),
    'p90', round(percentile_cont(0.9) within group (order by resonance)::numeric, 3),
    'max', round(max(resonance)::numeric, 3),
    'over_threshold', count(*) filter (
      where resonance > coalesce((select value from app_settings where key = 'match_threshold'), 0.55)::float8
    )
  )
  from scored;
$$;

grant execute on function public.resonance_similarity_stats() to service_role;

-- 星座の配置用に、共鳴度をその時点の全ペアの中での相対値（0〜1）に正規化して持たせる。
-- embeddingモデルによって類似度の絶対値のレンジは大きく変わる（Geminiは全体的に高く出る）ため、
-- 生の値をそのまま距離に使うと「似ている人ほど近い」が見えなくなる。閾値判定と表示は生の値のまま。
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
      row_number() over (partition by n.pa order by n.resonance desc) as rk_a,
      row_number() over (partition by n.pb order by n.resonance desc) as rk_b
    from normalized n
    left join matches m
      on m.participant_id_a = n.pa and m.participant_id_b = n.pb
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
        'proximity', round(k.proximity::numeric, 4),
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

-- Geminiのembedding空間は類似度が全体的に高く出るため（本番データ45組で median 0.92 / p90 0.94 /
-- max 0.97）、0.55 のままだと全ペアが成立してしまう。0.95 で45組中2組（約4%）と、
-- 旧モデル（0.55で3組）と同じ「めったに起きないが確かに起きる」バランスになる。
update public.app_settings
set value = 0.95,
    description = '共鳴度（感想文＋刺激画像のembedding類似度）がこの値を超えたらマッチ成立'
where key = 'match_threshold';

select public.refresh_resonance_graph();
