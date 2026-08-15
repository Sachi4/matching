"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ResonanceBurst from "@/components/ResonanceBurst";
import { getSupabase } from "@/lib/supabase";
import { getStoredParticipant } from "@/lib/participant";
import { safeImageUrl } from "@/lib/imageUrl";
import { tonePalette } from "@/lib/tones";
import type { DiagnosisQuestion, HintWord, Stimulus, Tone } from "@/lib/types";

type ToneStimulus = Stimulus & { tones: Tone };
type Step = "image" | "feel" | "quiz";

// 画像を見る → 感想を記録する → その画像のトーンの診断質問に答える、を
// 用意された画像の数だけ繰り返すメインフロー
export default function RespondPage() {
  const router = useRouter();
  const [stimuli, setStimuli] = useState<ToneStimulus[] | null>(null);
  const [hintWords, setHintWords] = useState<HintWord[]>([]);
  const [questions, setQuestions] = useState<DiagnosisQuestion[]>([]);
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(
    new Set(),
  );
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>("image");
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [choices, setChoices] = useState<Record<string, "a" | "b">>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    const participant = getStoredParticipant();
    if (!participant) {
      router.replace("/");
      return;
    }
    (async () => {
      const supabase = getSupabase();
      const [
        { data: stims },
        { data: words },
        { data: qs },
        { data: myResponses },
        { data: myAnswers },
      ] = await Promise.all([
        supabase
          .from("stimuli")
          .select("*, tones(*)")
          .eq("is_active", true),
        supabase.from("hint_words").select("*").order("sort_order"),
        supabase.from("diagnosis_questions").select("*").order("sort_order"),
        supabase
          .from("stimulus_responses")
          .select("stimulus_id")
          .eq("participant_id", participant.id),
        supabase
          .from("diagnosis_answers")
          .select("question_id")
          .eq("participant_id", participant.id),
      ]);
      const list = ((stims ?? []) as ToneStimulus[]).sort(
        (a, b) =>
          a.tones.sort_order - b.tones.sort_order ||
          a.created_at.localeCompare(b.created_at),
      );
      const responded = new Set((myResponses ?? []).map((r) => r.stimulus_id));
      const answered = new Set((myAnswers ?? []).map((a) => a.question_id));
      const allQuestions = (qs ?? []) as DiagnosisQuestion[];

      // 途中から再開できるように、未完了の最初の刺激とステップを探す
      let resumeIndex = list.length;
      let resumeStep: Step = "image";
      for (let i = 0; i < list.length; i++) {
        const toneQs = allQuestions.filter(
          (q) => q.tone_id === list[i].tone_id,
        );
        if (!responded.has(list[i].id)) {
          resumeIndex = i;
          resumeStep = "image";
          break;
        }
        if (toneQs.some((q) => !answered.has(q.id))) {
          resumeIndex = i;
          resumeStep = "quiz";
          break;
        }
      }

      setHintWords((words ?? []) as HintWord[]);
      setQuestions(allQuestions);
      setAnsweredQuestionIds(answered);
      setStimuli(list);
      setIndex(resumeIndex);
      setStep(resumeStep);
    })();
  }, [router]);

  // 自分に関わる共鳴が生まれたら、後からRealtimeで受け取ってバースト演出を出す
  useEffect(() => {
    setMeId(getStoredParticipant()?.id ?? null);
  }, []);

  const toggleWord = (word: string) => {
    setSelectedWords((prev) =>
      prev.includes(word) ? prev.filter((w) => w !== word) : [...prev, word],
    );
  };

  const advance = (answered: Set<string>) => {
    if (!stimuli) return;
    // 次の刺激へ。トーンの質問が回答済みならquizはスキップされる（image→feel→quiz判定）
    setSelectedWords([]);
    setFreeText("");
    setChoices({});
    setAnsweredQuestionIds(answered);
    setIndex(index + 1);
    setStep("image");
  };

  // 送信の完了を待たずに次の画面へ進む。embedding生成と共鳴判定はバックグラウンドで走り、
  // 共鳴が生まれたらRealtimeでポップアップが届く
  const submitFeelings = () => {
    if (!stimuli) return;
    const stimulus = stimuli[index];
    const participant = getStoredParticipant()!;
    setError(null);

    const body = {
      participant_id: participant.id,
      stimulus_id: stimulus.id,
      free_text: freeText.trim(),
      hint_words_selected: selectedWords,
    };
    getSupabase()
      .functions.invoke("submit-response", { body })
      .then(({ error }) => {
        if (error) throw error;
      })
      .catch((e) =>
        setError(
          `感想の送信に失敗しました（${e instanceof Error ? e.message : String(e)}）`,
        ),
      );

    const toneQs = questions.filter((q) => q.tone_id === stimulus.tone_id);
    if (toneQs.some((q) => !answeredQuestionIds.has(q.id))) {
      setStep("quiz");
    } else {
      // このトーンの質問は回答済み（同じトーンの画像が複数ある場合）
      advance(answeredQuestionIds);
    }
  };

  const submitQuiz = async () => {
    if (!stimuli) return;
    const stimulus = stimuli[index];
    const participant = getStoredParticipant()!;
    const toneQs = questions.filter(
      (q) => q.tone_id === stimulus.tone_id && !answeredQuestionIds.has(q.id),
    );
    if (toneQs.some((q) => !choices[q.id])) return;
    setSubmitting(true);
    setError(null);
    try {
      const rows = toneQs.map((q) => ({
        participant_id: participant.id,
        question_id: q.id,
        choice: choices[q.id],
      }));
      const { error } = await getSupabase()
        .from("diagnosis_answers")
        .insert(rows);
      if (error) throw error;
      // 共鳴判定は待たない（結果はRealtimeで届く）
      void getSupabase().functions.invoke("check-resonance", {
        body: { participant_id: participant.id },
      });
      const answered = new Set(answeredQuestionIds);
      toneQs.forEach((q) => answered.add(q.id));
      advance(answered);
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
        <ResonanceBurst meId={meId} />
      </main>
    );
  }

  const stimulus = stimuli[index];
  const toneLabel = stimulus.tones.label;
  const palette = tonePalette(toneLabel);
  const stimulusImageUrl = safeImageUrl(stimulus.image_url);
  const toneWords = hintWords.filter((w) => w.tone_id === stimulus.tone_id);
  const toneQuestions = questions.filter(
    (q) => q.tone_id === stimulus.tone_id && !answeredQuestionIds.has(q.id),
  );
  const canSubmitFeelings =
    selectedWords.length > 0 || freeText.trim().length > 0;
  const canSubmitQuiz = toneQuestions.every((q) => choices[q.id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-6 py-8">
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>
          {step === "image" && "この画像をじっくり見てください"}
          {step === "feel" && "この画像を見て感じたことは？"}
          {step === "quiz" && `「${toneLabel}」についての質問`}
        </span>
        <span>
          {index + 1} / {stimuli.length}
        </span>
      </div>

      {step === "image" && (
        <>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {stimulusImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={stimulusImageUrl}
                alt="抽象画像"
                className="aspect-square w-full object-cover"
              />
            )}
          </div>
          <p className="text-center text-sm text-white/50">
            言葉にする前に、まず感じてみてください。
          </p>
          <button
            onClick={() => setStep("feel")}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white"
          >
            感じたことを記録する
          </button>
        </>
      )}

      {step === "feel" && (
        <>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {stimulusImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={stimulusImageUrl}
                alt="抽象画像"
                className="aspect-video w-full object-cover"
              />
            )}
          </div>

          <div>
            <p className="mb-2 text-sm text-white/60">
              近い感覚をタップ（いくつでも）
            </p>
            <div className="flex flex-wrap gap-2">
              {toneWords.map((w, i) => {
                const active = selectedWords.includes(w.word);
                return (
                  <button
                    key={w.id}
                    onClick={() => toggleWord(w.word)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                      active
                        ? "border-transparent font-bold text-black"
                        : "border-white/20 text-white/70"
                    }`}
                    style={
                      active
                        ? { backgroundColor: palette[i % palette.length] }
                        : undefined
                    }
                  >
                    {w.word}
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
            onClick={submitFeelings}
            disabled={submitting || !canSubmitFeelings}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
          >
            {submitting ? "送信中..." : "この感覚を記録する"}
          </button>
        </>
      )}

      {step === "quiz" && (
        <>
          {toneQuestions.map((q) => (
            <div
              key={q.id}
              className="flex flex-col gap-3 rounded-2xl border border-white/10 p-4"
            >
              <p className="text-sm font-bold">{q.prompt}</p>
              {(["a", "b"] as const).map((c) => {
                const active = choices[q.id] === c;
                return (
                  <button
                    key={c}
                    onClick={() =>
                      setChoices((prev) => ({ ...prev, [q.id]: c }))
                    }
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                      active
                        ? "border-violet-400 bg-violet-500/20 font-bold"
                        : "border-white/15 text-white/70"
                    }`}
                  >
                    {c === "a" ? q.text_a : q.text_b}
                  </button>
                );
              })}
            </div>
          ))}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            onClick={submitQuiz}
            disabled={submitting || !canSubmitQuiz}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
          >
            {submitting
              ? "送信中..."
              : index + 1 < stimuli.length
                ? "次の画像へ"
                : "完了する"}
          </button>
        </>
      )}

      <ResonanceBurst meId={meId} />
    </main>
  );
}
