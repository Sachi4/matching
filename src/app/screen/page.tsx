"use client";

import Link from "next/link";
import Constellation from "@/components/Constellation";
import ResonanceBurst from "@/components/ResonanceBurst";
import ResonanceFeed from "@/components/ResonanceFeed";

// 会場の大画面用ビュー: 共鳴の星座を主役に、右に共鳴カードを並べる。
// 共鳴が生まれた瞬間は画面全体をバースト演出が数秒だけ乗っ取る（音は鳴らさない）。
export default function ScreenPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0a11]">
      <div className="relative z-10 flex min-h-screen flex-col gap-6 px-10 py-8">
        <div className="text-center">
          <p className="text-sm tracking-widest text-violet-300/70">
            運命の出会いを科学する
          </p>
          <h1 className="mt-1 text-4xl font-bold">共鳴の星座</h1>
        </div>
        <div className="grid flex-1 grid-cols-[3fr_2fr] gap-8">
          <div className="rounded-3xl border border-white/10 bg-black/30">
            <Constellation meId={null} large />
          </div>
          <div className="overflow-auto">
            <ResonanceFeed large />
          </div>
        </div>
        <Link
          href="/screen/mosaic"
          className="text-center text-xs text-white/30 underline underline-offset-4"
        >
          モザイクウォールに切り替える
        </Link>
      </div>
      <ResonanceBurst haptics={false} />
    </main>
  );
}
