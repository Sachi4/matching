"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { getSupabase } from "@/lib/supabase";
import { EMPTY_GRAPH, type GraphEdge, type ResonanceGraph } from "@/lib/graph";
import {
  FOCUS_DURATION,
  FOCUS_EVENT,
  readResonanceFocus,
  type ResonanceFocus,
} from "@/lib/resonanceFocus";

type LayoutNode = SimulationNodeDatum & {
  id: string;
  nickname: string;
  is_test: boolean;
  response_count: number;
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & GraphEdge;

const VIEW = 1000;
// 共鳴した2人にズームするときの倍率
const FOCUS_SCALE = 2.2;

// 共鳴度が高いほど近くに置く（似ている＝近い）。
// proximity（全ペアの中での相対値）があればそれを使い、無ければ生の共鳴度を使う
function linkDistance(edge: GraphEdge): number {
  const t =
    edge.proximity ??
    Math.min(1, Math.max(0, (edge.resonance - 0.15) / 0.65));
  return 420 - 340 * t;
}

// レイヤー3: 自分を中心に、似ている人ほど近くに配置した星座。
// 座標はバックエンドがキャッシュした類似度をもとに、グラフが更新されたときだけ計算する。
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
    const nodes: LayoutNode[] = graph.nodes.map((n) => ({
      ...n,
      x: 0,
      y: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: LayoutLink[] = graph.edges
      .filter((e) => byId.has(e.a) && byId.has(e.b))
      .map((e) => ({ ...e, source: e.a, target: e.b }));

    const me = meId ? byId.get(meId) : undefined;
    if (me) {
      me.fx = 0;
      me.fy = 0;
    }
    // 自分がいない（大画面ビューなど）ときは、共鳴が多い人を中心に寄せる
    nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      n.x = Math.cos(angle) * 200;
      n.y = Math.sin(angle) * 200;
    });

    forceSimulation(nodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(links)
          .id((d) => d.id)
          .distance((l) => linkDistance(l))
          .strength((l) => (l.matched ? 0.9 : 0.35)),
      )
      .force("charge", forceManyBody().strength(-160))
      .force("collide", forceCollide(28))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.04))
      .stop()
      .tick(400);

    const maxR =
      Math.max(
        1,
        ...nodes.map((n) => Math.hypot(n.x ?? 0, n.y ?? 0)),
      ) || 1;
    const scale = (VIEW / 2 - 60) / maxR;
    for (const n of nodes) {
      n.x = (n.x ?? 0) * scale;
      n.y = (n.y ?? 0) * scale;
    }

    return { nodes, links, byId };
  }, [graph, meId]);

  const hasData = layout.nodes.length > 0;

  const focused = focus
    ? {
        a: layout.byId.get(focus.a),
        b: layout.byId.get(focus.b),
      }
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
          まだ星がありません。感想が集まると、ここに広がります。
        </p>
      ) : (
        <svg
          viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
          className="h-full w-full"
          aria-label="共鳴の星座"
        >
          <g
            style={{
              transform: zoom
                ? `scale(${FOCUS_SCALE}) translate(${-zoom.x}px, ${-zoom.y}px)`
                : "none",
              transition: "transform 1.2s ease-in-out",
            }}
          >
          {layout.links.map((l) => {
            const a = l.source as LayoutNode;
            const b = l.target as LayoutNode;
            return (
              <line
                key={`${l.a}-${l.b}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={l.matched ? "#F2A65A" : "#A78BC9"}
                strokeWidth={l.matched ? 4 : 1}
                strokeOpacity={
                  l.matched ? 0.9 : 0.12 + (l.proximity ?? l.resonance) * 0.2
                }
                className={l.matched ? "animate-resonance-line" : undefined}
              />
            );
          })}

          {layout.links
            .filter((l) => l.matched && l.reaction_phrase)
            .map((l) => {
              const a = l.source as LayoutNode;
              const b = l.target as LayoutNode;
              return (
                <text
                  key={`label-${l.a}-${l.b}`}
                  x={((a.x ?? 0) + (b.x ?? 0)) / 2}
                  y={((a.y ?? 0) + (b.y ?? 0)) / 2 - 8}
                  textAnchor="middle"
                  fill="#F2D14E"
                  fontSize={large ? 22 : 18}
                >
                  「{l.reaction_phrase}」
                </text>
              );
            })}

          {layout.nodes.map((n) => {
            const isMe = n.id === meId;
            const matched = layout.links.some(
              (l) => l.matched && (l.a === n.id || l.b === n.id),
            );
            const highlighted = isFocused(n.id);
            const base = isMe ? 16 : 9 + Math.min(6, n.response_count);
            const r = highlighted ? base * 1.8 : base;
            return (
              <g key={n.id}>
                {highlighted && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r + 14}
                    fill="none"
                    stroke="#D85A30"
                    strokeWidth={4}
                  />
                )}
                {isMe && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r + 12}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={0.35}
                  />
                )}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill={
                    highlighted
                      ? "#D85A30"
                      : isMe
                        ? "#ffffff"
                        : matched
                          ? "#F2A65A"
                          : "#A78BC9"
                  }
                  fillOpacity={
                    highlighted ? 1 : isMe ? 1 : matched ? 0.95 : focus ? 0.25 : 0.6
                  }
                />
                {(isMe || matched || large || highlighted) && (
                  <text
                    x={n.x}
                    y={(n.y ?? 0) + r + (large ? 24 : 20)}
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
