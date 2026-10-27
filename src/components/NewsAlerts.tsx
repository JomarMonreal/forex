"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Alert {
  id: string;
  title: string;
  url: string;
  source: string;
  currencies: string[];
}

/**
 * Subscribes to the server's news stream (SSE). Every time the poller finds a genuinely
 * new article it shows a toast and, if permitted, a desktop notification.
 */
export default function NewsAlerts() {
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [live, setLive] = useState(false);

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    const es = new EventSource("/api/news/stream");
    es.addEventListener("hello", () => setLive(true));
    es.onerror = () => setLive(false);
    es.addEventListener("news", (e) => {
      const items = JSON.parse((e as MessageEvent).data) as Alert[];
      setUnread((n) => n + items.length);
      setToasts((t) => [...items.slice(0, 3), ...t].slice(0, 4));
      items.slice(0, 3).forEach((it) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== it.id)), 12000));
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const first = items[0];
        const n = new Notification(items.length > 1 ? `${items.length} new forex headlines` : `New: ${first.currencies.join("/") || "FX"}`, {
          body: first.title,
          tag: "fx-news",
        });
        n.onclick = () => window.open(first.url, "_blank");
      }
    });
    return () => es.close();
  }, []);

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <Link
          href="/news"
          onClick={() => setUnread(0)}
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 hover:bg-surface-2"
          title={live ? "Connected to live news poller" : "Reconnecting to news stream…"}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${live ? "bg-bull animate-pulse" : "bg-neutral"}`} />
          {live ? "Live news" : "Offline"}
          {unread > 0 && <span className="rounded-full bg-bear text-white px-1.5 tabular">{unread}</span>}
        </Link>
        {perm === "default" && (
          <button
            onClick={() => Notification.requestPermission().then(setPerm)}
            className="rounded-full border border-line px-3 py-1 hover:bg-surface-2"
          >
            Enable alerts
          </button>
        )}
      </div>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(380px,calc(100vw-2rem))]">
        {toasts.map((t) => (
          <a
            key={t.id}
            href={t.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-line bg-surface p-3 shadow-lg hover:bg-surface-2"
          >
            <div className="text-[11px] text-muted flex justify-between">
              <span>🔔 {t.source}</span>
              <span>{t.currencies.join(" · ")}</span>
            </div>
            <div className="text-sm mt-1 leading-snug">{t.title}</div>
          </a>
        ))}
      </div>
    </>
  );
}
