-- 運命の出会いを科学する: 初期スキーマ
create extension if not exists vector;

-- 参加者（ニックネームのみ、認証なし）
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  created_at timestamptz not null default now()
);

-- 感情トーンのマスタ。画像・ヒント語・診断質問はすべてここを参照する
create table public.tones (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  sort_order int not null default 0
);

-- 刺激（画像）。追加・削除はSupabaseのTable Editorから直接行う運用
create table public.stimuli (
  id uuid primary key default gen_random_uuid(),
  tone_id uuid not null references public.tones(id) on delete cascade,
  image_url text,
  is_active boolean not null default true,
  stimulus_type text not null default 'image',
  created_at timestamptz not null default now()
);
create index stimuli_tone_idx on public.stimuli (tone_id);

-- 感想入力のヒント語（トーンごと）
create table public.hint_words (
  id uuid primary key default gen_random_uuid(),
  tone_id uuid not null references public.tones(id) on delete cascade,
  word text not null,
  sort_order int not null default 0
);
create index hint_words_tone_idx on public.hint_words (tone_id);

-- 診断質問（トーンごと2問、a=表出 / b=内省）
create table public.diagnosis_questions (
  id uuid primary key default gen_random_uuid(),
  tone_id uuid not null references public.tones(id) on delete cascade,
  prompt text not null default '',
  text_a text not null,
  text_b text not null,
  axis text not null default '表出/内省',
  sort_order int not null default 0
);
create index diagnosis_questions_tone_idx on public.diagnosis_questions (tone_id);

-- 感想（ヒント語 + 自由記述 + embedding）
create table public.stimulus_responses (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  stimulus_id uuid not null references public.stimuli(id) on delete cascade,
  hint_words_selected text[] not null default '{}',
  free_text text not null default '',
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index stimulus_responses_embedding_idx on public.stimulus_responses
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);
create index stimulus_responses_participant_idx on public.stimulus_responses (participant_id);
create index stimulus_responses_stimulus_idx on public.stimulus_responses (stimulus_id);

-- 診断回答（質問ごとに 'a' または 'b'）
create table public.diagnosis_answers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_id uuid not null references public.diagnosis_questions(id) on delete cascade,
  choice text not null check (choice in ('a', 'b')),
  created_at timestamptz not null default now(),
  constraint diagnosis_answers_unique unique (participant_id, question_id)
);
create index diagnosis_answers_participant_idx on public.diagnosis_answers (participant_id);

-- 共鳴（マッチ）
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  participant_id_a uuid not null references public.participants(id) on delete cascade,
  participant_id_b uuid not null references public.participants(id) on delete cascade,
  score numeric(5,4) not null,
  decisive_tone_id uuid references public.tones(id) on delete set null,
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
  ('text_weight', 0.6, '共鳴度における感想文embedding類似度の重み'),
  ('type_weight', 0.4, '共鳴度における診断スコアの近さの重み'),
  ('match_threshold', 0.90, '共鳴度がこの値を超えたらマッチ成立（厳しめ 0.88〜0.92 を想定）');

-- 共鳴候補の探索:
-- 共鳴度 = w_text × (感想文embeddingの全体類似度)
--        + w_type × (回答済みトーンの診断スコアの近さの平均)
-- ・embedding類似度は同じ刺激に両者が回答したペアのコサイン類似度の平均
-- ・診断スコアはトーンごとの a（表出）率。近さ = 1 - |差|。両者が回答したトーンのみで平均（未回答は除外）
-- ・decisive_tone_id は感想文の類似度が最も高かったトーン
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
  with cfg as (
    select
      (select value from public.app_settings where key = 'text_weight')::float8 as w_text,
      (select value from public.app_settings where key = 'type_weight')::float8 as w_type
  ),
  my_resp as (
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
  ),
  tone_scores as (
    select a.participant_id, q.tone_id,
      avg(case when a.choice = 'a' then 1.0 else 0.0 end) as expression_rate
    from public.diagnosis_answers a
    join public.diagnosis_questions q on q.id = a.question_id
    group by a.participant_id, q.tone_id
  ),
  diag_pairs as (
    select o.participant_id, 1 - abs(o.expression_rate - m.expression_rate) as closeness
    from tone_scores m
    join tone_scores o on o.tone_id = m.tone_id and o.participant_id <> m.participant_id
    where m.participant_id = p_participant_id
  ),
  diag_agg as (
    select participant_id, avg(closeness) as diag_close
    from diag_pairs
    group by participant_id
  )
  select
    t.participant_id,
    t.text_sim,
    coalesce(d.diag_close, 0.5) as diag_close,
    cfg.w_text * t.text_sim + cfg.w_type * coalesce(d.diag_close, 0.5) as resonance,
    dec.tone_id
  from text_agg t
  left join diag_agg d on d.participant_id = t.participant_id
  left join decisive dec on dec.participant_id = t.participant_id
  cross join cfg
  order by resonance desc;
$$;

-- 権限: RLSポリシーに加えてテーブルレベルのGRANTが必要
grant usage on schema public to anon, authenticated;
grant select, insert on public.participants to anon, authenticated;
grant select on public.tones to anon, authenticated;
grant select on public.stimuli to anon, authenticated;
grant select on public.hint_words to anon, authenticated;
grant select on public.diagnosis_questions to anon, authenticated;
grant select, insert on public.stimulus_responses to anon, authenticated;
grant select, insert on public.diagnosis_answers to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.app_settings to anon, authenticated;

-- Edge Function（service_role接続）用: BYPASSRLSでもテーブルGRANTは必要
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.find_resonance_candidates(uuid) to service_role, anon, authenticated;

-- RLS: イベント用の匿名アプリのため、anonに読み書きを許可（認証はスコープ外）
alter table public.participants enable row level security;
alter table public.tones enable row level security;
alter table public.stimuli enable row level security;
alter table public.hint_words enable row level security;
alter table public.diagnosis_questions enable row level security;
alter table public.stimulus_responses enable row level security;
alter table public.diagnosis_answers enable row level security;
alter table public.matches enable row level security;
alter table public.app_settings enable row level security;

create policy "anon read participants" on public.participants for select using (true);
create policy "anon insert participants" on public.participants for insert with check (true);

create policy "anon read tones" on public.tones for select using (true);
create policy "anon read stimuli" on public.stimuli for select using (true);
create policy "anon read hint_words" on public.hint_words for select using (true);
create policy "anon read questions" on public.diagnosis_questions for select using (true);

create policy "anon read responses" on public.stimulus_responses for select using (true);
create policy "anon insert responses" on public.stimulus_responses for insert with check (true);

create policy "anon read answers" on public.diagnosis_answers for select using (true);
create policy "anon insert answers" on public.diagnosis_answers for insert with check (true);

create policy "anon read matches" on public.matches for select using (true);

create policy "anon read settings" on public.app_settings for select using (true);

-- Realtime: matches / stimulus_responses のinsertをフロントで購読する
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.stimulus_responses;
