import { fileTypeFromBlob } from "file-type";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS, rejectionMessage, type RejectionCode } from "@/lib/limits";

export type ClientCheck =
  | { ok: true; format: string; durationSec: number | null }
  | { ok: false; code: RejectionCode; message: string };

const fail = (code: RejectionCode, detail?: string): ClientCheck => ({ ok: false, code, message: rejectionMessage(code, detail) });

function probeMedia(url: string): Promise<{ duration: number | null; hasVideo: boolean } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (r: { duration: number | null; hasVideo: boolean } | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : null, hasVideo: v.videoWidth > 0 });
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** Fast browser-side feedback. The server repeats every check on the stored bytes. */
export async function clientFileCheck(file: File, objectUrl: string): Promise<ClientCheck> {
  const sizeCode = checkSize(file.size);
  if (sizeCode) return fail(sizeCode);
  const ft = await fileTypeFromBlob(file);
  const container = checkContainer(ft);
  if (container.code || !ft) return fail(container.code ?? "not_audio", container.detail);
  const probe = await probeMedia(objectUrl);
  if (!probe) return fail("unreadable");
  if (probe.hasVideo) return fail("contains_video", ft.ext.toUpperCase());
  const durationCode = checkDuration(probe.duration, LIMITS.maxDurationSec);
  if (durationCode) return fail(durationCode, `${probe.duration?.toFixed(1)} s`);
  return { ok: true, format: ft.ext, durationSec: probe.duration };
}
