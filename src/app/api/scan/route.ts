import { NextResponse } from "next/server";
import { ensureScan, getScanState } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureScan(new URL(req.url).searchParams.get("force") === "1");
  return NextResponse.json(getScanState());
}
