"use client";

import Link from "next/link";
import CollectiveCanvas from "@/components/CollectiveCanvas";
import ResonanceFeed from "@/components/ResonanceFeed";

export default function FeedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">共鳴フィード</h1>
        <Link href="/respond" className="text-sm text-white/50 underline underline-offset-4">
          画像にもどる
        </Link>
      </div>

      <section>
        <p className="mb-2 text-sm text-white/60">みんなの感覚から育つキャンバス</p>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12101a]">
          <CollectiveCanvas className="h-64 w-full" />
        </div>
      </section>

      <section>
        <p className="mb-2 text-sm text-white/60">いま生まれた共鳴</p>
        <ResonanceFeed />
      </section>
    </main>
  );
}
