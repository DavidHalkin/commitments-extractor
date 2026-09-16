import { fileTypeFromBuffer } from "file-type";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS, rejectionMessage, type RejectionCode } from "@/lib/limits";

export type FileCheckOk = {
  ok: true;
  detectedFormat: string;
  mime: string;
  durationSec: number | null;
  hasVideo: false;
};

export type FileCheckFail = {
  ok: false;
  code: RejectionCode;
  message: string;
  detectedFormat: string | null;
  mime: string | null;
  durationSec: number | null;
  hasVideo: boolean | null;
};

/** ISO-BMFF `hdlr` box: [size:4]["hdlr"][version+flags:4][pre_defined:4][handler_type:4]. */
export function mp4HasVideoHandler(bytes: Uint8Array): boolean {
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (bytes[i] === 0x68 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x6c && bytes[i + 3] === 0x72) {
      if (String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]) === "vide") return true;
    }
  }
  return false;
}

function fail(code: RejectionCode, extra: Partial<FileCheckFail> = {}, detail?: string): FileCheckFail {
  return {
    ok: false,
    code,
    message: rejectionMessage(code, detail),
    detectedFormat: null,
    mime: null,
    durationSec: null,
    hasVideo: null,
    ...extra,
  };
}

export async function checkAudioFile(bytes: Uint8Array): Promise<FileCheckOk | FileCheckFail> {
  const sizeCode = checkSize(bytes.byteLength);
  if (sizeCode) return fail(sizeCode);

  const ft = await fileTypeFromBuffer(bytes);
  const container = checkContainer(ft);
  if (container.code || !ft) {
    return fail(container.code ?? "not_audio", { detectedFormat: ft?.ext ?? null, mime: ft?.mime ?? null }, container.detail);
  }
  const detectedFormat = ft.ext;
  const mime = ft.mime;

  // Dynamic import keeps music-metadata on Node's native ESM loader: under tsx's CommonJS
  // transform (eval scripts) its default import of content-type, an __esModule build without
  // `default`, resolves to undefined and every file parses as unreadable.
  const { parseBuffer } = await import("music-metadata");
  let meta: Awaited<ReturnType<typeof parseBuffer>>;
  try {
    meta = await parseBuffer(bytes, { mimeType: mime, size: bytes.byteLength }, { duration: true });
  } catch {
    return fail("unreadable", { detectedFormat, mime });
  }

  const isoBmff = detectedFormat === "mp4" || detectedFormat === "m4a";
  const hasVideo =
    meta.format.hasVideo === true ||
    meta.format.trackInfo.some((t) => t.video != null) ||
    (isoBmff && mp4HasVideoHandler(bytes));
  if (hasVideo) return fail("contains_video", { detectedFormat, mime, hasVideo: true }, detectedFormat.toUpperCase());

  const durationSec = meta.format.duration ?? null;
  const durationCode = checkDuration(durationSec, LIMITS.serverMaxDurationSec);
  if (durationCode) {
    return fail(durationCode, { detectedFormat, mime, durationSec, hasVideo: false }, `${durationSec?.toFixed(1)} s`);
  }
  return { ok: true, detectedFormat, mime, durationSec, hasVideo: false };
}
