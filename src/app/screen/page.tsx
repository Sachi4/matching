"use client";

import CollectiveCanvas from "@/components/CollectiveCanvas";
import ResonanceFeed from "@/components/ResonanceFeed";

// 会場の大画面用ビュー: 集合アートを背景いっぱいに、共鳴フィードを重ねて表示する
export default function ScreenPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0">
        <CollectiveCanvas className="h-full w-full" />
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-8 py-12">
        <div className="text-center">
          <p className="text-sm tracking-widest text-violet-300/70">
            運命の出会いを科学する
          </p>
          <h1 className="mt-2 text-4xl font-bold">共鳴フィード</h1>
        </div>
        <ResonanceFeed large />
      </div>
    </main>
  );
}
