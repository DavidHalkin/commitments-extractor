import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/limits";
import { Runs } from "@/lib/runs/runs";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.STORE_DRIVER === "gcs") return NextResponse.json({ error: "Not available" }, { status: 404 });
  const { id } = await params;
  const runs = new Runs();
  if (!(await runs.get(id))) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > LIMITS.maxBytes) return NextResponse.json({ error: "File too large" }, { status: 413 });
  await getStore().put(runs.audioKey(id), bytes, "application/octet-stream");
  return NextResponse.json({ ok: true });
}
