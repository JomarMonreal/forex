"use client";

import { useEffect, useState } from "react";

// Approximate trading-session hours in UTC.
const SESSIONS = [
  { name: "Sydney", open: 21, close: 6 },
  { name: "Tokyo", open: 0, close: 9 },
  { name: "London", open: 7, close: 16 },
  { name: "New York", open: 12, close: 21 },
];

const isOpen = (h: number, o: number, c: number) => (o < c ? h >= o && h < c : h >= o || h < c);

export default function Sessions() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const day = now.getUTCDay();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  // FX is closed from Friday 21:00 UTC to Sunday 21:00 UTC.
  const weekend = day === 6 || (day === 5 && h >= 21) || (day === 0 && h < 21);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">Sessions (UTC {now.toISOString().slice(11, 16)}):</span>
      {SESSIONS.map((s) => {
        const open = !weekend && isOpen(h, s.open, s.close);
        return (
          <span key={s.name} className={`rounded-full border px-2.5 py-1 ${open ? "border-bull text-bull" : "border-line text-muted"}`}>
            {open ? "● " : "○ "}
            {s.name} {open ? "open" : "closed"}
          </span>
        );
      })}
      {weekend && <span className="text-warn">Market closed for the weekend</span>}
    </div>
  );
}
