import { AUDIO_EXTENSIONS, LIMITS, type RejectionCode } from "@/lib/limits";

export function checkSize(n: number): RejectionCode | null {
  if (n < LIMITS.minBytes) return "file_too_small";
  if (n > LIMITS.maxBytes) return "file_too_large";
  return null;
}

export function checkContainer(
  ft: { ext: string; mime: string } | undefined,
): { code: RejectionCode | null; detail?: string } {
  if (!ft) return { code: "not_audio" };
  if (AUDIO_EXTENSIONS.has(ft.ext)) return { code: null };
  if (ft.mime.startsWith("video/")) return { code: "contains_video", detail: ft.ext.toUpperCase() };
  return { code: "not_audio", detail: ft.ext.toUpperCase() };
}

export function checkDuration(sec: number | null, max: number): RejectionCode | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  if (sec < LIMITS.minDurationSec) return "too_short";
  if (sec > max) return "too_long";
  return null;
}
