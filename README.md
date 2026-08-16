# 運命の出会いを科学する

同じ刺激を見た者同士の“感じ方の共鳴”を可視化し、会場に即興のつながりを生むツール。
ハッカソン会場（約70名）でのライブ体験用MVP。

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/diagnosis` … かんたん感性診断（6問・E/N/I軸・8タイプ）
3. `/respond` … 画像を見て感じたことを記録（形容詞チップ + ひとこと自由記述）
4. `/feed` … 集合アート + 共鳴フィード（スマホ用）
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
supabase secrets set OPENAI_API_KEY=sk-...        # embedding用（任意。未設定でも動く）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # 反応名生成用（任意。未設定でも動く）
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
update app_settings set value = 0.75 where key = 'match_threshold';
```

## 刺激（画像）の追加・削除

- `/admin/stimuli` から追加・表示切替・削除ができる
- 画像は `public/stimuli/` に置いたパス（例 `/stimuli/04.svg`）でも外部URLでもよい
- SQLで直接 `stimuli` テーブルを操作してもよい

## スコープ外（意図的に作っていないもの）

- 物理的な座席位置とのひも付け / 段階的開示 / プッシュ通知
- ログイン・認証・決済
- メーカー向け分析ダッシュボード
