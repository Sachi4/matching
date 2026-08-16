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

// 感情ハブは動かない衝突体としてシミュレーションに混ぜる
type HubNode = SimulationNodeDatum & { hub: true };
type SimNode = LayoutNode | HubNode;

// viewBoxの高さ。幅は入れ物の比率に合わせて伸びる（横長の /screen でも左右を使い切って字を大きくする）
const VIEW_HEIGHT = 820;
const ASPECT_RANGE = [0.7, 3.2] as const;
// 共鳴した2人にズームするときの倍率
const FOCUS_SCALE = 2.2;
// これ未満の寄りは線を描かない（3本とも薄く出ると三角形が潰れて見える）
const MIN_LINK_WEIGHT = 0.12;
// 1周に並べる人数
const CLUSTER_RING_SIZE = 6;
// 重心へ戻す割合。寄りが偏っていない人ほど中央寄りになる
const CENTROID_PULL = 0.15;
// meIdがないとき（/screen）にラベルを出す共鳴の数
const SCREEN_LABEL_LIMIT = 2;
// 近すぎるラベルは重なって読めないので間引く距離
const LABEL_MIN_DISTANCE = 140;

// 感情ハブを上・右下・左下の順に等間隔で置く（横長なら左右に引き伸ばす）
function buildPoles(tones: GraphTone[], rx: number, ry: number): Pole[] {
  return tones.map((tone, i) => {
    const angle = (-90 + (i * 360) / Math.max(1, tones.length)) * (Math.PI / 180);
    return {
      ...tone,
      x: Math.cos(angle) * rx,
      y: Math.sin(angle) * ry,
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
  const [aspect, setAspect] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // 入れ物の比率に合わせてviewBoxを横に伸ばす（正方形のままだと横長の画面で中央にしか描かれず字が小さい）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(width / height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    const viewWidth =
      VIEW_HEIGHT *
      Math.min(ASPECT_RANGE[1], Math.max(ASPECT_RANGE[0], aspect));
    const rx = viewWidth * 0.3;
    const ry = VIEW_HEIGHT * 0.3;
    const hubRadius = Math.min(rx, ry);
    const clusterRadius = hubRadius * 0.62;
    const clusterStep = hubRadius * 0.4;
    const poles = buildPoles(graph.tones ?? [], rx, ry);
    const poleById = new Map(poles.map((p) => [p.id, p]));

    // 寄ったハブごとに、輪の上の席番号を一人ずつ割り当てる
    const dominantOf = (n: ResonanceGraph["nodes"][number]) => {
      if (n.dominant_tone_id && poleById.has(n.dominant_tone_id)) {
        return n.dominant_tone_id;
      }
      const weights = Object.entries(n.tone_weights ?? {}).filter(([id]) =>
        poleById.has(id),
      );
      return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const seatIndex = new Map<string, number>();
    const seatCount = new Map<string, number>();
    for (const n of graph.nodes) {
      const toneId = dominantOf(n);
      if (!toneId) continue;
      const seat = seatCount.get(toneId) ?? 0;
      seatIndex.set(n.id, seat);
      seatCount.set(toneId, seat + 1);
    }

    const nodes: LayoutNode[] = graph.nodes.map((n, i) => {
      const weights = Object.entries(n.tone_weights ?? {}).filter(([id]) =>
        poleById.has(id),
      );
      const total = weights.reduce((sum, [, w]) => sum + w, 0);
      const dominantToneId = dominantOf(n);
      const hub = dominantToneId ? poleById.get(dominantToneId)! : null;
      // トーン情報が無い（古いキャッシュ）ときは円周に均等に置くだけにする
      const fallbackAngle =
        (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const centroid =
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
              x: Math.cos(fallbackAngle) * rx * 0.6,
              y: Math.sin(fallbackAngle) * ry * 0.6,
            };
      // 重心そのままだと全員の寄りが似ているときに中央で団子になって名前が読めない。
      // いちばん響いた感情のハブを囲む輪に一人ずつ席を割り当て、重心へ少しだけ引き戻す
      let anchor = centroid;
      if (hub) {
        const seat = seatIndex.get(n.id) ?? 0;
        const ring = Math.floor(seat / CLUSTER_RING_SIZE);
        const slot = seat % CLUSTER_RING_SIZE;
        const angle =
          ((slot + (ring % 2) * 0.5) / CLUSTER_RING_SIZE) * Math.PI * 2;
        const radius = clusterRadius + ring * clusterStep;
        const seated = {
          x: hub.x + Math.cos(angle) * radius,
          y: hub.y + Math.sin(angle) * radius,
        };
        anchor = {
          x: seated.x + (centroid.x - seated.x) * CENTROID_PULL,
          y: seated.y + (centroid.y - seated.y) * CENTROID_PULL,
        };
      }

      return {
        id: n.id,
        nickname: n.nickname,
        response_count: n.response_count,
        toneWeights: weights.map(([id, w]) => [id, total > 0 ? w / total : 0]),
        dominantToneId,
        ax: anchor.x,
        ay: anchor.y,
        x: anchor.x,
        y: anchor.y,
      };
    });

    // 重心が同じ人同士が重なるので、アンカーに引き寄せつつ衝突だけ解く。
    // ハブは動かない衝突体として混ぜて、参加者の名前が感情名に被らないようにする
    const nodeRadius = large ? 46 : 34;
    const hubs: SimNode[] = poles.map((p) => ({
      hub: true,
      x: p.x,
      y: p.y,
      fx: p.x,
      fy: p.y,
    }));
    forceSimulation<SimNode>([...nodes, ...hubs])
      .force(
        "x",
        forceX<SimNode>((d) => ("hub" in d ? (d.x ?? 0) : d.ax)).strength(0.6),
      )
      .force(
        "y",
        forceY<SimNode>((d) => ("hub" in d ? (d.y ?? 0) : d.ay)).strength(0.6),
      )
      .force("charge", forceManyBody().strength(-24))
      .force(
        "collide",
        forceCollide<SimNode>((d) =>
          "hub" in d ? hubRadius * 0.45 + nodeRadius : nodeRadius,
        ),
      )
      .stop()
      .tick(300);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const matched: GraphEdge[] = graph.edges.filter(
      (e) => e.matched && byId.has(e.a) && byId.has(e.b),
    );

    return {
      poles,
      poleById,
      nodes,
      byId,
      matched,
      viewWidth,
      hubRadius,
    };
  }, [graph, large, aspect]);

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
  const isMine = (l: GraphEdge) => !!meId && (l.a === meId || l.b === meId);

  // 成立したペアは多いので、ラベルは「自分の共鳴」「いま光った共鳴」「共鳴度が高いもの」に絞る。
  // 近すぎるものは文字が重なって読めなくなるので間引く
  const labeled = useMemo(() => {
    const relevant = layout.matched.filter(
      (l) =>
        (!!meId && (l.a === meId || l.b === meId)) ||
        (!!focus &&
          (focus.a === l.a || focus.a === l.b) &&
          (focus.b === l.a || focus.b === l.b)),
    );
    const rest = [...layout.matched]
      .filter((l) => !relevant.includes(l))
      .sort((a, b) => (b.score ?? b.resonance) - (a.score ?? a.resonance));
    const candidates = meId
      ? relevant
      : [...relevant, ...rest.slice(0, SCREEN_LABEL_LIMIT)];

    const placed: { x: number; y: number }[] = [];
    return candidates.filter((l) => {
      const a = layout.byId.get(l.a)!;
      const b = layout.byId.get(l.b)!;
      const mid = {
        x: ((a.x ?? 0) + (b.x ?? 0)) / 2,
        y: ((a.y ?? 0) + (b.y ?? 0)) / 2,
      };
      const clash = placed.some(
        (p) => Math.hypot(p.x - mid.x, p.y - mid.y) < LABEL_MIN_DISTANCE,
      );
      if (clash) return false;
      placed.push(mid);
      return true;
    });
  }, [layout, meId, focus]);

  return (
    <div ref={containerRef} className={className ?? "h-full w-full"}>
      {!hasData ? (
        <p className="flex h-full items-center justify-center text-center text-sm text-white/40">
          まだ誰もいません。感想が集まると、3つの感情のまわりに広がります。
        </p>
      ) : (
        <svg
          viewBox={`${-layout.viewWidth / 2} ${-VIEW_HEIGHT / 2} ${layout.viewWidth} ${VIEW_HEIGHT}`}
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
                r={layout.hubRadius * 0.85}
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
                  strokeWidth={isMine(l) ? 6 : 3}
                  strokeOpacity={isMine(l) ? 0.95 : 0.5}
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
                  {/* 誰がどこにいるかが分からないと読めないので、名前は常に出す */}
                  <text
                    x={n.x}
                    y={(n.y ?? 0) + r + (large ? 24 : 20)}
                    textAnchor="middle"
                    fill={isMe || highlighted ? "#ffffff" : "rgba(255,255,255,0.85)"}
                    fontSize={large ? 22 : 18}
                    fontWeight={isMe || highlighted ? 700 : 500}
                    stroke="#0b0a11"
                    strokeWidth={4}
                    strokeOpacity={0.85}
                    paintOrder="stroke"
                  >
                    {isMe ? `${n.nickname}（あなた）` : n.nickname}
                  </text>
                </g>
              );
            })}

            {/* 成立したペアの線に「共鳴度％＋どの感情で共鳴したか」を出す */}
            {labeled.map((l) => {
              const a = layout.byId.get(l.a)!;
              const b = layout.byId.get(l.b)!;
              const tone = l.decisive_tone_id
                ? layout.poleById.get(l.decisive_tone_id)
                : null;
              const score = Math.round((l.score ?? l.resonance) * 100);
              return (
                <text
                  key={`match-label-${l.a}-${l.b}`}
                  x={((a.x ?? 0) + (b.x ?? 0)) / 2}
                  y={((a.y ?? 0) + (b.y ?? 0)) / 2 - 6}
                  textAnchor="middle"
                  fill="#F2A65A"
                  fontSize={large ? 22 : 18}
                  fontWeight={700}
                  stroke="#0b0a11"
                  strokeWidth={4}
                  strokeOpacity={0.85}
                  paintOrder="stroke"
                >
                  {tone ? `${score}% ・ ${tone.label}` : `${score}%`}
                </text>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
