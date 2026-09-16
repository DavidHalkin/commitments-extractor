import { NextResponse } from "next/server";
import { EXTRACT_MODEL } from "@/lib/extract/claude";
import { checkSize } from "@/lib/gate/classify";
import { rejectionMessage } from "@/lib/limits";
import { Runs } from "@/lib/runs/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { fileName?: unknown; sizeBytes?: unknown; declaredType?: unknown } | null;
  if (!body || typeof body.fileName !== "string" || typeof body.sizeBytes !== "number") {
    return NextResponse.json({ error: "fileName and sizeBytes are required" }, { status: 400 });
  }
  const code = checkSize(body.sizeBytes);
  if (code) return NextResponse.json({ error: rejectionMessage(code), code }, { status: 400 });
  const { run, upload } = await new Runs().create(
    {
      name: body.fileName.slice(0, 200),
      sizeBytes: body.sizeBytes,
      declaredType: typeof body.declaredType === "string" ? body.declaredType.slice(0, 100) : "",
    },
    EXTRACT_MODEL,
  );
  return NextResponse.json({ runId: run.id, upload });
}

export async function GET() {
  return NextResponse.json({ runs: await new Runs().list(50) });
}
