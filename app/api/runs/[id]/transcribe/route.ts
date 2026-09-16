import { NextResponse } from "next/server";
import { Runs } from "@/lib/runs/runs";
import { stageTranscribe } from "@/lib/runs/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run: await stageTranscribe(runs, run) });
}
