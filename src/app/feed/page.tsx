"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CollectiveCanvas from "@/components/CollectiveCanvas";
import Constellation from "@/components/Constellation";
import ResonanceFeed from "@/components/ResonanceFeed";
import { getStoredParticipant } from "@/lib/participant";
import { getSupabase } from "@/lib/supabase";
import { isTestModeEnabled } from "@/lib/testMode";

const CARD_LIMIT = 5;

export default function FeedPage() {
  const [meId, setMeId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setMeId(getStoredParticipant()?.id ?? null);
    isTestModeEnabled(getSupabase()).then(setTestMode);
  }, []);

  const onTotalChange = useCallback((n: number) => setTotal(n), []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">共鳴</h1>
        <Link
          href="/respond"
          className="text-sm text-white/50 underline underline-offset-4"
        >
          画像にもどる
        </Link>
      </div>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <p className="text-sm text-white/60">
            生まれた共鳴{total > 0 && `（${total}）`}
          </p>
          {total > CARD_LIMIT && (
            <Link
              href="/matches"
              className="text-xs text-white/50 underline underline-offset-4"
            >
              すべて見る
            </Link>
          )}
        </div>
        <ResonanceFeed
          layout="carousel"
          limit={CARD_LIMIT}
          meId={meId}
          onTotalChange={onTotalChange}
        />
        {total > CARD_LIMIT && (
          <p className="mt-2 text-center text-[11px] text-white/30">
            横にスワイプ（PCは横スクロール）・{CARD_LIMIT}件目より前は一覧へ
          </p>
        )}
      </section>

      <section>
        <p className="text-sm text-white/60">共鳴マップ</p>
        <p className="mb-2 text-xs text-white/35">
          中心があなた。感じ方が近い人ほど近くに置かれ、共鳴したペアは線でつながります。
        </p>
        <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-[#0d0b14]">
          <Constellation meId={meId} />
        </div>
      </section>

      <section>
        <p className="text-sm text-white/60">みんなの感覚が混ざるキャンバス</p>
        <p className="mb-2 text-xs text-white/35">
          共鳴とは別に、この場の全員の感想の色が少しずつ足されていく絵です。
        </p>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12101a]">
          <CollectiveCanvas className="h-64 w-full" />
        </div>
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
