"use client";

import CollectiveCanvas from "@/components/CollectiveCanvas";
import Constellation from "@/components/Constellation";
import ResonanceFeed from "@/components/ResonanceFeed";

// 会場の大画面用ビュー: 集合アートを背景に、共鳴の星座と共鳴フィードを並べる
export default function ScreenPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0">
        <CollectiveCanvas className="h-full w-full" />
      </div>
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
      </div>
    </main>
  );
}
