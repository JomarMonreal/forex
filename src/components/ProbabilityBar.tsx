export default function ProbabilityBar({ bull, size = "md", showLabels = true }: { bull: number; size?: "sm" | "md" | "lg"; showLabels?: boolean }) {
  const bear = 100 - bull;
  const h = size === "lg" ? "h-4" : size === "md" ? "h-2.5" : "h-1.5";
  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex justify-between text-xs tabular mb-1">
          <span className="text-ink">
            <span className="text-bull">▲</span> Bull {bull.toFixed(0)}%
          </span>
          <span className="text-ink">
            Bear {bear.toFixed(0)}% <span className="text-bear">▼</span>
          </span>
        </div>
      )}
      <div
        className={`relative flex w-full gap-[2px] ${h}`}
        role="img"
        aria-label={`${bull.toFixed(0)}% bullish, ${bear.toFixed(0)}% bearish`}
        title={`${bull.toFixed(1)}% bullish · ${bear.toFixed(1)}% bearish`}
      >
        <div className="rounded-l bg-bull" style={{ width: `${bull}%` }} />
        <div className="rounded-r bg-bear" style={{ width: `${bear}%` }} />
        {/* 50% reference tick */}
        <div className="absolute left-1/2 -top-0.5 -bottom-0.5 w-px bg-ink/40" />
      </div>
    </div>
  );
}
