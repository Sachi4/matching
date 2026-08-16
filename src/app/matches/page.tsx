"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ResonanceFeed from "@/components/ResonanceFeed";
import { getStoredParticipant } from "@/lib/participant";

// 共鳴の一覧（/feed のカルーセルに載りきらない分をここで全部見る）
export default function MatchesPage() {
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    setMeId(getStoredParticipant()?.id ?? null);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">共鳴の一覧</h1>
        <Link
          href="/feed"
          className="text-sm text-white/50 underline underline-offset-4"
        >
          もどる
        </Link>
      </div>
      <ResonanceFeed layout="list" meId={meId} />
    </main>
  );
}
