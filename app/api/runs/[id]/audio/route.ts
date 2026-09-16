import { NextResponse } from "next/server";
import { toArrayBuffer } from "@/lib/bytes";
import { Runs } from "@/lib/runs/runs";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const url = await runs.audioDownloadUrl(id);
  if (url) return NextResponse.redirect(url, 302);
  const bytes = await getStore().get(runs.audioKey(id));
  if (!bytes) return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  return new NextResponse(toArrayBuffer(bytes), {
    headers: { "Content-Type": run.file.mime ?? "application/octet-stream", "Content-Length": String(bytes.byteLength) },
  });
}
