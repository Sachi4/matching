"use client";

import { axisToPercent, type EmotionDefinition } from "@/lib/quest";

export type PlotPoint = {
  label: string;
  x: number;
  y: number;
  color: string;
};

// L2の2軸平面。二人の点の距離がそのまま「感じ方のずれ」の可視化になる
// 0〜100% を 14〜86% に写して、軸ラベルとの衝突とはみ出しを防いでいる
function inset(percent: number): number {
  return 14 + (percent / 100) * 72;
}

export default function QuestAxisPlot({
  emotion,
  points,
}: {
  emotion: EmotionDefinition;
  points: PlotPoint[];
}) {
  return (
    <div className="relative aspect-square w-full rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />

      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/40">
        {emotion.axisX.negative}
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/40">
        {emotion.axisX.positive}
      </span>
      <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] text-white/40">
        {emotion.axisY.positive}
      </span>
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/40">
        {emotion.axisY.negative}
      </span>

      {/* 端の値でも点とラベルが枠にかからないよう、内側に縮めてプロットする */}
      {points.map((p) => (
        <div
          key={p.label}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
          style={{
            left: `${inset(axisToPercent(p.x))}%`,
            top: `${inset(100 - axisToPercent(p.y))}%`,
          }}
        >
          <span
            className="h-3.5 w-3.5 rounded-full ring-2 ring-black/40"
            style={{ backgroundColor: p.color }}
          />
          <span className="whitespace-nowrap text-[10px] text-white/70">
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}
