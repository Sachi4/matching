"use client";

import { useEffect, useMemo, useState } from "react";
import Sigil from "@/components/Sigil";
import { getSupabase } from "@/lib/supabase";
import type { Match } from "@/lib/types";

type Tile = {
  id: string;
  participant_id: string;
  stimulus_id: string;
  created_at: string;
};

// 会場の大画面用。誰かが感想を記録するたびにタイルが1枚増え、
// 共鳴したペアのタイルは光って線でつながる。タイルの絵は共鳴演出と同じ「印」。
export default function MosaicWall({ className }: { className?: string }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [toneByStimulus, setToneByStimulus] = useState<Map<string, string>>(
    new Map(),
  );
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;

    (async () => {
      const [{ data: stimuli }, { data: responses }, { data: rows }] =
        await Promise.all([
          supabase.from("stimuli").select("id, tones(label)"),
          supabase
            .from("stimulus_responses")
            .select("id, participant_id, stimulus_id, created_at")
            .order("created_at"),
          supabase.from("matches").select("*"),
        ]);
      if (cancelled) return;
      const toneMap = new Map<string, string>();
      for (const s of stimuli ?? []) {
        const label = (s.tones as unknown as { label: string } | null)?.label;
        if (label) toneMap.set(s.id, label);
      }
      setToneByStimulus(toneMap);
      setTiles((responses ?? []) as Tile[]);
      setMatches((rows ?? []) as Match[]);
    })();

    const channel = supabase
      .channel("mosaic-wall")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stimulus_responses" },
        (payload) => {
          const row = payload.new as Tile;
          setTiles((prev) =>
            prev.some((t) => t.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches" },
        (payload) =>
          setMatches((prev) => [...prev, payload.new as Match]),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "matches" },
        (payload) => {
          const removed = payload.old as { id?: string };
          setMatches((prev) => prev.filter((m) => m.id !== removed.id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const matchedParticipants = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      set.add(m.participant_id_a);
      set.add(m.participant_id_b);
    }
    return set;
  }, [matches]);

  // 追加順に空いているマスを埋めていく（列数は枚数に応じて増やす）
  const columns = Math.max(6, Math.ceil(Math.sqrt(tiles.length * 1.8)));
  const cellOf = new Map(tiles.map((t, i) => [t.id, i]));

  // 共鳴したペアのタイル同士を線でつなぐ（各ペアの最初のタイルどうし）
  const firstTileOf = new Map<string, string>();
  for (const t of tiles) {
    if (!firstTileOf.has(t.participant_id)) firstTileOf.set(t.participant_id, t.id);
  }
  const links = matches
    .map((m) => {
      const a = firstTileOf.get(m.participant_id_a);
      const b = firstTileOf.get(m.participant_id_b);
      if (!a || !b) return null;
      return { id: m.id, a: cellOf.get(a)!, b: cellOf.get(b)! };
    })
    .filter((l): l is { id: string; a: number; b: number } => l !== null);

  const center = (index: number) => ({
    x: ((index % columns) + 0.5) / columns,
    y: (Math.floor(index / columns) + 0.5) / Math.max(1, Math.ceil(tiles.length / columns)),
  });

  if (tiles.length === 0) {
    return (
      <div className={className ?? "h-full w-full"}>
        <p className="flex h-full items-center justify-center text-sm text-white/40">
          まだタイルがありません。感想が記録されると、ここに1枚ずつ増えていきます。
        </p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div
        className="grid h-full w-full gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {tiles.map((t) => (
          <div
            key={t.id}
            className={`animate-tile-appear relative aspect-square rounded-md ${
              matchedParticipants.has(t.participant_id)
                ? "bg-amber-300/10 ring-1 ring-amber-300/60"
                : "bg-white/[0.03]"
            }`}
          >
            <Sigil
              seed={t.id}
              toneLabel={toneByStimulus.get(t.stimulus_id) ?? null}
              glow={matchedParticipants.has(t.participant_id)}
            />
          </div>
        ))}
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {links.map((l) => {
          const a = center(l.a);
          const b = center(l.b);
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#F2A65A"
              strokeWidth={0.004}
              className="animate-resonance-line"
            />
          );
        })}
      </svg>
    </div>
  );
}
