-- 非同期化・テストモード・星座UI用のキャッシュ

-- 追加設定
insert into public.app_settings (key, value, description) values
  ('test_mode', 0, '1でテストモード。/admin/test のデバッグUIとテスト用RPCを有効にする'),
  ('graph_top_k', 8, '星座UIで参加者1人あたりに配信する近傍エッジの本数')
on conflict (key) do nothing;

-- テスト用に投入した参加者の目印（cleanupの対象になる）
alter table public.participants
  add column if not exists is_test boolean not null default false;

-- デバッグ操作の合言葉。anonからは読めない（RLS有効・ポリシーなし・GRANTなし）
create table if not exists public.debug_config (
  id int primary key default 1,
  token text not null default 'kyomei-debug',
  constraint debug_config_single_row check (id = 1)
);
insert into public.debug_config (id) values (1) on conflict (id) do nothing;
alter table public.debug_config enable row level security;

-- 星座UI用の共鳴グラフキャッシュ（1行のみ。回答が入るたびに再計算して配信する）
create table if not exists public.resonance_graph (
  id int primary key default 1,
  payload jsonb not null default '{"nodes": [], "edges": []}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint resonance_graph_single_row check (id = 1)
);
insert into public.resonance_graph (id) values (1) on conflict (id) do nothing;

-- 全参加者ぶんの類似度をまとめて計算し、キャッシュ行を更新する。
-- フロントは毎フレーム計算せず、このキャッシュのRealtime更新を受け取るだけでよい。
create or replace function public.refresh_resonance_graph()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w_text float8;
  w_type float8;
  thr float8;
  top_k int;
  result jsonb;
begin
  select coalesce((select value from app_settings where key = 'text_weight'), 0.6)::float8 into w_text;
  select coalesce((select value from app_settings where key = 'type_weight'), 0.4)::float8 into w_type;
  select coalesce((select value from app_settings where key = 'match_threshold'), 0.9)::float8 into thr;
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
  tone_scores as (
    select a.participant_id, q.tone_id,
      avg(case when a.choice = 'a' then 1.0 else 0.0 end)::float8 as rate
    from diagnosis_answers a
    join diagnosis_questions q on q.id = a.question_id
    group by a.participant_id, q.tone_id
  ),
  expression as (
    select participant_id, avg(rate)::float8 as rate
    from tone_scores
    group by participant_id
  ),
  pairs as (
    select x.participant_id as pa, y.participant_id as pb,
      avg(1 - (x.embedding <=> y.embedding))::float8 as text_sim,
      count(*)::int as shared
    from latest x
    join latest y on y.stimulus_id = x.stimulus_id and x.participant_id < y.participant_id
    group by x.participant_id, y.participant_id
  ),
  diag as (
    select x.participant_id as pa, y.participant_id as pb,
      avg(1 - abs(x.rate - y.rate))::float8 as closeness
    from tone_scores x
    join tone_scores y on y.tone_id = x.tone_id and x.participant_id < y.participant_id
    group by x.participant_id, y.participant_id
  ),
  scored as (
    select p.pa, p.pb, p.text_sim, p.shared,
      coalesce(d.closeness, 0.5) as closeness,
      w_text * p.text_sim + w_type * coalesce(d.closeness, 0.5) as resonance
    from pairs p
    left join diag d on d.pa = p.pa and d.pb = p.pb
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
        'response_count', coalesce(rc.c, 0),
        'expression_rate', e.rate
      ) order by p.created_at)
      from participants p
      left join response_counts rc on rc.participant_id = p.id
      left join expression e on e.participant_id = p.id
      where coalesce(rc.c, 0) > 0
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'a', k.pa,
        'b', k.pb,
        'text_similarity', round(k.text_sim::numeric, 4),
        'diagnosis_closeness', round(k.closeness::numeric, 4),
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

create or replace function public.trg_refresh_resonance_graph()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_resonance_graph();
  return null;
end;
$$;

drop trigger if exists stimulus_responses_refresh_graph on public.stimulus_responses;
create trigger stimulus_responses_refresh_graph
after insert or update or delete on public.stimulus_responses
for each statement execute function public.trg_refresh_resonance_graph();

drop trigger if exists diagnosis_answers_refresh_graph on public.diagnosis_answers;
create trigger diagnosis_answers_refresh_graph
after insert or update or delete on public.diagnosis_answers
for each statement execute function public.trg_refresh_resonance_graph();

drop trigger if exists matches_refresh_graph on public.matches;
create trigger matches_refresh_graph
after insert or update or delete on public.matches
for each statement execute function public.trg_refresh_resonance_graph();

-- テストモード用RPC（合言葉つき。テストモードが有効なときだけ書き込みを許す）
create or replace function public.debug_check(p_token text, p_require_test_mode boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is distinct from (select token from debug_config where id = 1) then
    raise exception '合言葉が違います';
  end if;
  if p_require_test_mode
    and coalesce((select value from app_settings where key = 'test_mode'), 0) < 1 then
    raise exception 'テストモードが無効です';
  end if;
end;
$$;

create or replace function public.set_test_mode(p_token text, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.debug_check(p_token, false);
  update app_settings set value = case when p_on then 1 else 0 end where key = 'test_mode';
  return p_on;
end;
$$;

-- b) 計算ロジックを経由せず matches に直接ダミー結果をinsertする
create or replace function public.test_force_match(
  p_token text,
  p_score numeric default 0.93,
  p_phrase text default 'しずかな共振'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  suffix text := substr(md5(random()::text), 1, 4);
  id_a uuid;
  id_b uuid;
  tone uuid;
  match_id uuid;
begin
  perform public.debug_check(p_token);

  insert into participants (nickname, is_test) values ('テストA-' || suffix, true) returning id into id_a;
  insert into participants (nickname, is_test) values ('テストB-' || suffix, true) returning id into id_b;
  select id into tone from tones order by sort_order limit 1;

  insert into matches (participant_id_a, participant_id_b, score, decisive_tone_id, reaction_phrase)
  values (least(id_a, id_b), greatest(id_a, id_b), p_score, tone, p_phrase)
  returning id into match_id;

  return jsonb_build_object(
    'match_id', match_id,
    'nickname_a', 'テストA-' || suffix,
    'nickname_b', 'テストB-' || suffix
  );
end;
$$;

-- テスト参加者と、そこにぶら下がる感想・回答・共鳴をまとめて削除する
create or replace function public.test_cleanup(p_token text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  perform public.debug_check(p_token, false);
  delete from participants where is_test;
  get diagnostics removed = row_count;
  perform public.refresh_resonance_graph();
  return removed;
end;
$$;

-- a) の下ごしらえ: テスト参加者を作る（感想はEdge Functionを通して投稿するため、ここでは作らない）
create or replace function public.test_create_participant(p_token text, p_nickname text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.debug_check(p_token);
  insert into participants (nickname, is_test) values (p_nickname, true) returning id into new_id;
  return new_id;
end;
$$;

-- 権限
grant select on public.resonance_graph to anon, authenticated;
grant execute on function public.refresh_resonance_graph() to anon, authenticated, service_role;
grant execute on function public.set_test_mode(text, boolean) to anon, authenticated, service_role;
grant execute on function public.test_force_match(text, numeric, text) to anon, authenticated, service_role;
grant execute on function public.test_cleanup(text) to anon, authenticated, service_role;
grant execute on function public.test_create_participant(text, text) to anon, authenticated, service_role;
revoke execute on function public.debug_check(text, boolean) from anon, authenticated;

alter table public.resonance_graph enable row level security;
drop policy if exists "anon read graph" on public.resonance_graph;
create policy "anon read graph" on public.resonance_graph for select using (true);

-- Realtime: 星座UIはこのキャッシュのUPDATEを購読する
do $$
begin
  alter publication supabase_realtime add table public.resonance_graph;
exception when duplicate_object then null;
end;
$$;

select public.refresh_resonance_graph();
