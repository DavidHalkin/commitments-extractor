import { NextResponse } from "next/server";
import { Runs } from "@/lib/runs/runs";
import type { Report, Transcript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const [report, transcript] = await Promise.all([
    runs.getJson<Report>(id, "report.json"),
    runs.getJson<Transcript>(id, "transcript.json"),
  ]);
  const wantRaw = new URL(req.url).searchParams.get("raw") === "1";
  const raw = wantRaw
    ? { deepgram: await runs.getJson(id, "raw/deepgram.json"), llm: await runs.getJson(id, "raw/llm.json") }
    : undefined;
  return NextResponse.json({ run, report, transcript, raw });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await new Runs().delete(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
