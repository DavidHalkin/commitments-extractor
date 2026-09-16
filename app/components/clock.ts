/** UI-only m:ss clock (e.g. 0:42, 2:05). `lib/format.ts` keeps its mm:ss formatter for data exports. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
