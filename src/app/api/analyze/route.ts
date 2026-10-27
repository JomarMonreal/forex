import { NextResponse } from "next/server";
import { analyzePair } from "@/lib/analysis";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pair = new URL(req.url).searchParams.get("pair") ?? "EURUSD";
  try {
    return NextResponse.json(await analyzePair(pair));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
