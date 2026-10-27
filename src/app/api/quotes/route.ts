import { NextResponse } from "next/server";
import { PAIRS } from "@/lib/pairs";
import { getQuote, type Quote } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.allSettled(PAIRS.map((p) => getQuote(p.symbol)));
  const quotes: Record<string, Quote> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes[PAIRS[i].symbol] = r.value;
  });
  return NextResponse.json({ quotes, at: Date.now() });
}
