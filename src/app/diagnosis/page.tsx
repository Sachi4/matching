"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import {
  DIAGNOSIS_QUESTIONS,
  scoreDiagnosis,
  DiagnosisResult,
} from "@/lib/diagnosis";
import { getStoredParticipant, storeDiagnosis } from "@/lib/participant";

export default function DiagnosisPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getStoredParticipant()) router.replace("/");
  }, [router]);

  const question = DIAGNOSIS_QUESTIONS[step];

  const answer = async (key: string) => {
    const next = { ...answers, [question.id]: key };
    setAnswers(next);
    if (step < DIAGNOSIS_QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    const r = scoreDiagnosis(next);
    setResult(r);
    setSaving(true);
    setError(null);
    try {
      const participant = getStoredParticipant()!;
      const { error } = await getSupabase().from("diagnosis_scores").insert({
        participant_id: participant.id,
        type_key: r.typeKey,
        type_name: r.typeName,
        axis_e: r.axisE,
        axis_n: r.axisN,
        axis_i: r.axisI,
      });
      if (error) throw error;
      storeDiagnosis({
        typeKey: r.typeKey,
        typeName: r.typeName,
        tagline: r.tagline,
        palette: r.palette,
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
        <p className="text-center text-sm text-white/50">あなたの感性タイプ</p>
        <div
          className="animate-pop-in rounded-2xl p-[2px]"
          style={{
            background: `linear-gradient(135deg, ${result.palette[0]}, ${result.palette[1]}, ${result.palette[2]})`,
          }}
        >
          <div className="rounded-2xl bg-[#16141f] px-6 py-8 text-center">
            <p className="text-xs tracking-widest text-white/40">
              {result.typeKey}
            </p>
            <h1 className="mt-2 text-3xl font-bold">{result.typeName}</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              {result.tagline}
            </p>
            <div className="mt-6 flex justify-center gap-6 text-xs text-white/50">
              <span>ひらく {result.axisE >= 0 ? "+" : ""}{result.axisE}</span>
              <span>ゆらぎ {result.axisN >= 0 ? "+" : ""}{result.axisN}</span>
              <span>ひらめき {result.axisI >= 0 ? "+" : ""}{result.axisI}</span>
            </div>
          </div>
        </div>
        {error && <p className="text-center text-sm text-rose-400">{error}</p>}
        <button
          onClick={() => router.push("/respond")}
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
        >
          {saving ? "保存中..." : "画像を見にいく"}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex items-center justify-between text-xs text-white/40">
        <span>かんたん感性診断</span>
        <span>
          {step + 1} / {DIAGNOSIS_QUESTIONS.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-rose-400 transition-all"
          style={{
            width: `${((step + 1) / DIAGNOSIS_QUESTIONS.length) * 100}%`,
          }}
        />
      </div>
      <h1 className="text-xl font-bold leading-relaxed">{question.text}</h1>
      <div className="flex flex-col gap-3">
        {question.options.map((o) => (
          <button
            key={o.key}
            onClick={() => answer(o.key)}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-4 text-left leading-relaxed transition-colors hover:border-violet-400 hover:bg-violet-400/10"
          >
            {o.label}
          </button>
        ))}
      </div>
    </main>
  );
}
