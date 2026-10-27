"use client";

import { useState } from "react";

export default function Sparkline({ data, up, width = 120, height = 36, digits = 4 }: { data: number[]; up: boolean; width?: number; height?: number; digits?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 2;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const color = up ? "var(--bull)" : "var(--bear)";
  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`24h trend ${up ? "up" : "down"}`}
      >
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && data[hover] != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={x(hover)} cy={y(data[hover])} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      {hover != null && data[hover] != null && (
        <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[11px] text-bg tabular whitespace-nowrap">
          {data[hover].toFixed(digits)}
        </div>
      )}
    </div>
  );
}
