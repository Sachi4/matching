import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match } from "@/lib/types";

// 共鳴演出に必要な材料（2人のニックネームと決め手のトーン）をまとめて取る
export type MatchDetail = {
  match: Match;
  toneLabel: string | null;
  nicknames: [string, string];
};

export async function loadMatchDetail(
  supabase: SupabaseClient,
  match: Match,
): Promise<MatchDetail> {
  const ids = [match.participant_id_a, match.participant_id_b];

  const [{ data: participants }, { data: tone }] = await Promise.all([
    supabase.from("participants").select("id, nickname").in("id", ids),
    match.decisive_tone_id
      ? supabase
          .from("tones")
          .select("label")
          .eq("id", match.decisive_tone_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const nicknameOf = (participantId: string) =>
    participants?.find((p) => p.id === participantId)?.nickname ?? "？？？";

  return {
    match,
    toneLabel: (tone as { label: string } | null)?.label ?? null,
    nicknames: [nicknameOf(ids[0]), nicknameOf(ids[1])],
  };
}
