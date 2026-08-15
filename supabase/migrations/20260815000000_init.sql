-- 運命の出会いを科学する: 初期スキーマ
create extension if not exists vector;

-- 参加者（ニックネームのみ、認証なし）
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  created_at timestamptz not null default now()
);

-- 刺激（画像など）。運営が自由に追加・削除できる
create table public.stimuli (
  id uuid primary key default gen_random_uuid(),
  stimulus_type text not null default 'image',
  image_url text,
  emotional_tone_label text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 感想（形容詞タグ + 自由記述 + embedding）
create table public.stimulus_responses (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  stimulus_id uuid not null references public.stimuli(id) on delete cascade,
  response_text text not null,
  selected_tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index stimulus_responses_embedding_idx on public.stimulus_responses
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);
create index stimulus_responses_participant_idx on public.stimulus_responses (participant_id);
create index stimulus_responses_stimulus_idx on public.stimulus_responses (stimulus_id);

-- 簡易診断の結果（E/N/I軸の数値スコア + タイプ）
create table public.diagnosis_scores (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  type_key text not null,
  type_name text not null,
  axis_e numeric(6,2) not null,
  axis_n numeric(6,2) not null,
  axis_i numeric(6,2) not null,
  created_at timestamptz not null default now()
);
create index diagnosis_scores_participant_idx on public.diagnosis_scores (participant_id);

-- 共鳴（マッチ）
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  participant_id_a uuid not null references public.participants(id) on delete cascade,
  participant_id_b uuid not null references public.participants(id) on delete cascade,
  stimulus_id uuid references public.stimuli(id) on delete set null,
  score numeric(5,4) not null,
  reaction_phrase text,
  created_at timestamptz not null default now(),
  constraint matches_pair_order check (participant_id_a < participant_id_b),
  constraint matches_pair_unique unique (participant_id_a, participant_id_b)
);

-- 調整可能な設定（共鳴度の係数・閾値）
create table public.app_settings (
  key text primary key,
  value numeric not null,
  description text
);
insert into public.app_settings (key, value, description) values
  ('text_weight', 0.6, '共鳴度における感想文ベクトル類似度の重み'),
  ('type_weight', 0.4, '共鳴度における診断タイプの近さの重み'),
  ('match_threshold', 0.8, '共鳴度がこの値を超えたらマッチ成立');

-- 共鳴候補の探索:
-- 新しい感想の embedding と、他の参加者の感想（同一刺激）とのコサイン類似度、
-- 診断タイプの近さ（E/N/I軸の正規化ユークリッド距離）を加重平均した共鳴度を返す
create or replace function public.find_resonance_candidates(p_response_id uuid)
returns table (
  other_participant_id uuid,
  text_similarity double precision,
  type_closeness double precision,
  resonance double precision
)
language sql
stable
as $$
  with cfg as (
    select
      (select value from public.app_settings where key = 'text_weight')::float8 as w_text,
      (select value from public.app_settings where key = 'type_weight')::float8 as w_type
  ),
  me as (
    select r.id, r.participant_id, r.stimulus_id, r.embedding
    from public.stimulus_responses r
    where r.id = p_response_id
  ),
  my_diag as (
    select d.axis_e, d.axis_n, d.axis_i
    from public.diagnosis_scores d, me
    where d.participant_id = me.participant_id
    order by d.created_at desc
    limit 1
  ),
  others as (
    select distinct on (r.participant_id)
      r.participant_id,
      1 - (r.embedding <=> me.embedding) as text_sim
    from public.stimulus_responses r, me
    where r.participant_id <> me.participant_id
      and r.stimulus_id = me.stimulus_id
      and r.embedding is not null
    order by r.participant_id, r.created_at desc
  ),
  scored as (
    select
      o.participant_id,
      o.text_sim,
      coalesce(
        (
          select 1 - least(1.0,
            sqrt(
              power(d.axis_e - m.axis_e, 2) +
              power(d.axis_n - m.axis_n, 2) +
              power(d.axis_i - m.axis_i, 2)
            ) / 20.0
          )
          from public.diagnosis_scores d, my_diag m
          where d.participant_id = o.participant_id
          order by d.created_at desc
          limit 1
        ),
        0.5
      ) as type_close
    from others o
  )
  select
    s.participant_id,
    s.text_sim,
    s.type_close,
    cfg.w_text * s.text_sim + cfg.w_type * s.type_close as resonance
  from scored s, cfg
  order by resonance desc;
$$;

-- 権限: RLSポリシーに加えてテーブルレベルのGRANTが必要
grant usage on schema public to anon, authenticated;
grant select, insert on public.participants to anon, authenticated;
grant select, insert, update, delete on public.stimuli to anon, authenticated;
grant select, insert on public.stimulus_responses to anon, authenticated;
grant select, insert on public.diagnosis_scores to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.app_settings to anon, authenticated;

-- Edge Function（service_role接続）用: BYPASSRLSでもテーブルGRANTは必要
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.find_resonance_candidates(uuid) to service_role, anon, authenticated;

-- RLS: イベント用の匿名アプリのため、anonに読み書きを許可（認証はスコープ外）
alter table public.participants enable row level security;
alter table public.stimuli enable row level security;
alter table public.stimulus_responses enable row level security;
alter table public.diagnosis_scores enable row level security;
alter table public.matches enable row level security;
alter table public.app_settings enable row level security;

create policy "anon read participants" on public.participants for select using (true);
create policy "anon insert participants" on public.participants for insert with check (true);

create policy "anon read stimuli" on public.stimuli for select using (true);
create policy "anon insert stimuli" on public.stimuli for insert with check (true);
create policy "anon update stimuli" on public.stimuli for update using (true);
create policy "anon delete stimuli" on public.stimuli for delete using (true);

create policy "anon read responses" on public.stimulus_responses for select using (true);
create policy "anon insert responses" on public.stimulus_responses for insert with check (true);

create policy "anon read diagnosis" on public.diagnosis_scores for select using (true);
create policy "anon insert diagnosis" on public.diagnosis_scores for insert with check (true);

create policy "anon read matches" on public.matches for select using (true);

create policy "anon read settings" on public.app_settings for select using (true);

-- Realtime: matches / stimulus_responses のinsertをフロントで購読する
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.stimulus_responses;
