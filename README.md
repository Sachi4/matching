# 運命の出会いを科学する

同じ画像を見た者同士の“感じ方の共鳴”を可視化し、会場に即興のつながりを生むツール。
ハッカソン会場（約70名）でのライブ体験用MVP。

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/respond` … トーン（高揚感／悲しみ／怒り）ごとに以下を繰り返すメインフロー
   1. 画像を見る
   2. 感じたことを記録する（トーンごとのヒント語 + ひとこと自由記述）
   3. そのトーンに紐づく診断質問（2問・表出/内省軸）に答える
3. `/feed` … 共鳴の星座 + 集合アート + 共鳴フィード（スマホ用）
4. `/screen` … 会場の大画面用ビュー（集合アートを背景に星座と共鳴フィード）
5. `/admin/test` … 運営用デバッグUI（`test_mode` が有効なときだけ使える）

刺激（画像）・ヒント語・診断質問の追加や変更は、Supabase の Table Editor から
`tones` / `stimuli` / `hint_words` / `diagnosis_questions` を直接編集する運用（管理画面はなし）。

## アーキテクチャ

- フロントエンド: Next.js (App Router) + Tailwind CSS
- バックエンド/DB: Supabase (Postgres + pgvector + Realtime + Edge Functions)
- `tones` をマスタとし、画像・ヒント語・診断質問はすべて `tone_id` で参照する
  （トーンを追加してもコード変更は不要）
- 感想投稿〜マッチングの流れ（非同期）:
  1. 感想入力後、フロントは Edge Function `submit-response` を呼んだだけで即座に次の画面へ進む。
     Edge Function側も感想を先にinsertして即レスポンスを返し、embedding生成と共鳴判定は
     `EdgeRuntime.waitUntil` でバックグラウンド実行する（参加者を待たせない）。
     共鳴が生まれたら `matches` のRealtimeで後から画面に届く
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

### 共鳴の星座（`/feed` ・ `/screen`）

- 自分のドットを中心に固定し、共鳴度が高い人ほど近くに配置する（d3-force の force-directed layout）
- 座標のもとになる類似度は DB関数 `refresh_resonance_graph()` が全員分まとめて計算し、
  `resonance_graph` にキャッシュする。`stimulus_responses` / `diagnosis_answers` / `matches` への
  書き込みごとにトリガで再計算され、フロントはRealtimeでその更新を受け取るだけ（毎フレームの再計算はしない）
- 閾値を超えたペアはオレンジの太い線と反応名で強調される

## テストモード（本番当日の確認にも使える）

`app_settings.test_mode` を 1 にすると有効。操作には合言葉（`debug_config.token`、初期値 `kyomei-debug`）が必要。

### 画面から（`/admin/test`）

1. `/admin/test` を開き、合言葉を入力して test_mode を ON（一度入れればlocalStorageに保存される）
2. **a. 高スコアのペアを投入** … ダミー参加者2人にほぼ同一の感想と同じ診断回答を投入する。
   実際のembedding計算パイプラインを通るため、数秒後に共鳴が成立する
3. **b. 共鳴を直接insert** … 計算を経由せず `matches` にscore/反応名/decisive_toneをinsertする
4. 終わったら「テストデータを削除」でテスト参加者（`participants.is_test`）を一括削除

`test_mode` がONのときだけ `/feed` の下部にデバッグUIへのリンクが出る。

### CLIから

```bash
export NEXT_PUBLIC_SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...

node scripts/test-data.mjs test-mode on
node scripts/test-data.mjs seed-pair --fixture 0        # a) 実パイプラインを通る高スコアペア
node scripts/test-data.mjs force-match --score 0.93 --phrase "しずかな共振"  # b) 直接insert
node scripts/test-data.mjs refresh-graph                # 星座の再計算
node scripts/test-data.mjs cleanup                      # テストデータ削除
node scripts/test-data.mjs test-mode off                # 本番前に必ずOFFに戻す
```

## 調整可能なパラメータ

`app_settings` テーブルをSQLで更新するだけで反映される:

```sql
update app_settings set value = 0.7 where key = 'text_weight';
update app_settings set value = 0.3 where key = 'type_weight';
update app_settings set value = 0.88 where key = 'match_threshold';  -- 厳しめ 0.88〜0.92 を想定
update app_settings set value = 8 where key = 'graph_top_k';         -- 星座の1人あたりのエッジ本数
update app_settings set value = 0 where key = 'test_mode';           -- 本番は0
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
