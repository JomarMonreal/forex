import { NextResponse } from "next/server";
import { getTrackSummary } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getTrackSummary());
}
