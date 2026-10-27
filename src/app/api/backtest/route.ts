import { NextResponse } from "next/server";
import { ensureBacktest, getBacktestStatus } from "@/lib/backtest/run";
import { getBacktest } from "@/lib/backtest/model";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureBacktest(new URL(req.url).searchParams.get("run") === "1");
  return NextResponse.json({ status: getBacktestStatus(), result: getBacktest() });
}
