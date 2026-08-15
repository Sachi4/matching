"use client";

import Link from "next/link";
import MosaicWall from "@/components/MosaicWall";
import ResonanceBurst from "@/components/ResonanceBurst";

// 会場の大画面用ビュー（もう一枚）: 感想が記録されるたびにタイルが増えるモザイクウォール
export default function MosaicScreenPage() {
  return (
    <main className="relative flex min-h-screen flex-col gap-4 bg-[#0b0a11] px-10 py-8">
      <div className="text-center">
        <p className="text-sm tracking-widest text-violet-300/70">
          運命の出会いを科学する
        </p>
        <h1 className="mt-1 text-4xl font-bold">感じ方のモザイク</h1>
        <p className="mt-1 text-sm text-white/40">
          ひとつの印が、誰かのひとつの感想。共鳴したペアの印は光り、線でつながります。
        </p>
      </div>
      <div className="flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black/30 p-3">
        <MosaicWall />
      </div>
      <Link
        href="/screen"
        className="text-center text-xs text-white/30 underline underline-offset-4"
      >
        共鳴の星座にもどる
      </Link>
      <ResonanceBurst haptics={false} />
    </main>
  );
}
