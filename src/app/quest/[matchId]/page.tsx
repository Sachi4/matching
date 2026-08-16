"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getStoredParticipant } from "@/lib/participant";
import QuestAxisPlot from "@/components/QuestAxisPlot";
import {
  EMOTIONS,
  EMOTION_ORDER,
  LAYER_TITLES,
  type EmotionDefinition,
  type EmotionKey,
} from "@/lib/quest";
import type {
  Match,
  QuestResult,
  QuestSession,
  QuestSharedTerm,
  QuestTurn,
} from "@/lib/types";

// 共鳴後の探索（Phase 1）: 1感情を3レイヤーで掘り下げる。
// 各レイヤーは「同時に書く → 両者そろったら同時に開く」。相手を見てから書けないので、
// 開いた瞬間に重なりとズレが立ち上がる。
export default function QuestPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params.matchId;

  const [me, setMe] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<QuestSession[]>([]);
  const [session, setSession] = useState<QuestSession | null>(null);
  const [turns, setTurns] = useState<QuestTurn[]>([]);
  const [result, setResult] = useState<QuestResult | null>(null);
  const [sharedTerm, setSharedTerm] = useState<QuestSharedTerm | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partnerId = match && me
    ? me === match.participant_id_a
      ? match.participant_id_b
      : match.participant_id_a
    : null;

  useEffect(() => {
    const stored = getStoredParticipant();
    setMe(stored?.id ?? null);

    (async () => {
      const supabase = getSupabase();
      const { data: m, error: matchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();
      if (matchError || !m) {
        setError("この共鳴が見つかりませんでした");
        setLoading(false);
        return;
      }
      setMatch(m as Match);

      const [{ data: people }, { data: sess }] = await Promise.all([
        supabase
          .from("participants")
          .select("id, nickname")
          .in("id", [m.participant_id_a, m.participant_id_b]),
        supabase
          .from("quest_sessions")
          .select("*")
          .eq("match_id", matchId)
          .order("created_at"),
      ]);
      setNicknames(
        Object.fromEntries((people ?? []).map((p) => [p.id, p.nickname])),
      );
      setSessions((sess ?? []) as QuestSession[]);
      setLoading(false);
    })();
  }, [matchId]);

  const refresh = useCallback(async (sessionId: string) => {
    const supabase = getSupabase();
    const [{ data: turnRows }, { data: resultRows }, { data: term }, { data: sess }] =
      await Promise.all([
        supabase
          .from("quest_turns")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at"),
        supabase.rpc("compute_quest_result", { p_session_id: sessionId }),
        supabase
          .from("quest_shared_terms")
          .select("*")
          .eq("session_id", sessionId)
          .maybeSingle(),
        supabase.from("quest_sessions").select("*").eq("id", sessionId).single(),
      ]);
    setTurns((turnRows ?? []) as QuestTurn[]);
    setResult((resultRows?.[0] ?? null) as QuestResult | null);
    setSharedTerm((term ?? null) as QuestSharedTerm | null);
    if (sess) setSession(sess as QuestSession);
  }, []);

  // セッション中は turns / sessions / shared_terms の変化を購読して、両者の進行を同期する
  useEffect(() => {
    if (!session) return;
    const supabase = getSupabase();
    refresh(session.id);
    const channel = supabase
      .channel(`quest-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quest_turns",
          filter: `session_id=eq.${session.id}`,
        },
        () => refresh(session.id),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quest_sessions",
          filter: `id=eq.${session.id}`,
        },
        () => refresh(session.id),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "quest_shared_terms",
          filter: `session_id=eq.${session.id}`,
        },
        () => refresh(session.id),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, refresh]);

  const startSession = async (emotion: EmotionKey) => {
    const existing = sessions.find((s) => s.emotion === emotion);
    if (existing) {
      setSession(existing);
      return;
    }
    const supabase = getSupabase();
    const { data, error: insertError } = await supabase
      .from("quest_sessions")
      .insert({ match_id: matchId, emotion })
      .select("*")
      .maybeSingle();
    if (data) {
      setSessions((prev) => [...prev, data as QuestSession]);
      setSession(data as QuestSession);
      return;
    }
    // 二人が同時に開始した場合は一意制約で落ちるので、相手が作った行を読み直す
    const { data: retry } = await supabase
      .from("quest_sessions")
      .select("*")
      .eq("match_id", matchId)
      .eq("emotion", emotion)
      .maybeSingle();
    if (retry) {
      setSessions((prev) => [...prev, retry as QuestSession]);
      setSession(retry as QuestSession);
    } else {
      setError(String(insertError?.message ?? "探索をはじめられませんでした"));
    }
  };

  const submitTurn = async (payload: {
    chips?: string[];
    axis_x?: number;
    axis_y?: number;
    text_answer?: string;
  }) => {
    if (!session || !me) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnError } = await getSupabase().functions.invoke(
        "quest-turn",
        {
          body: {
            session_id: session.id,
            participant_id: me,
            layer: session.layer,
            ...payload,
          },
        },
      );
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      await refresh(session.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  const advanceLayer = async () => {
    if (!session || session.layer >= 3) return;
    const next = session.layer + 1;
    await getSupabase()
      .from("quest_sessions")
      .update({ layer: next })
      .eq("id", session.id)
      .lt("layer", next);
    await refresh(session.id);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-white/50">
        読み込み中...
      </main>
    );
  }

  if (!me) {
    return (
      <Notice>
        <p>この端末の参加者情報が見つかりません。</p>
        <Link href="/" className="underline underline-offset-4">
          ニックネーム登録からやり直す
        </Link>
      </Notice>
    );
  }

  if (error && !match) {
    return <Notice>{error}</Notice>;
  }

  if (match && me !== match.participant_id_a && me !== match.participant_id_b) {
    return (
      <Notice>
        <p>この探索は、共鳴した二人だけのものです。</p>
        <Link href="/feed" className="underline underline-offset-4">
          共鳴フィードにもどる
        </Link>
      </Notice>
    );
  }

  const partnerName = partnerId ? nicknames[partnerId] ?? "相手" : "相手";

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-8">
        <header>
          <p className="text-xs text-white/40">共鳴のあとの探索</p>
          <h1 className="mt-1 text-2xl font-bold">
            {partnerName} と、どの感情を掘りますか？
          </h1>
          {match?.reaction_phrase && (
            <p className="mt-2 text-sm text-white/50">
              二人の共鳴：「{match.reaction_phrase}」
            </p>
          )}
        </header>

        <div className="flex flex-col gap-3">
          {EMOTION_ORDER.map((key) => {
            const emotion = EMOTIONS[key];
            const existing = sessions.find((s) => s.emotion === key);
            return (
              <button
                key={key}
                onClick={() => startSession(key)}
                className="rounded-2xl p-[2px] text-left"
                style={{
                  background: `linear-gradient(120deg, ${emotion.palette[0]}, ${emotion.palette[1]})`,
                }}
              >
                <div className="rounded-2xl bg-[#16141f]/90 px-5 py-4">
                  <p className="text-lg font-bold">{emotion.label}</p>
                  <p className="mt-1 text-xs text-white/50">{emotion.lead}</p>
                  <p className="mt-2 text-xs text-white/40">
                    {existing
                      ? existing.status === "completed"
                        ? "結果を見る"
                        : `L${existing.layer} から続ける`
                      : "はじめる"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <Link
          href="/feed"
          className="text-center text-sm text-white/40 underline underline-offset-4"
        >
          共鳴フィードにもどる
        </Link>
      </main>
    );
  }

  const emotion = EMOTIONS[session.emotion as EmotionKey];
  const layer = session.layer;
  const myTurn = turns.find((t) => t.layer === layer && t.participant_id === me);
  const partnerTurn = turns.find(
    (t) => t.layer === layer && t.participant_id === partnerId,
  );
  const revealed = Boolean(myTurn && partnerTurn);
  const finished = revealed && layer === 3;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-6 py-8">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs text-white/40">
            {emotion.label} の探索 ・ {partnerName} と
          </p>
          <h1 className="mt-1 text-xl font-bold">
            {LAYER_TITLES[layer].title}
          </h1>
          <p className="text-xs text-white/50">{LAYER_TITLES[layer].hint}</p>
        </div>
        <button
          onClick={() => setSession(null)}
          className="text-xs text-white/40 underline underline-offset-4"
        >
          感情を選び直す
        </button>
      </header>

      <div className="flex gap-1">
        {[1, 2, 3].map((l) => (
          <span
            key={l}
            className="h-1 flex-1 rounded-full"
            style={{
              backgroundColor:
                l < layer || (l === layer && revealed)
                  ? emotion.palette[0]
                  : "rgba(255,255,255,0.12)",
            }}
          />
        ))}
      </div>

      {!myTurn && (
        <LayerForm
          emotion={emotion}
          layer={layer}
          submitting={submitting}
          onSubmit={submitTurn}
        />
      )}

      {myTurn && !revealed && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center">
          <p className="text-sm text-white/70">
            {partnerName} が書き終えるのを待っています
          </p>
          <p className="mt-2 text-xs text-white/40">
            そろった瞬間に、二人の答えが同時に開きます
          </p>
        </section>
      )}

      {revealed && myTurn && partnerTurn && (
        <Reveal
          emotion={emotion}
          layer={layer}
          mine={myTurn}
          theirs={partnerTurn}
          partnerName={partnerName}
        />
      )}

      {revealed && !finished && (
        <button
          onClick={advanceLayer}
          className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white"
        >
          L{layer + 1} へ進む
        </button>
      )}

      {finished && (
        <ResultPanel
          emotion={emotion}
          result={result}
          sharedTerm={sharedTerm}
        />
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center text-sm text-white/70">
      {children}
    </main>
  );
}

function LayerForm({
  emotion,
  layer,
  submitting,
  onSubmit,
}: {
  emotion: EmotionDefinition;
  layer: number;
  submitting: boolean;
  onSubmit: (payload: {
    chips?: string[];
    axis_x?: number;
    axis_y?: number;
    text_answer?: string;
  }) => void;
}) {
  const [chips, setChips] = useState<string[]>([]);
  const [axisX, setAxisX] = useState(0);
  const [axisY, setAxisY] = useState(0);
  const [text, setText] = useState("");

  const canSubmit =
    layer === 1 ? chips.length > 0 : layer === 2 ? true : text.trim().length > 0;

  return (
    <section className="flex flex-col gap-4">
      {layer === 1 && (
        <div>
          <p className="mb-2 text-sm text-white/60">
            {emotion.label}が来たとき、体のどこで起きますか？（いくつでも）
          </p>
          <div className="flex flex-wrap gap-2">
            {emotion.chips.map((chip) => {
              const active = chips.includes(chip.label);
              return (
                <button
                  key={chip.label}
                  onClick={() =>
                    setChips((prev) =>
                      prev.includes(chip.label)
                        ? prev.filter((c) => c !== chip.label)
                        : [...prev, chip.label],
                    )
                  }
                  className={`rounded-full border px-3 py-1.5 text-sm transition-all ${
                    active
                      ? "border-transparent font-bold text-black"
                      : "border-white/20 text-white/70"
                  }`}
                  style={active ? { backgroundColor: chip.color } : undefined}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {layer === 2 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-white/60">
            あなたの{emotion.label}を、2つの軸に置いてください
          </p>
          <AxisSlider
            axis={emotion.axisX}
            value={axisX}
            onChange={setAxisX}
            color={emotion.palette[0]}
          />
          <AxisSlider
            axis={emotion.axisY}
            value={axisY}
            onChange={setAxisY}
            color={emotion.palette[1]}
          />
        </div>
      )}

      {layer === 3 && (
        <div>
          <p className="mb-2 text-sm text-white/60">{emotion.l3Question}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={emotion.l3Placeholder}
            rows={4}
            maxLength={200}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-violet-400"
          />
        </div>
      )}

      <button
        onClick={() =>
          onSubmit(
            layer === 1
              ? { chips }
              : layer === 2
                ? { axis_x: axisX, axis_y: axisY }
                : { text_answer: text.trim() },
          )
        }
        disabled={submitting || !canSubmit}
        className="rounded-xl bg-gradient-to-r from-violet-500 to-rose-400 px-4 py-3 text-lg font-bold text-white disabled:opacity-40"
      >
        {submitting ? "送信中..." : "同時に開く（相手を待つ）"}
      </button>
    </section>
  );
}

function AxisSlider({
  axis,
  value,
  onChange,
  color,
}: {
  axis: { label: string; negative: string; positive: string };
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-white/50">
        <span>{axis.negative}</span>
        <span className="text-white/30">{axis.label}</span>
        <span>{axis.positive}</span>
      </div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: color }}
      />
    </div>
  );
}

function Reveal({
  emotion,
  layer,
  mine,
  theirs,
  partnerName,
}: {
  emotion: EmotionDefinition;
  layer: number;
  mine: QuestTurn;
  theirs: QuestTurn;
  partnerName: string;
}) {
  const shared = useMemo(
    () => mine.chips.filter((c) => theirs.chips.includes(c)),
    [mine.chips, theirs.chips],
  );

  return (
    <section className="animate-pop-in flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      {layer === 1 && (
        <>
          <ChipRow label="あなた" chips={mine.chips} emotion={emotion} shared={shared} />
          <ChipRow
            label={partnerName}
            chips={theirs.chips}
            emotion={emotion}
            shared={shared}
          />
          <p className="text-xs text-white/50">
            {shared.length > 0
              ? `重なった体感: ${shared.join("、")}`
              : "同じ言葉はひとつもありませんでした。ここからが面白いところです。"}
          </p>
        </>
      )}

      {layer === 2 && mine.axis_x !== null && theirs.axis_x !== null && (
        <>
          <QuestAxisPlot
            emotion={emotion}
            points={[
              {
                label: "あなた",
                x: Number(mine.axis_x),
                y: Number(mine.axis_y ?? 0),
                color: emotion.palette[0],
              },
              {
                label: partnerName,
                x: Number(theirs.axis_x),
                y: Number(theirs.axis_y ?? 0),
                color: emotion.palette[1],
              },
            ]}
          />
          <p className="text-xs text-white/50">
            点の距離が、そのまま二人の{emotion.label}のずれです
          </p>
        </>
      )}

      {layer === 3 && (
        <>
          <Quote label="あなた" text={mine.text_answer} />
          <Quote label={partnerName} text={theirs.text_answer} />
        </>
      )}
    </section>
  );
}

function ChipRow({
  label,
  chips,
  emotion,
  shared,
}: {
  label: string;
  chips: string[];
  emotion: EmotionDefinition;
  shared: string[];
}) {
  const colorOf = (chip: string) =>
    emotion.chips.find((c) => c.label === chip)?.color ?? "#A78BC9";
  return (
    <div>
      <p className="mb-1 text-xs text-white/40">{label}</p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isShared = shared.includes(chip);
          return (
            <span
              key={chip}
              className={`rounded-full px-3 py-1 text-sm ${
                isShared ? "font-bold text-black" : "text-white/70"
              }`}
              style={
                isShared
                  ? { backgroundColor: colorOf(chip) }
                  : { border: `1px solid ${colorOf(chip)}55` }
              }
            >
              {chip}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Quote({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/40">{label}</p>
      <p className="rounded-xl bg-white/5 px-4 py-3 text-sm leading-relaxed">
        {text}
      </p>
    </div>
  );
}

function ResultPanel({
  emotion,
  result,
  sharedTerm,
}: {
  emotion: EmotionDefinition;
  result: QuestResult | null;
  sharedTerm: QuestSharedTerm | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div
        className="rounded-2xl p-[2px]"
        style={{
          background: `linear-gradient(120deg, ${emotion.palette[0]}, ${emotion.palette[1]})`,
        }}
      >
        <div className="rounded-2xl bg-[#16141f]/90 px-5 py-6 text-center">
          <p className="text-xs text-white/40">二人の{emotion.label}の名前</p>
          {sharedTerm ? (
            <>
              <p className="mt-2 text-2xl font-bold">「{sharedTerm.term}」</p>
              {sharedTerm.description && (
                <p className="mt-2 text-sm text-white/60">
                  {sharedTerm.description}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-white/50">名前をつけています...</p>
          )}
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="共鳴" value={`${(result.resonance * 100).toFixed(0)}%`} />
          <Metric label="対比" value={`${(result.contrast * 100).toFixed(0)}%`} />
          <Metric label="解像度" value={`Lv.${result.resolution}`} />
        </div>
      )}

      <p className="text-center text-xs leading-relaxed text-white/40">
        似ているほど良い、ではありません。
        <br />
        同じ言葉の中身が違っていたところが、二人の発見です。
      </p>

      <Link
        href="/feed"
        className="text-center text-sm text-white/40 underline underline-offset-4"
      >
        共鳴フィードにもどる
      </Link>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
