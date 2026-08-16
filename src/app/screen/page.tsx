"use client";

import Constellation from "@/components/Constellation";
import ResonanceBurst from "@/components/ResonanceBurst";
import ResonanceFeed from "@/components/ResonanceFeed";

// 会場の大画面用ビュー: 共鳴マップを全幅で主役にし、その下に共鳴カードを並べる。
// 共鳴が生まれた瞬間は画面全体をバースト演出が数秒だけ乗っ取る（音は鳴らさない）。
export default function ScreenPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0a11]">
      <div className="relative z-10 flex min-h-screen flex-col gap-6 px-10 py-8">
        <div className="text-center">
          <p className="text-sm tracking-widest text-violet-300/70">
            運命の出会いを科学する
          </p>
          <h1 className="mt-1 text-4xl font-bold">共鳴マップ</h1>
        </div>
        <div className="flex-1 rounded-3xl border border-white/10 bg-black/30">
          <Constellation meId={null} large />
        </div>
        <div>
          <p className="mb-2 text-sm text-white/60">生まれた共鳴</p>
          <ResonanceFeed layout="carousel" limit={5} large />
        </div>
      </div>
      {/* 会場の大画面はページ遷移せず、この画面の共鳴マップをそのままズームさせる */}
      <ResonanceBurst focusPath={null} />
    </main>
  );
}
