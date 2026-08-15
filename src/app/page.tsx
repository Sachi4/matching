"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getStoredParticipant, storeParticipant } from "@/lib/participant";

export default function RegisterPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  useEffect(() => {
    const p = getStoredParticipant();
    if (p) setExisting(p.nickname);
  }, []);

  const register = async () => {
    const name = nickname.trim();
    if (!name) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error } = await getSupabase()
        .from("participants")
        .insert({ nickname: name })
        .select("id, nickname")
        .single();
      if (error) throw error;
      storeParticipant({ id: data.id, nickname: data.nickname });
      router.push("/diagnosis");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="text-center">
        <p className="text-sm tracking-widest text-violet-300/70">
          運命の出会いを科学する
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-relaxed">
          同じ画像を見て、
          <br />
          感じ方の共鳴をさがす
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          ニックネームを登録して、画像を見た感想を記録すると、
          感じ方が響き合った人がフィードに現れます。
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="ニックネーム"
          maxLength={20}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-lg outline-none focus:border-violet-400"
        />
        <button
          onClick={register}
          disabled={submitting || !nickname.trim()}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
        >
          {submitting ? "登録中..." : "はじめる"}
        </button>
        {error && <p className="text-center text-sm text-rose-400">{error}</p>}
        {existing && (
          <button
            onClick={() => router.push("/respond")}
            className="text-sm text-white/50 underline underline-offset-4"
          >
            「{existing}」として続きから参加する
          </button>
        )}
      </div>

      <p className="text-center text-xs text-white/30">
        実名・認証は不要です。ニックネームだけで参加できます。
      </p>
    </main>
  );
}
