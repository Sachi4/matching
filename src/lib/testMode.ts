// テストモード（マイルストーン0）のクライアント側ロジック。
// a) 実際のembedding計算パイプラインを通して高スコアになるペアを作る
// b) 計算を経由せず matches に直接insertする
// のどちらも数十秒以内に共鳴を発生させられるようにするためのもの。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HintWord, Stimulus, Tone } from "@/lib/types";
import fixtures from "@/lib/test-fixtures.json";

export const TEST_FIXTURES = fixtures as {
  pairs: { label: string; freeText: string }[];
  forceMatch: { score: number; phrase: string };
};

const TOKEN_KEY = "kyomei_debug_token";

export function getDebugToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function storeDebugToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function isTestModeEnabled(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "test_mode")
    .maybeSingle();
  return Number(data?.value ?? 0) >= 1;
}

export async function setTestMode(
  supabase: SupabaseClient,
  token: string,
  on: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_test_mode", {
    p_token: token,
    p_on: on,
  });
  if (error) throw error;
  return Boolean(data);
}

// a) 同じ画像にほぼ同一の感想を投入したダミー参加者2人を作る。
//    感想はEdge Function経由なので、実際のembedding計算パイプラインを通る。
export async function seedTestPair(
  supabase: SupabaseClient,
  token: string,
  fixtureIndex = 0,
): Promise<{ nicknames: [string, string]; stimuliCount: number }> {
  const fixture = TEST_FIXTURES.pairs[fixtureIndex] ?? TEST_FIXTURES.pairs[0];
  const suffix = Math.random().toString(36).slice(2, 6);
  const nicknames: [string, string] = [
    `テスト${fixture.label}A-${suffix}`,
    `テスト${fixture.label}B-${suffix}`,
  ];

  const ids: string[] = [];
  for (const nickname of nicknames) {
    const { data, error } = await supabase.rpc("test_create_participant", {
      p_token: token,
      p_nickname: nickname,
    });
    if (error) throw error;
    ids.push(data as string);
  }

  const [{ data: stims }, { data: words }] = await Promise.all([
    supabase.from("stimuli").select("*, tones(*)").eq("is_active", true),
    supabase.from("hint_words").select("*").order("sort_order"),
  ]);

  const stimuli = ((stims ?? []) as (Stimulus & { tones: Tone })[]).sort(
    (a, b) => a.tones.sort_order - b.tones.sort_order,
  );
  const hintWords = (words ?? []) as HintWord[];

  for (const stimulus of stimuli) {
    const toneWords = hintWords
      .filter((w) => w.tone_id === stimulus.tone_id)
      .slice(0, 2)
      .map((w) => w.word);
    for (const id of ids) {
      const { error } = await supabase.functions.invoke("submit-response", {
        body: {
          participant_id: id,
          stimulus_id: stimulus.id,
          free_text: fixture.freeText,
          hint_words_selected: toneWords,
        },
      });
      if (error) throw error;
    }
  }

  return { nicknames, stimuliCount: stimuli.length };
}

// b) matches に直接insertする（フロントの表示とRealtimeだけを切り離してテストする）
export async function forceMatch(
  supabase: SupabaseClient,
  token: string,
  score = TEST_FIXTURES.forceMatch.score,
  phrase = TEST_FIXTURES.forceMatch.phrase,
): Promise<{ nickname_a: string; nickname_b: string; match_id: string }> {
  const { data, error } = await supabase.rpc("test_force_match", {
    p_token: token,
    p_score: score,
    p_phrase: phrase,
  });
  if (error) throw error;
  return data as { nickname_a: string; nickname_b: string; match_id: string };
}

export async function cleanupTestData(
  supabase: SupabaseClient,
  token: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("test_cleanup", {
    p_token: token,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function refreshGraph(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("refresh_resonance_graph");
  if (error) throw error;
}
