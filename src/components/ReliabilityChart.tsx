"use client";

import { useState } from "react";

interface Bin {
  n: number;
  meanPred: number;
  actual: number;
}

interface Series {
  name: string;
  color: string; // CSS color (use a var())
  bins: Bin[];
}

/**
 * Reliability diagram: predicted probability (x) vs how often it actually happened (y).
 * Honest probabilities sit on the dashed diagonal; points far from it are over- or under-confident.
 */
export default function ReliabilityChart({ series, height = 300 }: { series: Series[]; height?: number }) {
  const [hover, setHover] = useState<{ s: number; b: number } | null>(null);
  const W = 420, H = height, pad = { l: 44, r: 16, t: 12, b: 36 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (v: number) => pad.l + v * iw;
  const y = (v: number) => pad.t + (1 - v) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hv = hover ? { ...series[hover.s].bins[hover.b], name: series[hover.s].name } : null;

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 mb-2">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-muted">
          <span className="inline-block w-4" style={{ borderTop: "1.5px dashed var(--muted)" }} aria-hidden />
          Perfectly honest
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Calibration chart: predicted vs actual probability of an up move">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{t * 100}%</text>
              <text x={x(t)} y={H - pad.b + 14} textAnchor="middle" fontSize={10} fill="var(--muted)">{t * 100}%</text>
            </g>
          ))}
          <text x={x(0.5)} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--text-2)">Predicted chance of an up move</text>
          <text x={10} y={y(0.5)} textAnchor="middle" fontSize={10} fill="var(--text-2)" transform={`rotate(-90 10 ${y(0.5)})`}>
            Actually went up
          </text>
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" />
          {series.map((s, si) => {
            const pts = s.bins.filter((b) => b.n >= 20);
            return (
              <g key={s.name}>
                <path
                  d={pts.map((b, i) => `${i ? "L" : "M"}${x(b.meanPred)},${y(b.actual)}`).join("")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {pts.map((b) => {
                  const bi = s.bins.indexOf(b);
                  const on = hover?.s === si && hover.b === bi;
                  return (
                    <g key={bi} onMouseEnter={() => setHover({ s: si, b: bi })} onMouseLeave={() => setHover(null)}>
                      <circle cx={x(b.meanPred)} cy={y(b.actual)} r={12} fill="transparent" />
                      <circle cx={x(b.meanPred)} cy={y(b.actual)} r={on ? 6 : 4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        {hv && (
          <div
            className="pointer-events-none absolute rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] shadow-md tabular"
            style={{ left: `${(x(hv.meanPred) / W) * 100}%`, top: `${(y(hv.actual) / H) * 100}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
          >
            <div className="font-medium text-ink">{hv.name}</div>
            <div className="text-ink-2">Predicted {(hv.meanPred * 100).toFixed(1)}% up</div>
            <div className="text-ink-2">Actually up {(hv.actual * 100).toFixed(1)}%</div>
            <div className="text-muted">{hv.n.toLocaleString()} tests</div>
          </div>
        )}
      </div>
    </div>
  );
}
