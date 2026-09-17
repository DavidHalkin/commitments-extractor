import { NextResponse } from "next/server";
import { deleteExpiredRuns } from "@/lib/runs/cleanup";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called daily by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ deleted: await deleteExpiredRuns(getStore()) });
}
