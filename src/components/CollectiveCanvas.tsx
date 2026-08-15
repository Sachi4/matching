"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { FALLBACK_PALETTE, tonePalette } from "@/lib/tones";

type ResponseRow = {
  id: string;
  stimulus_id: string;
  hint_words_selected: string[];
};

// 文字列から決定的な乱数列を作る（同じ感想は常に同じ場所・形に描かれる）
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function drawResponse(
  ctx: CanvasRenderingContext2D,
  row: ResponseRow,
  palette: string[],
) {
  const { width, height } = ctx.canvas;
  const rand = seededRandom(row.id);
  const blobCount = Math.max(1, row.hint_words_selected.length);
  const colors = Array.from(
    { length: blobCount },
    (_, i) => palette[i % palette.length],
  );

  for (const color of colors) {
    const cx = rand() * width;
    const cy = rand() * height;
    const r = 30 + rand() * Math.min(width, height) * 0.18;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `${color}59`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;

    // 有機的なブロブ（半径を揺らした閉曲線）
    ctx.beginPath();
    const points = 8;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = 0.7 + rand() * 0.6;
      const x = cx + Math.cos(angle) * r * wobble;
      const y = cy + Math.sin(angle) * r * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.quadraticCurveTo(
        cx + Math.cos(angle - Math.PI / points) * r * 1.1,
        cy + Math.sin(angle - Math.PI / points) * r * 1.1,
        x,
        y,
      );
    }
    ctx.closePath();
    ctx.fill();
  }
}

// レイヤー1: 全参加者の感想から抽出した色（トーンの色）が育っていく1枚のキャンバス。
// 個人を特定できる情報は描画しない（匿名の集合アート）
export default function CollectiveCanvas({
  className,
}: {
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    // サイズ設定でビットマップが消えるため、描画済み記録もリセットする
    drawnIds.current = new Set();

    const supabase = getSupabase();
    // 刺激ID → トーンの色 の対応表を先に作る（Realtimeのpayloadにはトーンが含まれないため）
    const stimulusPalettes = new Map<string, string[]>();

    const drawIfNew = (row: ResponseRow) => {
      if (drawnIds.current.has(row.id)) return;
      drawnIds.current.add(row.id);
      drawResponse(
        ctx,
        row,
        stimulusPalettes.get(row.stimulus_id) ?? FALLBACK_PALETTE,
      );
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: stims } = await supabase
        .from("stimuli")
        .select("id, tones(label)");
      for (const s of stims ?? []) {
        const label = (s.tones as unknown as { label: string } | null)?.label;
        stimulusPalettes.set(s.id, tonePalette(label));
      }

      const { data } = await supabase
        .from("stimulus_responses")
        .select("id, stimulus_id, hint_words_selected")
        .order("created_at");
      if (cancelled) return;
      (data ?? []).forEach(drawIfNew);

      channel = supabase
        .channel("collective-art")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "stimulus_responses" },
          (payload) => drawIfNew(payload.new as ResponseRow),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "h-full w-full"}
      aria-label="みんなの感想から育つ集合アート"
    />
  );
}
