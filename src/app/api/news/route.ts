import { NextResponse } from "next/server";
import { getNews, getStatus, pollOnce } from "@/lib/news/poller";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ccy = params.get("ccy")?.split(",").filter(Boolean);
  if (params.get("refresh")) await pollOnce();
  const items = await getNews({ currencies: ccy, limit: Number(params.get("limit") ?? 150) });
  return NextResponse.json({ items, status: getStatus() });
}
