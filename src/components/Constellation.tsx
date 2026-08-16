"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { getSupabase } from "@/lib/supabase";
import {
  EMPTY_GRAPH,
  type GraphEdge,
  type GraphTone,
  type ResonanceGraph,
} from "@/lib/graph";
import { tonePalette } from "@/lib/tones";
import {
  FOCUS_DURATION,
  FOCUS_EVENT,
  readResonanceFocus,
  type ResonanceFocus,
} from "@/lib/resonanceFocus";

type LayoutNode = SimulationNodeDatum & {
  id: string;
  nickname: string;
  response_count: number;
  toneWeights: [string, number][];
  dominantToneId: string | null;
  // 3感情の重心（この点に引き寄せられる）
  ax: number;
  ay: number;
};

type Pole = GraphTone & { x: number; y: number; color: string };

const VIEW = 1000;
// 感情ハブを置く三角形の外接円半径
const POLE_RADIUS = 300;
// 共鳴した2人にズームするときの倍率
const FOCUS_SCALE = 2.2;
// これ未満の寄りは線を描かない（3本とも薄く出ると三角形が潰れて見える）
const MIN_LINK_WEIGHT = 0.12;

// 感情ハブを上・右下・左下の順に等間隔で置く
function buildPoles(tones: GraphTone[]): Pole[] {
  return tones.map((tone, i) => {
    const angle = (-90 + (i * 360) / Math.max(1, tones.length)) * (Math.PI / 180);
    return {
      ...tone,
      x: Math.cos(angle) * POLE_RADIUS,
      y: Math.sin(angle) * POLE_RADIUS,
      color: tonePalette(tone.label)[0],
    };
  });
}

// レイヤー3: 高揚感・悲しみ・怒りの3つのハブの周囲に参加者を配置した共鳴マップ。
// 参加者は「どの感情でいちばん響き合ったか」の重みで3ハブの重心に置かれるため、
// 特定の感情に強く寄っている人はそのハブの近くに、まんべんなく響く人は中央に集まる。
export default function Constellation({
  meId,
  large,
  className,
}: {
  meId: string | null;
  large?: boolean;
  className?: string;
}) {
  const [graph, setGraph] = useState<ResonanceGraph>(EMPTY_GRAPH);
  const [focus, setFocus] = useState<ResonanceFocus | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // バースト演出のあと、その共鳴の2人にズームして数秒だけハイライトする
  useEffect(() => {
    setFocus(readResonanceFocus());
    const onFocus = (e: Event) => {
      setFocus((e as CustomEvent<ResonanceFocus>).detail);
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const remaining = Math.max(0, FOCUS_DURATION - (Date.now() - focus.at));
    const timer = setTimeout(() => setFocus(null), remaining);
    return () => clearTimeout(timer);
  }, [focus]);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("resonance_graph")
        .select("payload")
        .eq("id", 1)
        .maybeSingle();
      if (!cancelled && data?.payload) {
        setGraph(data.payload as ResonanceGraph);
      }
    })();

    const channel = supabase
      .channel("resonance-graph")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "resonance_graph" },
        (payload) => {
          const row = payload.new as { payload: ResonanceGraph };
          setGraph(row.payload);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // グラフが更新されたときだけレイアウトし直す（毎フレームの再計算はしない）
  const layout = useMemo(() => {
    const poles = buildPoles(graph.tones ?? []);
    const poleById = new Map(poles.map((p) => [p.id, p]));

    const nodes: LayoutNode[] = graph.nodes.map((n, i) => {
      const weights = Object.entries(n.tone_weights ?? {}).filter(([id]) =>
        poleById.has(id),
      );
      const total = weights.reduce((sum, [, w]) => sum + w, 0);
      const strongest = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      // トーン情報が無い（古いキャッシュ）ときは円周に均等に置くだけにする
      const fallbackAngle =
        (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const anchor =
        total > 0
          ? weights.reduce(
              (acc, [id, w]) => {
                const pole = poleById.get(id)!;
                return {
                  x: acc.x + (pole.x * w) / total,
                  y: acc.y + (pole.y * w) / total,
                };
              },
              { x: 0, y: 0 },
            )
          : {
              x: Math.cos(fallbackAngle) * POLE_RADIUS * 0.6,
              y: Math.sin(fallbackAngle) * POLE_RADIUS * 0.6,
            };

      return {
        id: n.id,
        nickname: n.nickname,
        response_count: n.response_count,
        toneWeights: weights.map(([id, w]) => [id, total > 0 ? w / total : 0]),
        dominantToneId:
          n.dominant_tone_id && poleById.has(n.dominant_tone_id)
            ? n.dominant_tone_id
            : strongest,
        ax: anchor.x,
        ay: anchor.y,
        x: anchor.x,
        y: anchor.y,
      };
    });

    // 重心が同じ人同士が重なるので、アンカーに引き寄せつつ衝突だけ解く
    forceSimulation(nodes)
      .force(
        "x",
        forceX<LayoutNode>((d) => d.ax).strength(0.6),
      )
      .force(
        "y",
        forceY<LayoutNode>((d) => d.ay).strength(0.6),
      )
      .force("charge", forceManyBody().strength(-24))
      .force("collide", forceCollide(large ? 26 : 22))
      .stop()
      .tick(300);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const matched: GraphEdge[] = graph.edges.filter(
      (e) => e.matched && byId.has(e.a) && byId.has(e.b),
    );

    return { poles, poleById, nodes, byId, matched };
  }, [graph, large]);

  const hasData = layout.nodes.length > 0;

  const focused = focus
    ? { a: layout.byId.get(focus.a), b: layout.byId.get(focus.b) }
    : null;
  const zoom =
    focused?.a && focused?.b
      ? {
          x: ((focused.a.x ?? 0) + (focused.b.x ?? 0)) / 2,
          y: ((focused.a.y ?? 0) + (focused.b.y ?? 0)) / 2,
        }
      : null;
  const isFocused = (id: string) => !!focus && (focus.a === id || focus.b === id);

  return (
    <div ref={containerRef} className={className ?? "h-full w-full"}>
      {!hasData ? (
        <p className="flex h-full items-center justify-center text-center text-sm text-white/40">
          まだ誰もいません。感想が集まると、3つの感情のまわりに広がります。
        </p>
      ) : (
        <svg
          viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
          className="h-full w-full"
          aria-label="3つの感情の周囲に広がる共鳴マップ"
        >
          <g
            style={{
              transform: zoom
                ? `scale(${FOCUS_SCALE}) translate(${-zoom.x}px, ${-zoom.y}px)`
                : "none",
              transition: "transform 1.2s ease-in-out",
            }}
          >
            {/* 感情ハブの領域（どのあたりがどの感情かを色で示す） */}
            {layout.poles.map((pole) => (
              <circle
                key={`field-${pole.id}`}
                cx={pole.x}
                cy={pole.y}
                r={210}
                fill={pole.color}
                fillOpacity={0.07}
              />
            ))}

            {/* 参加者 → 感情ハブ。寄りが強い感情ほど濃い線でつながる */}
            {layout.nodes.flatMap((n) =>
              n.toneWeights
                .filter(([, w]) => w >= MIN_LINK_WEIGHT)
                .map(([toneId, w]) => {
                  const pole = layout.poleById.get(toneId)!;
                  return (
                    <line
                      key={`tone-${n.id}-${toneId}`}
                      x1={n.x}
                      y1={n.y}
                      x2={pole.x}
                      y2={pole.y}
                      stroke={pole.color}
                      strokeWidth={1}
                      strokeOpacity={focus ? 0.06 : 0.1 + w * 0.35}
                    />
                  );
                }),
            )}

            {/* 共鳴が成立したペア */}
            {layout.matched.map((l) => {
              const a = layout.byId.get(l.a)!;
              const b = layout.byId.get(l.b)!;
              return (
                <line
                  key={`match-${l.a}-${l.b}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#F2A65A"
                  strokeWidth={4}
                  strokeOpacity={0.9}
                  className="animate-resonance-line"
                />
              );
            })}

            {/* 感情ハブ本体 */}
            {layout.poles.map((pole) => (
              <g key={pole.id}>
                <circle
                  cx={pole.x}
                  cy={pole.y}
                  r={large ? 34 : 30}
                  fill={pole.color}
                  fillOpacity={0.9}
                />
                <text
                  x={pole.x}
                  y={pole.y + (large ? 12 : 10)}
                  textAnchor="middle"
                  fill="#16141f"
                  fontSize={large ? 30 : 26}
                  fontWeight={700}
                >
                  {pole.label}
                </text>
              </g>
            ))}

            {layout.nodes.map((n) => {
              const isMe = n.id === meId;
              const highlighted = isFocused(n.id);
              const color = n.dominantToneId
                ? layout.poleById.get(n.dominantToneId)!.color
                : "#A78BC9";
              const base = isMe ? 14 : 8 + Math.min(6, n.response_count);
              const r = highlighted ? base * 1.8 : base;
              return (
                <g key={n.id}>
                  {(isMe || highlighted) && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={r + 10}
                      fill="none"
                      stroke={highlighted ? "#D85A30" : "#ffffff"}
                      strokeOpacity={highlighted ? 1 : 0.4}
                      strokeWidth={highlighted ? 4 : 1}
                    />
                  )}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={highlighted ? "#D85A30" : isMe ? "#ffffff" : color}
                    fillOpacity={
                      highlighted || isMe ? 1 : focus ? 0.25 : 0.85
                    }
                  />
                  {(isMe || large || highlighted) && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) + r + (large ? 22 : 18)}
                      textAnchor="middle"
                      fill={isMe ? "#ffffff" : "rgba(255,255,255,0.6)"}
                      fontSize={large ? 20 : 16}
                    >
                      {isMe ? `${n.nickname}（あなた）` : n.nickname}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
