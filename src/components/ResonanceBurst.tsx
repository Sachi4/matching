"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconArrowsLeftRight, IconSparkles } from "@tabler/icons-react";
import { getSupabase } from "@/lib/supabase";
import { loadMatchDetail, type MatchDetail } from "@/lib/matchDetail";
import { requestResonanceFocus } from "@/lib/resonanceFocus";
import type { Match } from "@/lib/types";

const DURATION = 5000;
// 会場で共鳴が連続しても演出が延々と積み上がらないように、待ち行列は数件で打ち切る
const MAX_QUEUE = 3;

type Props = {
  /** 指定すると、その人が当事者の共鳴だけを演出する（未指定＝全員ぶん＝会場スクリーン） */
  meId?: string | null;
  /** 演出後に星座UIへ遷移してハイライトするか（会場スクリーンでは遷移しない） */
  focusPath?: string | null;
};

// 共鳴が生まれた瞬間、画面を数秒間だけ占有するバースト演出。
// 演出が終わると星座UIに移り、共鳴した2人のドットにズームする。
export default function ResonanceBurst({ meId, focusPath = "/feed" }: Props) {
  const [queue, setQueue] = useState<MatchDetail[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const current = queue[0] ?? null;

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("resonance-burst")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches" },
        async (payload) => {
          const match = payload.new as Match;
          if (seen.current.has(match.id)) return;
          if (
            meId &&
            match.participant_id_a !== meId &&
            match.participant_id_b !== meId
          ) {
            return;
          }
          seen.current.add(match.id);
          const detail = await loadMatchDetail(supabase, match);
          // あふれた分は古い待ち（表示中の次以降）から捨てて、いま起きた共鳴を優先する
          setQueue((prev) => {
            if (prev.length === 0) return [detail];
            const pending = [...prev.slice(1), detail];
            return [prev[0], ...pending.slice(-(MAX_QUEUE - 1))];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId]);

  const dismiss = useCallback(() => {
    setQueue((prev) => {
      const [shown, ...rest] = prev;
      // 演出のあと、その共鳴が全体のどこで起きたのかを星座UIで見せる
      if (shown) {
        requestResonanceFocus(
          shown.match.participant_id_a,
          shown.match.participant_id_b,
        );
        if (focusPath && rest.length === 0 && pathname !== focusPath) {
          router.push(focusPath);
        }
      }
      return rest;
    });
  }, [focusPath, pathname, router]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(dismiss, DURATION);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  if (!current) return null;
  return <Burst key={current.match.id} detail={current} onClose={dismiss} />;
}

// 演出そのもの。単体でも使える（デバッグUIのプレビューなど）
export function Burst({
  detail,
  onClose,
}: {
  detail: MatchDetail;
  onClose: () => void;
}) {
  const { match, nicknames } = detail;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="共鳴が生まれました"
      className="animate-burst-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-[#16141f] px-6 py-10 text-center">
        <div className="relative flex h-[120px] items-center justify-center">
          <div className="burst-ring absolute h-[100px] w-[100px] rounded-full border-2 border-[#D85A30]" />
          <div
            className="burst-ring absolute h-[100px] w-[100px] rounded-full border-2 border-[#D85A30]"
            style={{ animationDelay: "0.6s" }}
          />
          <IconSparkles size={40} color="#D85A30" aria-hidden />
        </div>
        <p className="reveal-text mt-2 mb-1 text-[13px] text-white/60">
          共鳴が発生しました
        </p>
        <p className="reveal-text mb-3 text-[22px] font-medium text-white">
          {match.reaction_phrase}
        </p>
        <div className="reveal-text inline-flex items-center gap-2 text-sm text-white/60">
          <span>{nicknames[0]}</span>
          <IconArrowsLeftRight size={14} aria-hidden />
          <span>{nicknames[1]}</span>
        </div>
      </div>
    </div>
  );
}
