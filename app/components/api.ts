import type { Report, Run, Transcript } from "@/lib/types";

export type RunDetail = {
  run: Run;
  report: Report | null;
  transcript: Transcript | null;
  raw?: { deepgram: unknown; claude: unknown };
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
