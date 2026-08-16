-- 共鳴後の探索（Resonance Quest）Phase 1:
-- マッチしたペアが1つの感情（高揚感 / 悲しみ / 怒り）を3レイヤーで掘り下げ、
-- 「共鳴」と「対比」の2軸 + 解像度を出して、二人だけの共有語を残す

-- 探索セッション（1ペア × 1感情）
create table public.quest_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  emotion text not null check (emotion in ('elation', 'sadness', 'anger')),
  layer int not null default 1 check (layer between 1 and 3),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint quest_sessions_match_emotion_unique unique (match_id, emotion)
);
create index quest_sessions_match_idx on public.quest_sessions (match_id);

-- 各レイヤーの回答（1レイヤーにつき1人1回答）
-- L1: chips（体感のチップ） / L2: axis_x, axis_y（-1〜1の2軸） / L3: text_answer
create table public.quest_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quest_sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  layer int not null check (layer between 1 and 3),
  chips text[] not null default '{}',
  axis_x numeric(4,3),
  axis_y numeric(4,3),
  text_answer text,
  created_at timestamptz not null default now(),
  constraint quest_turns_unique unique (session_id, participant_id, layer)
);
create index quest_turns_session_idx on public.quest_turns (session_id);

-- embeddingは別テーブルに置く。quest_turns はRealtimeで購読するので、
-- 1536次元のベクトルが毎回ペイロードに乗らないようにするため
create table public.quest_turn_embeddings (
  turn_id uuid primary key references public.quest_turns(id) on delete cascade,
  embedding vector(1536) not null
);

-- 探索の結果として残る「共有語」
create table public.quest_shared_terms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quest_sessions(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  emotion text not null,
  term text not null,
  description text,
  resonance numeric(5,4) not null,
  contrast numeric(5,4) not null,
  resolution int not null,
  created_at timestamptz not null default now(),
  constraint quest_shared_terms_session_unique unique (session_id)
);
create index quest_shared_terms_match_idx on public.quest_shared_terms (match_id);

-- 探索スコアの重み（既存の app_settings と同じくSQLでライブ調整できる）
insert into public.app_settings (key, value, description) values
  ('quest_l1_weight', 0.3, '探索スコアにおけるL1（体感チップ）の一致率の重み'),
  ('quest_l2_weight', 0.3, '探索スコアにおけるL2（温度と速度の2軸）の近さの重み'),
  ('quest_l3_weight', 0.4, '探索スコアにおけるL3（出どころの記述）の類似度の重み'),
  ('quest_deep_contrast_bonus', 0.15, '記述は近いのに2軸が遠い「深い差」への対比軸の加点');

-- 探索の結果を計算する。
-- 共鳴 = L1一致率(Jaccard) × w1 + (1 - L2正規化距離) × w2 + L3テキスト類似度 × w3
-- 対比 = 1 - 共鳴。ただし「記述は近いのに2軸が遠い」ペアは深い差として加点する
-- 解像度 = 両者がそろったレイヤー数
create or replace function public.compute_quest_result(p_session_id uuid)
returns table (
  l1_overlap double precision,
  l2_distance double precision,
  text_similarity double precision,
  resonance double precision,
  contrast double precision,
  resolution int
)
language sql
stable
as $$
  with cfg as (
    select
      (select value from public.app_settings where key = 'quest_l1_weight')::float8 as w1,
      (select value from public.app_settings where key = 'quest_l2_weight')::float8 as w2,
      (select value from public.app_settings where key = 'quest_l3_weight')::float8 as w3,
      (select value from public.app_settings where key = 'quest_deep_contrast_bonus')::float8 as bonus
  ),
  -- 両者がそろったレイヤーだけを対象にする
  ready as (
    select layer
    from public.quest_turns
    where session_id = p_session_id
    group by layer
    having count(distinct participant_id) >= 2
  ),
  l1 as (
    select
      case
        when cardinality(a.chips) = 0 and cardinality(b.chips) = 0 then null
        else (
          select count(*)::float8 from (
            select unnest(a.chips) intersect select unnest(b.chips)
          ) i
        ) / (
          select greatest(count(*), 1)::float8 from (
            select unnest(a.chips) union select unnest(b.chips)
          ) u
        )
      end as overlap
    from public.quest_turns a, public.quest_turns b
    where a.session_id = p_session_id and b.session_id = p_session_id
      and a.layer = 1 and b.layer = 1
      and a.participant_id < b.participant_id
      and 1 in (select layer from ready)
  ),
  l2 as (
    -- 2軸はどちらも -1〜1 なので最大距離は 2*sqrt(2)
    select least(1.0,
      sqrt(power(a.axis_x - b.axis_x, 2) + power(a.axis_y - b.axis_y, 2))::float8 / (2 * sqrt(2.0))
    ) as distance
    from public.quest_turns a, public.quest_turns b
    where a.session_id = p_session_id and b.session_id = p_session_id
      and a.layer = 2 and b.layer = 2
      and a.participant_id < b.participant_id
      and a.axis_x is not null and b.axis_x is not null
      and 2 in (select layer from ready)
  ),
  l3 as (
    select (1 - (ea.embedding <=> eb.embedding))::float8 as similarity
    from public.quest_turns a
    join public.quest_turn_embeddings ea on ea.turn_id = a.id
    join public.quest_turns b on b.session_id = a.session_id and b.layer = a.layer
    join public.quest_turn_embeddings eb on eb.turn_id = b.id
    where a.session_id = p_session_id
      and a.layer = 3
      and a.participant_id < b.participant_id
      and 3 in (select layer from ready)
  ),
  agg as (
    select
      (select overlap from l1) as l1_overlap,
      (select distance from l2) as l2_distance,
      (select similarity from l3) as text_similarity,
      (select count(*)::int from ready) as resolution
  ),
  -- 未完了のレイヤーは 0 ではなく「重みから除外」して正規化する
  weighted as (
    select
      agg.*,
      cfg.bonus,
      coalesce(cfg.w1 * agg.l1_overlap, 0)
        + coalesce(cfg.w2 * (1 - agg.l2_distance), 0)
        + coalesce(cfg.w3 * agg.text_similarity, 0) as raw_sum,
      case when agg.l1_overlap is null then 0 else cfg.w1 end
        + case when agg.l2_distance is null then 0 else cfg.w2 end
        + case when agg.text_similarity is null then 0 else cfg.w3 end as weight_sum
    from agg, cfg
  ),
  scored as (
    select
      w.*,
      case when w.weight_sum = 0 then 0 else w.raw_sum / w.weight_sum end as resonance
    from weighted w
  )
  select
    s.l1_overlap,
    s.l2_distance,
    s.text_similarity,
    greatest(0, least(1, s.resonance)) as resonance,
    greatest(0, least(1,
      (1 - s.resonance)
      + case
          when coalesce(s.text_similarity, 0) >= 0.7 and coalesce(s.l2_distance, 0) >= 0.5
          then s.bonus
          else 0
        end
    )) as contrast,
    s.resolution
  from scored s;
$$;

-- RLS: 既存と同じく、イベント用の匿名アプリのためanonに読み書きを許可
alter table public.quest_sessions enable row level security;
alter table public.quest_turns enable row level security;
alter table public.quest_turn_embeddings enable row level security;
alter table public.quest_shared_terms enable row level security;

create policy "anon read quest sessions" on public.quest_sessions for select using (true);
create policy "anon insert quest sessions" on public.quest_sessions for insert with check (true);
create policy "anon update quest sessions" on public.quest_sessions for update using (true);

-- quest_turns / embeddings への書き込みは Edge Function（service role）経由のみ
create policy "anon read quest turns" on public.quest_turns for select using (true);

create policy "anon read quest shared terms" on public.quest_shared_terms for select using (true);

-- Realtime: 相手の回答がそろった瞬間に「同時公開」するため turns / sessions を購読する
alter publication supabase_realtime add table public.quest_turns;
alter publication supabase_realtime add table public.quest_sessions;
alter publication supabase_realtime add table public.quest_shared_terms;
