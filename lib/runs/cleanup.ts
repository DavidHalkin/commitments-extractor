import { RUN_ID_RE } from "@/lib/runs/runs";
import type { ObjectStore } from "@/lib/store/store";

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Creation time encoded in a run id such as `20260916T132501Z-ab12cd`. */
export function runIdTime(id: string): number {
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/.exec(id)!.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export function expiredRunIds(ids: string[], now: Date, days = RETENTION_DAYS): string[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return ids.filter((id) => RUN_ID_RE.test(id) && runIdTime(id) < cutoff);
}

/** Vercel Blob has no lifecycle rules, so the daily cron deletes expired runs itself. */
export async function deleteExpiredRuns(store: ObjectStore, now: Date = new Date()): Promise<string[]> {
  const expired = expiredRunIds(await store.listDirs("runs/"), now);
  for (const id of expired) await store.deletePrefix(`runs/${id}/`);
  return expired;
}
