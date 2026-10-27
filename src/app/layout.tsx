import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import NewsAlerts from "@/components/NewsAlerts";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FX Compass — Forex markets & analyzer",
  description: "Forex markets overview with technical + fundamental bull/bear analysis",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Browser extensions (Grammarly, password managers, dark-mode tools) inject attributes into
    // <html>/<body> before React hydrates; ignore those. This only applies to these two tags.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 min-h-14 py-2 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold tracking-tight text-lg">
              <span className="text-bull">▲</span>
              <span className="text-bear">▼</span> <span className="whitespace-nowrap">FX Compass</span>
            </Link>
            <nav className="order-3 sm:order-none w-full sm:w-auto flex gap-1 text-sm overflow-x-auto">
              <Link href="/" className="px-3 py-1.5 rounded-md hover:bg-surface-2">Markets</Link>
              <Link href="/top" className="px-3 py-1.5 rounded-md hover:bg-surface-2">Top Picks</Link>
              <Link href="/analyzer" className="px-3 py-1.5 rounded-md hover:bg-surface-2">Analyzer</Link>
              <Link href="/news" className="px-3 py-1.5 rounded-md hover:bg-surface-2">News</Link>
              <Link href="/performance" className="px-3 py-1.5 rounded-md hover:bg-surface-2">Performance</Link>
            </nav>
            <div className="ml-auto">
              <NewsAlerts />
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
        <footer className="border-t border-line text-xs text-muted">
          <div className="mx-auto max-w-7xl px-4 py-4">
            Educational tool, not financial advice. Probabilities are model estimates from polled indicator votes and news
            sentiment — markets can and do move against them. Prices: Yahoo Finance (delayed). News: Finnhub & central-bank RSS.
          </div>
        </footer>
      </body>
    </html>
  );
}
