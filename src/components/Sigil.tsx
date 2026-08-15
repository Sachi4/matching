"use client";

import { useId, useMemo } from "react";
import { sigilSpec } from "@/lib/sigil";
import { tonePalette } from "@/lib/tones";

// 回答ひとつぶんの「印」。seedが同じなら必ず同じ絵になる
export default function Sigil({
  seed,
  toneLabel,
  className,
  glow,
}: {
  seed: string;
  toneLabel: string | null;
  className?: string;
  glow?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const spec = useMemo(
    () => sigilSpec(seed, tonePalette(toneLabel)),
    [seed, toneLabel],
  );

  return (
    <svg
      viewBox="-50 -50 100 100"
      className={className ?? "h-full w-full"}
      role="img"
      aria-label="この回答の印"
    >
      <defs>
        <radialGradient id={`sg-${uid}`}>
          <stop offset="0%" stopColor={spec.colors[0]} stopOpacity="0.95" />
          <stop offset="60%" stopColor={spec.colors[1]} stopOpacity="0.55" />
          <stop offset="100%" stopColor={spec.colors[2]} stopOpacity="0.15" />
        </radialGradient>
        {glow && (
          <filter id={`gl-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g
        transform={`rotate(${spec.rotation})`}
        filter={glow ? `url(#gl-${uid})` : undefined}
      >
        <path
          d={spec.outer}
          fill={`url(#sg-${uid})`}
          stroke={spec.colors[0]}
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
        <path
          d={spec.inner}
          fill="none"
          stroke={spec.colors[2]}
          strokeOpacity="0.8"
          strokeWidth="0.9"
        />
        {spec.dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={spec.colors[i % 3]}
            fillOpacity="0.85"
          />
        ))}
      </g>
    </svg>
  );
}
