import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match } from "@/lib/types";

// 共鳴演出に必要な材料（印のseed・2人が選んだヒント語・トーン）をまとめて取る。
// 印のseedは回答IDなので、同じ回答なら毎回同じ印になる。
export type MatchSign = {
  participantId: string;
  nickname: string;
  seed: string;
  hintWords: string[];
};

export type MatchDetail = {
  match: Match;
  toneLabel: string | null;
  signs: [MatchSign, MatchSign];
};

type ResponseRow = {
  id: string;
  participant_id: string;
  stimulus_id: string;
  hint_words_selected: string[] | null;
  created_at: string;
};

export async function loadMatchDetail(
  supabase: SupabaseClient,
  match: Match,
): Promise<MatchDetail> {
  const ids = [match.participant_id_a, match.participant_id_b];

  const [{ data: participants }, { data: tone }, { data: responses }, { data: stimuli }] =
    await Promise.all([
      supabase.from("participants").select("id, nickname").in("id", ids),
      match.decisive_tone_id
        ? supabase
            .from("tones")
            .select("label")
            .eq("id", match.decisive_tone_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("stimulus_responses")
        .select("id, participant_id, stimulus_id, hint_words_selected, created_at")
        .in("participant_id", ids)
        .order("created_at", { ascending: false }),
      match.decisive_tone_id
        ? supabase.from("stimuli").select("id").eq("tone_id", match.decisive_tone_id)
        : Promise.resolve({ data: null }),
    ]);

  const toneStimuli = new Set((stimuli ?? []).map((s) => s.id));
  const rows = (responses ?? []) as ResponseRow[];

  const sign = (participantId: string): MatchSign => {
    const mine = rows.filter((r) => r.participant_id === participantId);
    // 共鳴の決め手になったトーンの回答を優先する（なければ直近の回答）
    const row = mine.find((r) => toneStimuli.has(r.stimulus_id)) ?? mine[0];
    return {
      participantId,
      nickname:
        participants?.find((p) => p.id === participantId)?.nickname ?? "？？？",
      seed: row?.id ?? `${match.id}:${participantId}`,
      hintWords: row?.hint_words_selected ?? [],
    };
  };

  return {
    match,
    toneLabel: (tone as { label: string } | null)?.label ?? null,
    signs: [sign(ids[0]), sign(ids[1])],
  };
}
