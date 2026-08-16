# 運命の出会いを科学する

同じ刺激を見た者同士の“感じ方の共鳴”を可視化し、会場に即興のつながりを生むツール。
ハッカソン会場（約70名）でのライブ体験用MVP。

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/diagnosis` … かんたん感性診断（6問・E/N/I軸・8タイプ）
3. `/respond` … 画像を見て感じたことを記録（形容詞チップ + ひとこと自由記述）
4. `/feed` … 集合アート + 共鳴フィード（スマホ用）
4-b. `/quest/[matchId]` … 共鳴後の探索（マッチした二人で1つの感情の解像度を上げる）
5. `/screen` … 会場の大画面用ビュー（集合アートを背景に共鳴フィードを重ねる）
6. `/admin/stimuli` … 運営用: 刺激画像の追加・表示切替・削除

## アーキテクチャ

- フロントエンド: Next.js (App Router) + Tailwind CSS
- バックエンド/DB: Supabase (Postgres + pgvector + Realtime + Edge Functions)
- 感想投稿の流れ:
  1. フロントが Edge Function `submit-response` を呼ぶ
  2. Edge Function が感想文の embedding を生成（OpenAI `text-embedding-3-small`。キー未設定時は簡易フォールバック）
  3. `stimulus_responses` に insert
  4. DB関数 `find_resonance_candidates` が同じ画像を見た他参加者との共鳴度を計算
     - `共鳴度 = text_weight × コサイン類似度 + type_weight × 診断タイプの近さ`
     - 係数・閾値は `app_settings` テーブルで調整可能（初期値 0.6 / 0.4 / 0.8）
  5. 閾値を超えたペアを `matches` に insert し、Claude API で「反応名」（詩的な短句）を生成
- フロントは Supabase Realtime（`postgres_changes`）で `matches` / `stimulus_responses` の insert を購読し、
  共鳴フィードと集合アートを即時更新する

## セットアップ

### 1. Supabase プロジェクト

```bash
npm i -g supabase   # または npx supabase
supabase link --project-ref <your-project-ref>
supabase db push                       # マイグレーション適用
psql "$DATABASE_URL" -f supabase/seed.sql   # デモ用の刺激3枚を投入（SQL Editorに貼り付けでも可）
```

### 2. Edge Function

```bash
supabase functions deploy submit-response
supabase functions deploy quest-turn
supabase secrets set OPENAI_API_KEY=sk-...        # embedding用（任意。未設定でも動く）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # 反応名生成用（任意。未設定でも動く）
```

### 3. フロントエンド

```bash
cp .env.example .env.local   # URLとanonキーを記入
npm install
npm run dev
```

## 共鳴後の探索（Resonance Quest / Phase 1）

共鳴は「似ている」の発見。探索は **「同じ言葉の中身が違う」の発見**。
マッチした二人が1つの感情（高揚感 / 悲しみ / 怒り）を3レイヤーで掘り下げる。

- 入口: `/feed` の自分が当事者の共鳴カードにある「この感情を探索する」
- 各レイヤーは **同時に書く → 両者そろったら同時に開く**（相手を見てから書けないのでミラーリングが起きない）
  - L1 輪郭: 体感のチップ選択 → 重なった体感をハイライト
  - L2 温度と速度: -1〜1 の2軸スライダー → 二人の点を同じ平面にプロット（点の距離がずれの可視化）
  - L3 出どころ: 1文の自由記述 → embedding のコサイン類似度
- 進行の同期は Supabase Realtime（`quest_turns` / `quest_sessions` / `quest_shared_terms`）
- L3完了時に Claude が二人だけの **共有語**（造語 + 説明）を生成し `quest_shared_terms` に保存
- スコアは2軸 + 解像度で出す（一致だけを褒めない）
  - `共鳴 = L1一致率(Jaccard)×w1 + (1 − L2正規化距離)×w2 + L3類似度×w3`（未完了レイヤーは重みから除外して正規化）
  - `対比 = 1 − 共鳴`。ただし「記述は近いのに2軸が遠い」ペアは *深い差* として加点
  - `解像度 = 両者がそろったレイヤー数`
- 回答の書き込みは Edge Function `quest-turn`（service role）経由のみ。embedding は
  Realtimeのペイロードを軽くするため `quest_turn_embeddings` に分離している

Phase 2以降（未実装）: 3感情の周回、感情マップ画像の `/feed` `/screen` への露出、
会場マッピングとの接続（解像度Lv.3ペアの星座表示）。

## 調整可能なパラメータ

`app_settings` テーブルをSQLで更新するだけで反映される:

```sql
update app_settings set value = 0.7 where key = 'text_weight';
update app_settings set value = 0.3 where key = 'type_weight';
update app_settings set value = 0.75 where key = 'match_threshold';

-- 探索のスコア重み
update app_settings set value = 0.4 where key = 'quest_l3_weight';
update app_settings set value = 0.2 where key = 'quest_deep_contrast_bonus';
```

## 刺激（画像）の追加・削除

- `/admin/stimuli` から追加・表示切替・削除ができる
- 画像は `public/stimuli/` に置いたパス（例 `/stimuli/04.svg`）でも外部URLでもよい
- SQLで直接 `stimuli` テーブルを操作してもよい

## スコープ外（意図的に作っていないもの）

- 物理的な座席位置とのひも付け / プッシュ通知
- ログイン・認証・決済
- メーカー向け分析ダッシュボード
