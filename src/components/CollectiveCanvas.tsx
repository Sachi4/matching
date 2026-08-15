"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { TAG_COLOR_MAP } from "@/lib/tags";

type ResponseRow = {
  id: string;
  response_text: string;
  selected_tags: string[];
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

const FALLBACK_COLORS = ["#A78BC9", "#7FB6D9", "#F2A65A", "#9BD4C0"];

function drawResponse(ctx: CanvasRenderingContext2D, row: ResponseRow) {
  const { width, height } = ctx.canvas;
  const rand = seededRandom(row.id);
  const colors =
    row.selected_tags.length > 0
      ? row.selected_tags.map((t) => TAG_COLOR_MAP[t] ?? FALLBACK_COLORS[0])
      : [FALLBACK_COLORS[Math.floor(rand() * FALLBACK_COLORS.length)]];

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

// レイヤー1: 全参加者の感想から抽出した色が育っていく1枚のキャンバス。
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

    const drawIfNew = (row: ResponseRow) => {
      if (drawnIds.current.has(row.id)) return;
      drawnIds.current.add(row.id);
      drawResponse(ctx, row);
    };

    const supabase = getSupabase();
    supabase
      .from("stimulus_responses")
      .select("id, response_text, selected_tags")
      .order("created_at")
      .then(({ data }) => {
        (data ?? []).forEach(drawIfNew);
      });

    const channel = supabase
      .channel("collective-art")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stimulus_responses" },
        (payload) => drawIfNew(payload.new as ResponseRow),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
