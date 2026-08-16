"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import { getSupabase } from "@/lib/supabase";
import { loadMatchDetail } from "@/lib/matchDetail";
import { tonePalette } from "@/lib/tones";
import type { Match } from "@/lib/types";

type FeedItem = Match & {
  nicknames: [string, string];
  tone_label: string | null;
  isNew?: boolean;
};

type Props = {
  /** 大画面（/screen）用に文字を大きくする */
  large?: boolean;
  /** carousel = 横スワイプ/横スクロール、list = 縦に並べる */
  layout?: "carousel" | "list";
  /** 表示する最大件数（超えた分は一覧ページで見る） */
  limit?: number;
  /** 自分が含まれる共鳴を先頭に出し、バッジをつける */
  meId?: string | null;
  /** 全件数が limit を超えたときに呼ばれる（一覧への導線の出し分け用） */
  onTotalChange?: (total: number) => void;
};

// 共鳴（閾値を超えたペア）のカード。Realtimeで即時に増える
export default function ResonanceFeed({
  large,
  layout = "list",
  limit,
  meId,
  onTotalChange,
}: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);

  const enrich = useCallback(async (match: Match): Promise<FeedItem> => {
    const detail = await loadMatchDetail(getSupabase(), match);
    return {
      ...match,
      nicknames: detail.nicknames,
      tone_label: detail.toneLabel,
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
        .limit(100);
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
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "matches" },
        (payload) => {
          const removed = payload.old as { id?: string };
          if (!removed.id) return;
          setItems((prev) => prev.filter((i) => i.id !== removed.id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enrich]);

  const isMine = useCallback(
    (item: FeedItem) =>
      !!meId &&
      (item.participant_id_a === meId || item.participant_id_b === meId),
    [meId],
  );

  // 自分の共鳴を先に、それ以外は新しい順
  const ordered = useMemo(() => {
    const byPriority = (a: FeedItem, b: FeedItem) => {
      const mine = Number(isMine(b)) - Number(isMine(a));
      return mine !== 0 ? mine : b.created_at.localeCompare(a.created_at);
    };
    const sorted = [...items].sort(byPriority);
    if (!limit) return sorted;

    // 新しい順に切るだけだと特定の感情の共鳴だけで埋まってしまうので、
    // 感情ごとの列から1件ずつ取っていって枠を埋める
    const groups = new Map<string, FeedItem[]>();
    for (const item of sorted) {
      const key = item.tone_label ?? "";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const columns = [...groups.values()];
    const picked: FeedItem[] = [];
    for (let i = 0; picked.length < limit; i++) {
      if (!columns.some((c) => c.length > i)) break;
      for (const column of columns) {
        if (column[i] && picked.length < limit) picked.push(column[i]);
      }
    }
    // 並べ直さない: 取った順（感情が交互）のままにして、先頭から見ても感情が混ざるようにする
    return picked;
  }, [items, isMine, limit]);

  useEffect(() => {
    onTotalChange?.(items.length);
  }, [items.length, onTotalChange]);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-white/40">
        まだ共鳴はありません。感想が集まると、ここに現れます。
      </p>
    );
  }

  const carousel = layout === "carousel";

  return (
    <div
      className={
        carousel
          ? "-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2"
          : "flex flex-col gap-4"
      }
    >
      {ordered.map((item) => {
        const palette = tonePalette(item.tone_label);
        const mine = isMine(item);
        return (
          <div
            key={item.id}
            className={`rounded-2xl p-[2px] ${item.isNew ? "animate-pop-in" : ""} ${
              carousel
                ? `shrink-0 snap-center ${large ? "w-[30%]" : "w-[85%]"}`
                : ""
            }`}
            style={{
              background: `linear-gradient(120deg, ${palette[0]}, ${palette[1]}, ${palette[2]})`,
            }}
          >
            <div
              className={`h-full rounded-2xl bg-[#16141f]/90 px-5 text-center ${large ? "py-4" : "py-5"}`}
            >
              {mine && (
                <p className="mb-1 text-[10px] tracking-widest text-white/50">
                  あなたの共鳴
                </p>
              )}

              {/* いちばん伝えたいのは共鳴の強さなので、数値を主役にする */}
              <p className="text-5xl font-bold tracking-tight text-white">
                {(Number(item.score) * 100).toFixed(0)}
                <span
                  className={`ml-1 font-medium text-white/50 ${
                    large ? "text-xl" : "text-lg"
                  }`}
                >
                  %
                </span>
              </p>
              <p
                className={`mt-0.5 tracking-widest text-white/40 ${large ? "text-xs" : "text-[10px]"}`}
              >
                共鳴度
              </p>

              <div
                className="mt-2 inline-flex items-center gap-2 text-base text-white/70"
              >
                <span>{item.nicknames[0]}</span>
                <IconArrowsLeftRight size={14} aria-hidden />
                <span>{item.nicknames[1]}</span>
              </div>

              {item.reaction_phrase && (
                <p
                  className={`mt-1 text-white/40 ${large ? "text-xs" : "text-[11px]"}`}
                >
                  {item.reaction_phrase}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
