"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sigil from "@/components/Sigil";
import { getSupabase } from "@/lib/supabase";
import { loadMatchDetail, type MatchDetail } from "@/lib/matchDetail";
import { seededRandom } from "@/lib/sigil";
import { tonePalette } from "@/lib/tones";
import type { Match } from "@/lib/types";

const DURATION = 6000;
const VIBRATION = [40, 60, 40, 60, 90];

type Props = {
  /** 指定すると、その人が当事者の共鳴だけを演出する（未指定＝全員ぶん＝会場スクリーン） */
  meId?: string | null;
  /** 会場スクリーンでは振動させない */
  haptics?: boolean;
};

// 共鳴が生まれた瞬間、画面を数秒間だけ乗っ取るバースト演出。
// 主役は2人の「印」とヒント語で、生成AIの反応名は添え物として小さく出す。
export default function ResonanceBurst({ meId, haptics = true }: Props) {
  const [queue, setQueue] = useState<MatchDetail[]>([]);
  const seen = useRef<Set<string>>(new Set());
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
          setQueue((prev) => [...prev, detail]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meId]);

  const dismiss = useCallback(() => setQueue((prev) => prev.slice(1)), []);

  useEffect(() => {
    if (!current) return;
    if (haptics && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(VIBRATION);
    }
    const timer = setTimeout(dismiss, DURATION);
    return () => clearTimeout(timer);
  }, [current, haptics, dismiss]);

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
  const { match, toneLabel, signs } = detail;
  const palette = tonePalette(toneLabel);
  const rand = seededRandom(match.id);
  const particles = Array.from({ length: 28 }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const dist = 90 + rand() * 220;
    return {
      key: i,
      dx: `${(Math.cos(angle) * dist).toFixed(0)}px`,
      dy: `${(Math.sin(angle) * dist).toFixed(0)}px`,
      size: 3 + Math.round(rand() * 6),
      color: palette[i % palette.length],
      delay: `${(rand() * 0.5).toFixed(2)}s`,
    };
  });

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="共鳴が生まれました"
      className="animate-burst-backdrop fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
    >
      <p className="text-xs tracking-[0.4em] text-white/60">共鳴</p>

      <div className="relative mt-4 flex h-64 w-full max-w-lg items-center justify-center">
        {[0, 0.6, 1.2].map((delay) => (
          <span
            key={delay}
            style={{
              animationDelay: `${delay}s`,
              borderColor: palette[0],
            }}
            className="animate-burst-ring absolute h-52 w-52 rounded-full border-2"
          />
        ))}

        {particles.map((p) => (
          <span
            key={p.key}
            style={
              {
                "--dx": p.dx,
                "--dy": p.dy,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                animationDelay: p.delay,
              } as React.CSSProperties
            }
            className="animate-burst-particle absolute rounded-full"
          />
        ))}

        <div className="animate-sigil-left absolute h-44 w-44 mix-blend-screen">
          <Sigil seed={signs[0].seed} toneLabel={toneLabel} glow />
        </div>
        <div className="animate-sigil-right absolute h-44 w-44 mix-blend-screen">
          <Sigil seed={signs[1].seed} toneLabel={toneLabel} glow />
        </div>
      </div>

      <div className="animate-burst-caption mt-2 w-full max-w-lg text-center">
        <div className="flex flex-col items-center gap-1">
          {signs.map((s) => (
            <p key={s.participantId} className="text-base text-white/85">
              <span className="font-bold">{s.nickname}</span>
              {s.hintWords.length > 0 && (
                <span className="text-white/60">
                  {" "}
                  — {s.hintWords.join("・")}
                </span>
              )}
            </p>
          ))}
        </div>
        {match.reaction_phrase && (
          <p className="mt-3 text-[11px] text-white/40">
            「{match.reaction_phrase}」
          </p>
        )}
        <p className="mt-4 text-[11px] text-white/30">タップで閉じる</p>
      </div>
    </div>
  );
}
