"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getStoredParticipant } from "@/lib/participant";
import { FEELING_TAGS } from "@/lib/tags";
import { safeImageUrl } from "@/lib/imageUrl";
import type { Stimulus } from "@/lib/types";

type NewMatch = { id: string; score: number; reaction_phrase: string | null };

export default function RespondPage() {
  const router = useRouter();
  const [stimuli, setStimuli] = useState<Stimulus[] | null>(null);
  const [index, setIndex] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMatches, setNewMatches] = useState<NewMatch[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const participant = getStoredParticipant();
    if (!participant) {
      router.replace("/");
      return;
    }
    (async () => {
      const supabase = getSupabase();
      const [{ data: stims }, { data: mine }] = await Promise.all([
        supabase
          .from("stimuli")
          .select("*")
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("stimulus_responses")
          .select("stimulus_id")
          .eq("participant_id", participant.id),
      ]);
      const answered = new Set((mine ?? []).map((r) => r.stimulus_id));
      setAnsweredIds(answered);
      const list = stims ?? [];
      setStimuli(list);
      const firstUnanswered = list.findIndex((s) => !answered.has(s.id));
      setIndex(firstUnanswered === -1 ? list.length : firstUnanswered);
    })();
  }, [router]);

  const toggleTag = (label: string) => {
    setSelectedTags((prev) =>
      prev.includes(label)
        ? prev.filter((t) => t !== label)
        : [...prev, label],
    );
  };

  const submit = async () => {
    if (!stimuli) return;
    const stimulus = stimuli[index];
    const participant = getStoredParticipant()!;
    const responseText = [selectedTags.join("、"), freeText.trim()]
      .filter(Boolean)
      .join("。");
    if (!responseText) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error } = await getSupabase().functions.invoke(
        "submit-response",
        {
          body: {
            participant_id: participant.id,
            stimulus_id: stimulus.id,
            response_text: responseText,
            selected_tags: selectedTags,
          },
        },
      );
      if (error) throw error;
      setNewMatches(data?.matches ?? []);
      setAnsweredIds((prev) => new Set(prev).add(stimulus.id));
      setSelectedTags([]);
      setFreeText("");
      setIndex(index + 1);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!stimuli) {
    return (
      <main className="flex min-h-screen items-center justify-center text-white/50">
        読み込み中...
      </main>
    );
  }

  if (index >= stimuli.length) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
        <h1 className="text-2xl font-bold">
          {stimuli.length === 0
            ? "いま表示中の画像はありません"
            : "すべての画像に答えました"}
        </h1>
        <p className="text-sm leading-relaxed text-white/60">
          共鳴フィードで、みんなの感じ方が重なっていく様子を見てみましょう。
          新しい画像が追加されたら、またここに戻ってきてください。
        </p>
        <button
          onClick={() => router.push("/feed")}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-6 py-3 text-lg font-bold text-white"
        >
          共鳴フィードを見る
        </button>
        {newMatches.length > 0 && (
          <MatchPopup key={newMatches[0].id} matches={newMatches} />
        )}
      </main>
    );
  }

  const stimulus = stimuli[index];
  const stimulusImageUrl = safeImageUrl(stimulus.image_url);
  const canSubmit = selectedTags.length > 0 || freeText.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-6 py-8">
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>
          {answeredIds.has(stimulus.id) ? "回答済み" : "この画像を見て感じたことは？"}
        </span>
        <span>
          {index + 1} / {stimuli.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        {stimulusImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stimulusImageUrl}
            alt={stimulus.emotional_tone_label ?? "抽象画像"}
            className="aspect-square w-full object-cover"
          />
        )}
      </div>

      <div>
        <p className="mb-2 text-sm text-white/60">
          近い感覚をタップ（いくつでも）
        </p>
        <div className="flex flex-wrap gap-2">
          {FEELING_TAGS.map((tag) => {
            const active = selectedTags.includes(tag.label);
            return (
              <button
                key={tag.label}
                onClick={() => toggleTag(tag.label)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                  active
                    ? "border-transparent font-bold text-black"
                    : "border-white/20 text-white/70"
                }`}
                style={active ? { backgroundColor: tag.color } : undefined}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-white/60">ひとこと添える（任意）</p>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="例：夜のプールに沈んでいくみたい"
          rows={3}
          maxLength={200}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-violet-400"
        />
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting || !canSubmit}
        className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
      >
        {submitting ? "送信中..." : "この感覚を記録する"}
      </button>

      {newMatches.length > 0 && (
        <MatchPopup key={newMatches[0].id} matches={newMatches} />
      )}
    </main>
  );
}

function MatchPopup({ matches }: { matches: NewMatch[] }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-6 z-50 mx-auto max-w-md px-6">
      <div className="animate-pop-in rounded-2xl bg-gradient-to-r from-violet-500 to-rose-400 p-[2px] shadow-2xl">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#16141f] px-5 py-4">
          <div>
            <p className="text-sm font-bold">共鳴が生まれました！</p>
            <p className="text-xs text-white/60">
              {matches[0].reaction_phrase
                ? `「${matches[0].reaction_phrase}」`
                : ""}{" "}
              フィードを見てみましょう
            </p>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="text-white/40"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
