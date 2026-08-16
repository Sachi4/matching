# 運命の出会いを科学する

> 同じものを見て、同じように心が動いた。
> その偶然を、会場でその場で見つけられるようにする。

イベント会場で同じ刺激（画像）を見た参加者の「感じ方」を比べ、**共鳴**が起きたペアを
リアルタイムに可視化するツール。ハッカソン会場（約70名）でのライブ体験用MVP。

## コンセプト

### 解きたいこと

大人数の会場で「話が合う人」に出会えるかは、ほぼ席順と度胸で決まる。
プロフィール（所属・職種・趣味）で人をつなぐ既存のマッチングは、
**属性が似ている人**を見つけられても、**感じ方が似ている人**は見つけられない。

そこでこの体験では、自己紹介ではなく「同じ画像を見たときの反応」を手がかりにする。
肩書きを知らないまま、感性の近さだけで相手が浮かび上がる状態をつくる。

### 3つの考え方

1. **共通の刺激から始める** — 質問に答えるのではなく、全員が同じ画像を見る。
   同じ入力に対する反応の差分だから、比較に意味が出る。
2. **感じ方を数値にする** — 自由記述の感想を embedding に、感性診断を3軸スコアに変換し、
   「共鳴度」というひとつの数字にまとめる（[共鳴のしくみ](#共鳴のしくみ)）。
3. **会場に還す** — 数値は本人に返すのではなく、大画面の集合アートと共鳴フィードに流す。
   自分のペアが名前つきで会場に映ることが、話しかけるきっかけになる。

### 大切にした設計判断

- **認証なし・ニックネームのみ** — 参加の摩擦をゼロにする。データはイベント限りの使い捨て。
- **相性の点数は出さない** — 「あなたと◯◯さんは82%」ではなく、
  ペアごとに生成される詩的な**反応名**（例:「とけていく夕暮れ」）だけを見せる。
  評価ではなく話の入口を渡すため。
- **AIキーなしでも動く** — embedding も反応名生成もフォールバック実装があり、
  会場のネットワークやAPI障害で体験が止まらない（[フォールバック](#aiキーなしでの動作)）。
- **チューニングはSQLだけで完結** — 会場の熱量を見ながら、共鳴の閾値をその場で緩められる。

### 用語

| 用語 | 意味 |
| --- | --- |
| 刺激 (stimulus) | 全員に見せる画像。会場で順番に切り替える |
| 感想 (response) | 形容詞チップ + ひとこと自由記述 |
| 感性タイプ | 6問の診断から決まるE/N/I軸の8タイプ（例: プリズムミスト） |
| 共鳴度 (resonance) | 2人の感想の近さを表すスコア（0〜1） |
| 反応名 | 共鳴したペアに与えられる詩的な短句。Claudeが生成 |
| 集合アート | 全員の感想を色の粒として描く、会場全体の状態の可視化 |
| 共鳴フィード | 成立したペアが流れていくライブなタイムライン |

## 体験フロー

1. `/` … ニックネーム登録（認証なし）
2. `/diagnosis` … かんたん感性診断（6問・E/N/I軸・8タイプ）
3. `/respond` … 画像を見て感じたことを記録（形容詞チップ + ひとこと自由記述）
4. `/feed` … 集合アート + 共鳴フィード（スマホ用）
5. `/screen` … 会場の大画面用ビュー（集合アートを背景に共鳴フィードを重ねる）
6. `/admin/stimuli` … 運営用: 刺激画像の追加・表示切替・削除

## 感性診断の3軸

| 軸 | + 方向 | − 方向 |
| --- | --- | --- |
| E | ひらく（感じたことが外へ向かう） | たたずむ（内に留めて味わう） |
| N | ゆらぎ（細部・気配に反応する） | かたち（全体の構図・強さに反応する） |
| I | ひらめき（直感で受け取る） | ふかよみ（意味を考えて受け取る） |

6問の重みづけ合計の符号で8タイプ（`OYH` … `CKF`）が決まる。実装は `src/lib/diagnosis.ts`。

## アーキテクチャ

- フロントエンド: Next.js (App Router) + Tailwind CSS
- バックエンド/DB: Supabase (Postgres + pgvector + Realtime + Edge Functions)
- 感想投稿の流れ:
  1. フロントが Edge Function `submit-response` を呼ぶ
  2. Edge Function が感想文の embedding を生成（OpenAI `text-embedding-3-small`。キー未設定時は簡易フォールバック）
  3. `stimulus_responses` に insert
  4. DB関数 `find_resonance_candidates` が同じ画像を見た他参加者との共鳴度を計算
  5. 閾値を超えたペアを `matches` に insert し、Claude API で「反応名」（詩的な短句）を生成
- フロントは Supabase Realtime（`postgres_changes`）で `matches` / `stimulus_responses` の insert を購読し、
  共鳴フィードと集合アートを即時更新する

### 共鳴のしくみ

```
共鳴度 = text_weight × コサイン類似度(感想文の embedding)
       + type_weight × 診断タイプの近さ(E/N/I軸の距離)

共鳴度 ≥ match_threshold → ペア成立 → 反応名を生成 → フィードへ
```

係数・閾値は `app_settings` テーブルで調整可能（初期値 0.6 / 0.4 / 0.8）。

### AIキーなしでの動作

| 機能 | キーあり | キーなし |
| --- | --- | --- |
| embedding | OpenAI `text-embedding-3-small` | 文字bigramハッシュによる決定的な擬似embedding |
| 反応名 | Claude (`claude-3-5-haiku`) | 2つの感想の断片を組み合わせた短句 |

どちらも体験は成立するが、共鳴の質は落ちる。本番はキーを設定すること。

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

## 運営当日の流れ

1. 開場前に `/admin/stimuli` で使う刺激を登録する（`/respond` には表示ONの刺激が並ぶ）
2. 会場の大画面に `/screen` を出しておく
3. 参加者はスマホで `/` → `/diagnosis` → `/respond`
4. フィードの流れが鈍いときは `match_threshold` を下げる（下記）
5. 進行に合わせて `/admin/stimuli` で表示ON/OFFを切り替える

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
