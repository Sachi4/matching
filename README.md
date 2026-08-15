# 運命の出会いを科学する

同じ画像を見た者同士の“感じ方の共鳴”を可視化し、会場に即興のつながりを生むツール。
ハッカソン会場（約70名）でのライブ体験用MVP。

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/respond` … トーン（高揚感／悲しみ／怒り）ごとに以下を繰り返すメインフロー
   1. 画像を見る
   2. 感じたことを記録する（トーンごとのヒント語 + ひとこと自由記述）
   3. そのトーンに紐づく診断質問（2問・表出/内省軸）に答える
3. `/feed` … 集合アート + 共鳴フィード（スマホ用）
4. `/screen` … 会場の大画面用ビュー（集合アートを背景に共鳴フィードを重ねる）

刺激（画像）・ヒント語・診断質問の追加や変更は、Supabase の Table Editor から
`tones` / `stimuli` / `hint_words` / `diagnosis_questions` を直接編集する運用（管理画面はなし）。

## アーキテクチャ

- フロントエンド: Next.js (App Router) + Tailwind CSS
- バックエンド/DB: Supabase (Postgres + pgvector + Realtime + Edge Functions)
- `tones` をマスタとし、画像・ヒント語・診断質問はすべて `tone_id` で参照する
  （トーンを追加してもコード変更は不要）
- 感想投稿〜マッチングの流れ:
  1. 感想入力後、フロントが Edge Function `submit-response` を呼ぶ
     → 感想文（ヒント語 + 自由記述）の embedding を生成し `stimulus_responses` に insert
     （OpenAI `text-embedding-3-small`。キー未設定時は簡易フォールバック）
  2. 診断質問の回答は `diagnosis_answers` に直接 insert（a=表出 / b=内省）
  3. トーンの質問に答え終わるたびにフロントが Edge Function `check-resonance` を呼ぶ
  4. DB関数 `find_resonance_candidates` が他参加者との共鳴度を計算
     - `共鳴度 = text_weight × 感想文embeddingの全体類似度 + type_weight × 回答済みトーンの診断スコアの近さの平均`
     - embedding類似度は同じ刺激に両者が回答したペアのコサイン類似度の平均
     - 診断スコアはトーンごとの表出率。近さは両者が回答したトーンのみで平均（未回答は除外）
     - 係数・閾値は `app_settings` テーブルで調整可能（初期値 0.6 / 0.4 / 0.90）
  5. 閾値を超えたペアを `matches` に insert。感想文の類似度が最も高かったトーンを
     `decisive_tone_id` として記録し、そのトーンの感想文から Claude API で「反応名」（詩的な短句）を生成
- フロントは Supabase Realtime（`postgres_changes`）で `matches` / `stimulus_responses` の insert を購読し、
  共鳴フィードと集合アートを即時更新する

## セットアップ

### 1. Supabase プロジェクト

```bash
npm i -g supabase   # または npx supabase
supabase link --project-ref <your-project-ref>
supabase db push                       # マイグレーション適用
psql "$DATABASE_URL" -f supabase/seed.sql   # トーン・画像・ヒント語・診断質問を投入（SQL Editorに貼り付けでも可）
```

### 2. Edge Functions

```bash
supabase functions deploy submit-response
supabase functions deploy check-resonance
supabase secrets set OPENAI_API_KEY=sk-...        # embedding用（任意。未設定でも動く）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # 反応名生成用（任意。未設定でも動く）
supabase secrets set ALLOWED_ORIGIN=https://...   # 本番のフロントのオリジン（任意。未設定は*）
```

### 3. フロントエンド

```bash
cp .env.example .env.local   # URLとanonキーを記入
npm install
npm run dev
```

## 調整可能なパラメータ

`app_settings` テーブルをSQLで更新するだけで反映される:

```sql
update app_settings set value = 0.7 where key = 'text_weight';
update app_settings set value = 0.3 where key = 'type_weight';
update app_settings set value = 0.88 where key = 'match_threshold';  -- 厳しめ 0.88〜0.92 を想定
```

## コンテンツの追加・変更（Table Editor運用）

- トーンの追加: `tones` に insert し、`stimuli` / `hint_words` / `diagnosis_questions` に対応する行を追加
- 画像の追加・差し替え: `stimuli` の `image_url`（`public/stimuli/` のパスまたは https URL）と `is_active` を編集
- 枚数は固定しない（`is_active = true` の画像がフローに登場する）

## スコープ外（意図的に作っていないもの）

- 物理的な座席位置とのひも付け / 段階的開示 / プッシュ通知
- ログイン・認証・決済
- メーカー向け分析ダッシュボード
- 運営用の管理画面（Table Editorで代替）
