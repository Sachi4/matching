"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { tonePalette } from "@/lib/tones";
import type { Match } from "@/lib/types";

type FeedItem = Match & {
  nickname_a: string;
  nickname_b: string;
  tone_label: string | null;
  isNew?: boolean;
};

// レイヤー2: 共鳴度が閾値を超えたペアが即時ポップするフィード
export default function ResonanceFeed({ large }: { large?: boolean }) {
  const [items, setItems] = useState<FeedItem[]>([]);

  const enrich = useCallback(async (match: Match): Promise<FeedItem> => {
    const supabase = getSupabase();
    const ids = [match.participant_id_a, match.participant_id_b];
    const [{ data: participants }, { data: tone }] = await Promise.all([
      supabase.from("participants").select("id, nickname").in("id", ids),
      match.decisive_tone_id
        ? supabase
            .from("tones")
            .select("label")
            .eq("id", match.decisive_tone_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);
    const nickname = (id: string) =>
      participants?.find((p) => p.id === id)?.nickname ?? "？？？";
    return {
      ...match,
      nickname_a: nickname(match.participant_id_a),
      nickname_b: nickname(match.participant_id_b),
      tone_label: tone?.label ?? null,
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      const enriched = await Promise.all((data ?? []).map(enrich));
      if (!cancelled) {
        // 読み込み中にRealtimeで届いたものを消さないよう、idでマージする
        setItems((prev) => {
          const merged = [...prev];
          for (const item of enriched) {
            if (!merged.some((i) => i.id === item.id)) merged.push(item);
          }
          return merged.sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          );
        });
      }
    })();

    const channel = supabase
      .channel("resonance-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches" },
        async (payload) => {
          const item = await enrich(payload.new as Match);
          setItems((prev) =>
            prev.some((i) => i.id === item.id)
              ? prev
              : [{ ...item, isNew: true }, ...prev],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enrich]);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-white/40">
        まだ共鳴はありません。感想が集まると、ここに現れます。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const palette = tonePalette(item.tone_label);
        return (
          <div
            key={item.id}
            className={`rounded-2xl p-[2px] ${item.isNew ? "animate-pop-in" : ""}`}
            style={{
              background: `linear-gradient(120deg, ${palette[0]}, ${palette[1]}, ${palette[2]})`,
            }}
          >
            <div
              className={`rounded-2xl bg-[#16141f]/90 px-5 text-center ${large ? "py-8" : "py-5"}`}
            >
              {item.reaction_phrase && (
                <p className={`font-bold ${large ? "text-3xl" : "text-xl"}`}>
                  「{item.reaction_phrase}」
                </p>
              )}
              <p
                className={`mt-2 text-white/80 ${large ? "text-xl" : "text-sm"}`}
              >
                {item.nickname_a} × {item.nickname_b}
              </p>
              <p className="mt-1 text-xs text-white/40">
                共鳴度 {(Number(item.score) * 100).toFixed(0)}%
                {item.tone_label && ` ・ 決め手は「${item.tone_label}」`}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
