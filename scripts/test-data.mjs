#!/usr/bin/env node
// テストモード用CLI（デバッグUIと同じ操作をコマンドから行う）
//
//   node scripts/test-data.mjs test-mode on|off
//   node scripts/test-data.mjs seed-pair [--fixture 0]   # 実パイプラインを通る高スコアペア
//   node scripts/test-data.mjs force-match [--score 0.93] [--phrase 言葉]
//   node scripts/test-data.mjs refresh-graph
//   node scripts/test-data.mjs cleanup
//
// 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// （supabase-jsはNode20でRealtimeのWebSocketを要求するため、ここではREST/fetchで呼ぶ）
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください",
  );
  process.exit(1);
}

const fixtures = JSON.parse(
  readFileSync(new URL("../src/lib/test-fixtures.json", import.meta.url)),
);

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const select = (table, query = "") =>
  request(`/rest/v1/${table}?${query}`);
const rpc = (name, args = {}) =>
  request(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
const invoke = (fn, body) =>
  request(`/functions/v1/${fn}`, { method: "POST", body: JSON.stringify(body) });

const debugToken = async () =>
  (await select("debug_config", "id=eq.1&select=token"))[0].token;

const [command, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1];
}

async function seedPair(fixtureIndex) {
  const token = await debugToken();
  const fixture = fixtures.pairs[fixtureIndex] ?? fixtures.pairs[0];
  const suffix = Math.random().toString(36).slice(2, 6);
  const nicknames = [
    `テスト${fixture.label}A-${suffix}`,
    `テスト${fixture.label}B-${suffix}`,
  ];
  const ids = [];
  for (const nickname of nicknames) {
    ids.push(
      await rpc("test_create_participant", {
        p_token: token,
        p_nickname: nickname,
      }),
    );
  }

  const [stimuli, words] = await Promise.all([
    select("stimuli", "is_active=eq.true&select=*,tones(*)"),
    select("hint_words", "select=*&order=sort_order"),
  ]);
  stimuli.sort((a, b) => a.tones.sort_order - b.tones.sort_order);

  for (const stimulus of stimuli) {
    const toneWords = words
      .filter((w) => w.tone_id === stimulus.tone_id)
      .slice(0, 2)
      .map((w) => w.word);
    for (const id of ids) {
      await invoke("submit-response", {
        participant_id: id,
        stimulus_id: stimulus.id,
        free_text: fixture.freeText,
        hint_words_selected: toneWords,
      });
    }
  }
  console.log(
    `テストペアを投入しました: ${nicknames.join(" / ")}（画像 ${stimuli.length} 枚）`,
  );
  console.log("embedding生成後にバックグラウンドで共鳴判定が走ります（数秒）");
}

try {
  switch (command) {
    case "test-mode": {
      const on = rest[0] === "on";
      await rpc("set_test_mode", { p_token: await debugToken(), p_on: on });
      console.log(`test_mode = ${on ? "on" : "off"}`);
      break;
    }
    case "seed-pair":
      await seedPair(Number(flags.fixture ?? 0));
      break;
    case "force-match": {
      const result = await rpc("test_force_match", {
        p_token: await debugToken(),
        p_score: Number(flags.score ?? fixtures.forceMatch.score),
        p_phrase: flags.phrase ?? fixtures.forceMatch.phrase,
      });
      console.log("matchesに直接insertしました:", result);
      break;
    }
    case "refresh-graph":
      await rpc("refresh_resonance_graph");
      console.log("共鳴グラフを再計算しました");
      break;
    case "cleanup": {
      const removed = await rpc("test_cleanup", {
        p_token: await debugToken(),
      });
      console.log(`テスト参加者を${removed}件削除しました`);
      break;
    }
    default:
      console.error(
        "使い方: node scripts/test-data.mjs <test-mode|seed-pair|force-match|refresh-graph|cleanup>",
      );
      process.exit(1);
  }
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
