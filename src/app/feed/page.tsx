"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CollectiveCanvas from "@/components/CollectiveCanvas";
import Constellation from "@/components/Constellation";
import ResonanceFeed from "@/components/ResonanceFeed";
import { getStoredParticipant } from "@/lib/participant";
import { getSupabase } from "@/lib/supabase";
import { isTestModeEnabled } from "@/lib/testMode";

export default function FeedPage() {
  const [meId, setMeId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  useEffect(() => {
    setMeId(getStoredParticipant()?.id ?? null);
    isTestModeEnabled(getSupabase()).then(setTestMode);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">共鳴フィード</h1>
        <Link href="/respond" className="text-sm text-white/50 underline underline-offset-4">
          画像にもどる
        </Link>
      </div>

      <section>
        <p className="mb-2 text-sm text-white/60">
          共鳴の星座（中心があなた・近いほど似ている）
        </p>
        <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-[#0d0b14]">
          <Constellation meId={meId} />
        </div>
      </section>

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

      {testMode && (
        <Link
          href="/admin/test"
          className="text-center text-xs text-amber-300/70 underline underline-offset-4"
        >
          テストモード：デバッグUIを開く
        </Link>
      )}
    </main>
  );
}
