"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ResonanceBurst from "@/components/ResonanceBurst";
import { getSupabase } from "@/lib/supabase";
import {
  TEST_FIXTURES,
  cleanupTestData,
  forceMatch,
  getDebugToken,
  isTestModeEnabled,
  refreshGraph,
  seedTestPair,
  setTestMode,
  storeDebugToken,
} from "@/lib/testMode";

// 本番当日の最終確認にも使う運営用デバッグUI。
// app_settings.test_mode が有効なときだけ操作でき、合言葉（debug_config.token）が必要。
export default function TestModePage() {
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [fixtureIndex, setFixtureIndex] = useState(0);
  const [score, setScore] = useState(String(TEST_FIXTURES.forceMatch.score));
  const [phrase, setPhrase] = useState(TEST_FIXTURES.forceMatch.phrase);

  useEffect(() => {
    setToken(getDebugToken());
    isTestModeEnabled(getSupabase()).then(setEnabled);
  }, []);

  const push = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    push(`${label}...`);
    try {
      push(await fn());
    } catch (e) {
      push(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveToken = (value: string) => {
    setToken(value);
    storeDebugToken(value);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">テストモード</h1>
        <Link
          href="/feed"
          className="text-sm text-white/50 underline underline-offset-4"
        >
          共鳴フィードへ
        </Link>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
        <label className="text-sm text-white/60">合言葉</label>
        <input
          type="password"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="debug_config.token"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 outline-none focus:border-violet-400"
        />
        <div className="flex items-center justify-between">
          <span className="text-sm">
            test_mode:{" "}
            <b className={enabled ? "text-emerald-400" : "text-white/50"}>
              {enabled === null ? "確認中" : enabled ? "ON" : "OFF"}
            </b>
          </span>
          <button
            disabled={busy || !token}
            onClick={() =>
              run(enabled ? "テストモードをOFFに" : "テストモードをONに", async () => {
                const next = await setTestMode(getSupabase(), token, !enabled);
                setEnabled(next);
                return `test_mode = ${next ? "ON" : "OFF"}`;
              })
            }
            className="rounded-xl border border-white/20 px-4 py-2 text-sm disabled:opacity-40"
          >
            切り替える
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
        <div>
          <p className="font-bold">a. 高スコアのペアを投入</p>
          <p className="text-xs text-white/50">
            ダミー参加者2人に、ほぼ同一の感想を投入します。
            実際のembedding計算パイプラインを通るため、数秒後に共鳴が成立します。
          </p>
        </div>
        <select
          value={fixtureIndex}
          onChange={(e) => setFixtureIndex(Number(e.target.value))}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2"
        >
          {TEST_FIXTURES.pairs.map((p, i) => (
            <option key={p.label} value={i} className="bg-[#16141f]">
              {p.label}：{p.freeText.slice(0, 14)}...
            </option>
          ))}
        </select>
        <button
          disabled={busy || !enabled || !token}
          onClick={() =>
            run("ペアを投入", async () => {
              const r = await seedTestPair(getSupabase(), token, fixtureIndex);
              return `${r.nicknames.join(" / ")} に画像${r.stimuliCount}枚ぶんの感想を投入しました（共鳴判定はバックグラウンド）`;
            })
          }
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 font-bold disabled:opacity-40"
        >
          ペアを投入する
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
        <div>
          <p className="font-bold">b. 共鳴を直接insert</p>
          <p className="text-xs text-white/50">
            計算ロジックを経由せず matches に直接insertします。
            共鳴フィードの表示とRealtime反映だけを切り離して確認できます
            （感想がないダミーなので、星座には星は増えません）。
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-24 rounded-xl border border-white/15 bg-white/5 px-3 py-2"
            aria-label="共鳴度"
          />
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2"
            aria-label="反応名"
          />
        </div>
        <button
          disabled={busy || !enabled || !token}
          onClick={() =>
            run("共鳴を直接insert", async () => {
              const r = await forceMatch(
                getSupabase(),
                token,
                Number(score),
                phrase,
              );
              return `${r.nickname_a} × ${r.nickname_b} の共鳴をinsertしました`;
            })
          }
          className="rounded-xl bg-gradient-to-r from-amber-500 to-rose-400 px-4 py-3 font-bold disabled:opacity-40"
        >
          共鳴を発生させる
        </button>
      </section>

      <section className="flex gap-2">
        <button
          disabled={busy}
          onClick={() =>
            run("星座を再計算", async () => {
              await refreshGraph(getSupabase());
              return "共鳴グラフを再計算しました";
            })
          }
          className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm disabled:opacity-40"
        >
          星座を再計算
        </button>
        <button
          disabled={busy || !token}
          onClick={() =>
            run("テストデータを削除", async () => {
              const removed = await cleanupTestData(getSupabase(), token);
              return `テスト参加者を${removed}件削除しました`;
            })
          }
          className="flex-1 rounded-xl border border-rose-400/40 px-4 py-3 text-sm text-rose-300 disabled:opacity-40"
        >
          テストデータを削除
        </button>
      </section>

      <section>
        <p className="mb-2 text-sm text-white/60">実行ログ</p>
        <div className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-white/70">
          {log.length === 0 ? (
            <p className="text-white/30">まだ操作していません</p>
          ) : (
            log.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {line}
              </p>
            ))
          )}
        </div>
      </section>

      {/* この画面でもバースト演出を確認できるようにしておく（当日のリハーサル用） */}
      <ResonanceBurst />
    </main>
  );
}
