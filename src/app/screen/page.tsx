"use client";

import Constellation from "@/components/Constellation";
import ResonanceBurst from "@/components/ResonanceBurst";
import ResonanceFeed from "@/components/ResonanceFeed";

// 会場の大画面用ビュー: 共鳴マップを全幅で主役にし、その下に共鳴カードを並べる。
// 共鳴が生まれた瞬間は画面全体をバースト演出が数秒だけ乗っ取る（音は鳴らさない）。
export default function ScreenPage() {
  return (
    <main className="relative h-screen overflow-hidden bg-[#0b0a11]">
      <div className="relative z-10 flex h-screen flex-col gap-3 px-10 py-5">
        <div className="text-center">
          <p className="text-xs tracking-widest text-violet-300/70">
            運命の出会いを科学する
          </p>
          <h1 className="text-2xl font-bold">共鳴マップ</h1>
        </div>
        {/* 正方形のsvgに高さを決めさせると画面からはみ出すので、
            高さは親のflexで決め、svgは絶対配置で埋める */}
        <div className="relative min-h-0 flex-1 rounded-3xl border border-white/10 bg-black/30">
          <Constellation meId={null} large className="absolute inset-0" />
        </div>
        <div className="shrink-0">
          <p className="mb-1 text-xs text-white/60">生まれた共鳴</p>
          {/* 会場の大画面は誰も横スクロールしないので、一度に入る3枚だけ出す */}
          <ResonanceFeed layout="carousel" limit={3} large />
        </div>
      </div>
      {/* 会場の大画面はページ遷移せず、この画面の共鳴マップをそのままズームさせる */}
      <ResonanceBurst focusPath={null} />
    </main>
  );
}
