"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Stimulus } from "@/lib/types";

// 運営用: 刺激（画像）の追加・表示切替・削除
export default function AdminStimuliPage() {
  const [stimuli, setStimuli] = useState<Stimulus[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [toneLabel, setToneLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("stimuli")
      .select("*")
      .order("sort_order");
    if (error) setError(error.message);
    else setStimuli(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!imageUrl.trim()) return;
    const { error } = await getSupabase().from("stimuli").insert({
      stimulus_type: "image",
      image_url: imageUrl.trim(),
      emotional_tone_label: toneLabel.trim() || null,
      sort_order: stimuli.length + 1,
    });
    if (error) setError(error.message);
    else {
      setImageUrl("");
      setToneLabel("");
      load();
    }
  };

  const toggle = async (s: Stimulus) => {
    const { error } = await getSupabase()
      .from("stimuli")
      .update({ is_active: !s.is_active })
      .eq("id", s.id);
    if (error) setError(error.message);
    else load();
  };

  const remove = async (s: Stimulus) => {
    if (!confirm("この刺激を削除しますか？（回答も削除されます）")) return;
    const { error } = await getSupabase()
      .from("stimuli")
      .delete()
      .eq("id", s.id);
    if (error) setError(error.message);
    else load();
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <h1 className="text-lg font-bold">刺激の管理（運営用）</h1>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4">
        <input
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="画像URL（例: /stimuli/04.svg や https://...）"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 outline-none focus:border-violet-400"
        />
        <input
          type="text"
          value={toneLabel}
          onChange={(e) => setToneLabel(e.target.value)}
          placeholder="トーンのラベル（任意。例: ゆらぎ）"
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 outline-none focus:border-violet-400"
        />
        <button
          onClick={add}
          disabled={!imageUrl.trim()}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-2 font-bold text-white disabled:opacity-40"
        >
          追加
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {stimuli.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-4 rounded-2xl border border-white/10 p-3"
          >
            {s.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.image_url}
                alt=""
                className="h-16 w-16 rounded-lg object-cover"
              />
            )}
            <div className="flex-1">
              <p className="text-sm">{s.emotional_tone_label ?? "（ラベルなし）"}</p>
              <p className="break-all text-xs text-white/40">{s.image_url}</p>
            </div>
            <button
              onClick={() => toggle(s)}
              className={`rounded-full px-3 py-1 text-xs ${
                s.is_active
                  ? "bg-emerald-400/20 text-emerald-300"
                  : "bg-white/10 text-white/50"
              }`}
            >
              {s.is_active ? "表示中" : "非表示"}
            </button>
            <button
              onClick={() => remove(s)}
              className="rounded-full bg-rose-400/20 px-3 py-1 text-xs text-rose-300"
            >
              削除
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
