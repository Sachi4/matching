"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getStoredParticipant } from "@/lib/participant";
import { SENSE_TYPES } from "@/lib/diagnosis";
import type { Match } from "@/lib/types";

type FeedItem = Match & {
  nickname_a: string;
  nickname_b: string;
  palette_a: string[];
  palette_b: string[];
  isNew?: boolean;
};

// レイヤー2: 共鳴度が閾値を超えたペアが即時ポップするフィード
export default function ResonanceFeed({ large }: { large?: boolean }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  // 自分が当事者の共鳴にだけ、探索フェーズへの入口を出す
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    setMe(getStoredParticipant()?.id ?? null);
  }, []);

  const enrich = useCallback(async (match: Match): Promise<FeedItem> => {
    const supabase = getSupabase();
    const ids = [match.participant_id_a, match.participant_id_b];
    const [{ data: participants }, { data: diagnoses }] = await Promise.all([
      supabase.from("participants").select("id, nickname").in("id", ids),
      supabase
        .from("diagnosis_scores")
        .select("participant_id, type_key")
        .in("participant_id", ids)
        .order("created_at", { ascending: false }),
    ]);
    const nickname = (id: string) =>
      participants?.find((p) => p.id === id)?.nickname ?? "？？？";
    const palette = (id: string) => {
      const key = diagnoses?.find((d) => d.participant_id === id)?.type_key;
      return key && SENSE_TYPES[key]
        ? SENSE_TYPES[key].palette
        : ["#A78BC9", "#7FB6D9", "#F5D5C8"];
    };
    return {
      ...match,
      nickname_a: nickname(match.participant_id_a),
      nickname_b: nickname(match.participant_id_b),
      palette_a: palette(match.participant_id_a),
      palette_b: palette(match.participant_id_b),
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
      if (!cancelled) setItems(enriched);
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
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-2xl p-[2px] ${item.isNew ? "animate-pop-in" : ""}`}
          style={{
            background: `linear-gradient(120deg, ${item.palette_a[0]}, ${item.palette_a[1]}, ${item.palette_b[1]}, ${item.palette_b[0]})`,
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
            </p>
            {!large &&
              me &&
              (me === item.participant_id_a || me === item.participant_id_b) && (
                <Link
                  href={`/quest/${item.id}`}
                  className="mt-3 inline-block rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/80"
                >
                  この感情を探索する →
                </Link>
              )}
          </div>
        </div>
      ))}
    </div>
  );
}
