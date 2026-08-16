# 運命の出会いを科学する

同じ画像を見た者同士の“感じ方の共鳴”を可視化し、会場に即興のつながりを生むツール。
ハッカソン会場（約70名）でのライブ体験用MVP。

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/respond` … トーン（高揚感／悲しみ／怒り）ごとに以下を繰り返すメインフロー
   1. 画像を見る
   2. 感じたことを記録する（トーンごとのヒント語 + ひとこと自由記述）
   （送信したら即座に次の画像へ進む）
3. `/feed` … 共鳴カード（上部に横スワイプで5件まで） + 共鳴マップ
   - `/matches` … 5件に収まらない共鳴の一覧
4. `/screen` … 会場の大画面用ビュー（共鳴マップと共鳴カード）
5. `/admin/test` … 運営用デバッグUI（`test_mode` が有効なときだけ使える）

刺激（画像）・ヒント語の追加や変更は、Supabase の Table Editor から
`tones` / `stimuli` / `hint_words` を直接編集する運用（管理画面はなし）。
診断質問（`diagnosis_questions` / `diagnosis_answers`）は体験フローから外したので、
テーブルは残っているがどこからも使っていない。

## アーキテクチャ

- フロントエンド: Next.js (App Router) + Tailwind CSS
- バックエンド/DB: Supabase (Postgres + pgvector + Realtime + Edge Functions)
- `tones` をマスタとし、画像・ヒント語はすべて `tone_id` で参照する
  （トーンを追加してもコード変更は不要）
- 感想投稿〜マッチングの流れ（非同期）:
  1. 感想入力後、フロントは Edge Function `submit-response` を呼んだだけで即座に次の画面へ進む。
     Edge Function側も感想を先にinsertして即レスポンスを返し、embedding生成と共鳴判定は
     `EdgeRuntime.waitUntil` でバックグラウンド実行する（参加者を待たせない）。
     共鳴が生まれたら `matches` のRealtimeで後から画面に届く
     （embeddingは Gemini `gemini-embedding-2` のマルチモーダル。
     感想文だけでなく、その感想が向けられた刺激画像も同じベクトルに含めるので
     「どの画像に対してどう感じたか」で共鳴を測れる。
     `GEMINI_API_KEY` 未設定時は OpenAI `text-embedding-3-small`（テキストのみ）、
     どちらも無ければ簡易フォールバック）
  2. embeddingが埋まった直後に Edge Function `check-resonance` がバックグラウンドで走る
  3. DB関数 `find_resonance_candidates` が他参加者との共鳴度を計算
     - `共鳴度 = 感想文embeddingの類似度`（同じ刺激に両者が回答したペアのコサイン類似度の平均）
     - 閾値は `app_settings.match_threshold` で調整可能（初期値 0.55）
  4. 閾値を超えたペアを `matches` に insert。感想文の類似度が最も高かったトーンを
     `decisive_tone_id` として記録し、そのトーンの感想文から Claude API で「反応名」（詩的な短句）を生成
- フロントは Supabase Realtime（`postgres_changes`）で `matches` / `stimulus_responses` の insert を購読し、
  共鳴カードと共鳴マップを即時更新し、共鳴の瞬間はバースト演出を出す

## セットアップ

### 1. Supabase プロジェクト

```bash
npm i -g supabase   # または npx supabase
supabase link --project-ref <your-project-ref>
supabase db push                       # マイグレーション適用
psql "$DATABASE_URL" -f supabase/seed.sql   # トーン・画像・ヒント語を投入（SQL Editorに貼り付けでも可）
```

### 2. Edge Functions

```bash
supabase functions deploy submit-response
supabase functions deploy check-resonance
supabase functions deploy reembed-responses
supabase secrets set GEMINI_API_KEY=...           # embedding用（画像＋テキスト。未設定でも動く）
supabase secrets set PUBLIC_SITE_URL=https://...  # 刺激画像の取得元（未設定ならテキストのみ）
supabase secrets set OPENAI_API_KEY=sk-...        # Gemini未設定時の代替（任意）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... # 反応名生成用（任意。未設定でも動く）
supabase secrets set ALLOWED_ORIGIN=https://...   # 本番のフロントのオリジン（任意。未設定は*）
```

### 3. フロントエンド

```bash
cp .env.example .env.local   # URLとanonキーを記入
npm install
npm run dev
```

### 共鳴カード（`/feed` ・ `/matches` ・ `/screen`）

- 重要度の順に大きさを決めている: 共鳴度の数値（最大）＞ 2人のニックネーム ＞ 反応名（最小）
- 反応名（「色が薄れと遠い記憶」のような詩的な短句）は解釈が要る抽象表現なので、
  カードでは補足として小さく添える
- カードの縁のグラデーションは `decisive_tone_id` の色（ラベルとしては出さない）

### 共鳴マップ（`/feed` ・ `/screen`）

- 高揚感・悲しみ・怒りの3感情を大きなハブとして三角に置き、参加者はその重心に配置する
  （Flourish の Premier league managers and clubs と同じ構造。クラブ＝感情、監督＝参加者）
- 参加者の感情寄り（`tone_weights`）は「そのトーンの刺激で他の人とどれだけ響き合ったか」から作る
  1. 参加者×トーンごとに、同じ刺激に答えた他の人との embedding 類似度の平均を出す
  2. トーン全体の平均との差をとる（画像ごとに類似度の水準が違うため、生の値では全員が同じ感情に寄る）
  3. 参加者内でsoftmax（`app_settings.tone_map_temperature`）して合計1に正規化する
- 強く寄っている感情があればそのハブの近くに、まんべんなく響く人は中央に集まる
- 参加者からハブへの線は寄りの強さで濃さが変わり、共鳴が成立したペアはオレンジの太い線でつながる
- 座標のもとになる類似度は DB関数 `refresh_resonance_graph()` が全員分まとめて計算し、
  `resonance_graph` にキャッシュする。`stimulus_responses` / `matches` への
  書き込みごとにトリガで再計算され、フロントはRealtimeでその更新を受け取るだけ（毎フレームの再計算はしない）
- 閾値を超えたペアはオレンジの太い線で強調される（反応名はマップには出さず、カード側だけ）
- `/screen` はマップを全幅で上に、共鳴カードをその下に横一列で並べる

### 共鳴の瞬間の演出

- `ResonanceBurst`（`/respond` `/feed` `/screen` `/admin/test`）が `matches` の insert を購読し、
  画面中央にバースト演出（広がる2重の輪 + キラキラアイコン + 反応名 + 2人のニックネーム）を
  5秒間出す。タップでも閉じる
- バーストが終わると共鳴マップに戻り、共鳴した2人のドットを数秒間だけズームして強調する
  （`src/lib/resonanceFocus.ts` を介して `Constellation` に伝える）
- 会場の大画面（`/screen`）は音も動画もなし
- `prefers-reduced-motion` が有効な環境ではアニメーションを省く

## テストモード（本番当日の確認にも使える）

`app_settings.test_mode` を 1 にすると有効。操作には合言葉（`debug_config.token`、初期値 `kyomei-debug`）が必要。

### 画面から（`/admin/test`）

1. `/admin/test` を開き、合言葉を入力して test_mode を ON（一度入れればlocalStorageに保存される）
2. **a. 高スコアのペアを投入** … ダミー参加者2人にほぼ同一の感想を投入する。
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
node scripts/test-data.mjs refresh-graph                # 共鳴マップの再計算
node scripts/test-data.mjs reembed                      # embeddingを全件作り直す
node scripts/test-data.mjs similarity-stats             # 閾値調整用の類似度分布
node scripts/test-data.mjs cleanup                      # テストデータ削除
node scripts/test-data.mjs test-mode off                # 本番前に必ずOFFに戻す
```

embeddingモデル（`GEMINI_API_KEY` の有無など）を切り替えたときは、古いベクトルと新しいベクトルが
同じ空間に無く共鳴度が意味を成さなくなるため、`reembed` で既存の感想を全件作り直すこと。

## 調整可能なパラメータ

`app_settings` テーブルをSQLで更新するだけで反映される:

```sql
update app_settings set value = 0.6 where key = 'match_threshold';  -- embedding類似度そのもの（初期値 0.55）
update app_settings set value = 8 where key = 'graph_top_k';         -- 共鳴マップの1人あたりのエッジ本数
update app_settings set value = 12 where key = 'tone_map_temperature'; -- 感情寄りの尖り（大きいほど特定の感情に寄る）
update app_settings set value = 0 where key = 'test_mode';           -- 本番は0
```

## コンテンツの追加・変更（Table Editor運用）

- トーンの追加: `tones` に insert し、`stimuli` / `hint_words` に対応する行を追加
- 画像の追加・差し替え: `stimuli` の `image_url`（`public/stimuli/` のパスまたは https URL）と `is_active` を編集
- 枚数は固定しない（`is_active = true` の画像がフローに登場する）

## スコープ外（意図的に作っていないもの）

- 物理的な座席位置とのひも付け / 段階的開示 / プッシュ通知
- ログイン・認証・決済
- メーカー向け分析ダッシュボード
- 運営用の管理画面（Table Editorで代替）
