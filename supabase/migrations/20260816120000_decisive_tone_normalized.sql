-- 決め手の感情がほぼ「高揚感」になってしまう偏りを直す。
--
-- 本番データでは感情ごとの類似度の水準がほぼ同じ（平均 怒り0.934 / 高揚感0.925 / 悲しみ0.923）で、
-- 差は0.01程度しかない。決め手を「生の類似度が最も高かったトーン」で選ぶと、
-- 共通刺激ペアの数が多いトーン（高揚感105 / 悲しみ66 / 怒り55）がほぼ必ず勝ってしまう。
-- 配置ロジック（tone_weights）はすでにトーンごとの平均を引いて補正しているので、
-- 決め手も同じようにトーンごとに正規化（偏差÷標準偏差）した値で比べる。

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
  -- トーンごとの類似度の水準（全参加者の全ペア）。決め手を比べるための基準にする
  tone_stats as (
    select s.tone_id,
      avg(1 - (x.embedding <=> y.embedding)) as mean_sim,
      stddev_samp(1 - (x.embedding <=> y.embedding)) as sd_sim
    from (
      select distinct on (r.participant_id, r.stimulus_id)
        r.participant_id, r.stimulus_id, r.embedding
      from public.stimulus_responses r
      where r.embedding is not null
      order by r.participant_id, r.stimulus_id, r.created_at desc
    ) x
    join (
      select distinct on (r.participant_id, r.stimulus_id)
        r.participant_id, r.stimulus_id, r.embedding
      from public.stimulus_responses r
      where r.embedding is not null
      order by r.participant_id, r.stimulus_id, r.created_at desc
    ) y on y.stimulus_id = x.stimulus_id and x.participant_id < y.participant_id
    join public.stimuli s on s.id = x.stimulus_id
    group by s.tone_id
  ),
  -- 相手×トーンの類似度を、そのトーンの水準からのずれに直す
  tone_scored as (
    select p.participant_id, p.tone_id,
      case
        when ts.sd_sim is null or ts.sd_sim < 1e-9 then avg(p.sim) - coalesce(ts.mean_sim, 0)
        else (avg(p.sim) - ts.mean_sim) / ts.sd_sim
      end as rel
    from text_pairs p
    left join tone_stats ts on ts.tone_id = p.tone_id
    group by p.participant_id, p.tone_id, ts.mean_sim, ts.sd_sim
  ),
  decisive as (
    select distinct on (participant_id) participant_id, tone_id
    from tone_scored
    order by participant_id, rel desc
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

-- すでに成立している共鳴の決め手も、同じ基準で引き直す（反応名は生成済みのものを残す）
with latest as (
  select distinct on (r.participant_id, r.stimulus_id)
    r.participant_id, r.stimulus_id, r.embedding
  from public.stimulus_responses r
  where r.embedding is not null
  order by r.participant_id, r.stimulus_id, r.created_at desc
),
pairs as (
  select x.participant_id as pa, y.participant_id as pb, s.tone_id,
    1 - (x.embedding <=> y.embedding) as sim
  from latest x
  join latest y on y.stimulus_id = x.stimulus_id and x.participant_id < y.participant_id
  join public.stimuli s on s.id = x.stimulus_id
),
tone_stats as (
  select tone_id, avg(sim) as mean_sim, stddev_samp(sim) as sd_sim
  from pairs
  group by tone_id
),
scored as (
  select p.pa, p.pb, p.tone_id,
    case
      when ts.sd_sim is null or ts.sd_sim < 1e-9 then avg(p.sim) - ts.mean_sim
      else (avg(p.sim) - ts.mean_sim) / ts.sd_sim
    end as rel
  from pairs p
  join tone_stats ts on ts.tone_id = p.tone_id
  group by p.pa, p.pb, p.tone_id, ts.mean_sim, ts.sd_sim
),
best as (
  select distinct on (pa, pb) pa, pb, tone_id
  from scored
  order by pa, pb, rel desc
)
update public.matches m
set decisive_tone_id = best.tone_id
from best
where m.participant_id_a = best.pa
  and m.participant_id_b = best.pb
  and m.decisive_tone_id is distinct from best.tone_id;

select public.refresh_resonance_graph();
