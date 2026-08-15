// 「印」: 回答ごとに決定的に生成される有機的な図形。
// 同じ回答（同じseed）なら、いつどこで描いても必ず同じ形・同じ色になる。
// 色はその回答が紐づくトーンのパレットから、形はseedのハッシュから決まる。

export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export type SigilSpec = {
  /** 外側の輪郭（viewBox -50 -50 100 100 の座標系） */
  outer: string;
  /** 内側の重なり合う輪郭 */
  inner: string;
  /** 輪郭のまわりに散る小さな点 */
  dots: { x: number; y: number; r: number }[];
  colors: [string, string, string];
  rotation: number;
};

function blobPath(
  rand: () => number,
  radius: number,
  lobes: number,
  wobble: number,
  phase: number,
): string {
  const steps = 72;
  const secondary = 0.35 + rand() * 0.5;
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r =
      radius *
      (1 +
        wobble * Math.sin(lobes * t + phase) +
        wobble * secondary * Math.sin((lobes + 3) * t - phase * 1.7));
    points.push(
      `${(Math.cos(t) * r).toFixed(2)},${(Math.sin(t) * r).toFixed(2)}`,
    );
  }
  return `M${points.join("L")}Z`;
}

export function sigilSpec(seed: string, palette: string[]): SigilSpec {
  const rand = seededRandom(seed);
  const lobes = 3 + Math.floor(rand() * 5);
  const wobble = 0.1 + rand() * 0.22;
  const phase = rand() * Math.PI * 2;
  const outer = blobPath(rand, 40, lobes, wobble, phase);
  const inner = blobPath(rand, 24, lobes + 1 + Math.floor(rand() * 2), wobble * 1.4, phase * 0.6);

  const dotCount = 3 + Math.floor(rand() * 5);
  const dots = Array.from({ length: dotCount }, () => {
    const t = rand() * Math.PI * 2;
    const d = 30 + rand() * 18;
    return {
      x: Number((Math.cos(t) * d).toFixed(2)),
      y: Number((Math.sin(t) * d).toFixed(2)),
      r: Number((0.8 + rand() * 2.2).toFixed(2)),
    };
  });

  const offset = Math.floor(rand() * palette.length);
  const pick = (i: number) => palette[(offset + i) % palette.length];

  return {
    outer,
    inner,
    dots,
    colors: [pick(0), pick(1), pick(2)],
    rotation: Math.floor(rand() * 360),
  };
}
