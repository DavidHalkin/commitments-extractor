export const LIMITS = {
  minBytes: 1024,
  maxBytes: 35 * 1024 * 1024,
  minDurationSec: 3,
  maxDurationSec: 180,
  serverMaxDurationSec: 185,
} as const;

export const REJECTION_CODES = [
  "file_too_small",
  "file_too_large",
  "not_audio",
  "contains_video",
  "too_long",
  "too_short",
  "unreadable",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "mp4", "webm", "mkv", "ogg", "oga", "opus", "flac",
]);

export function rejectionMessage(code: RejectionCode, detail?: string): string {
  switch (code) {
    case "file_too_small":
      return "The file is empty or too small to be a recording (minimum 1 KB).";
    case "file_too_large":
      return "The file is larger than 35 MB.";
    case "not_audio":
      return `This is not an audio file${detail ? ` (detected: ${detail})` : ""}. Upload MP3, WAV, M4A, WebM, Ogg or FLAC audio.`;
    case "contains_video":
      return `This file contains video${detail ? ` (detected: ${detail} with a video track)` : ""}. Upload an audio-only file.`;
    case "too_long":
      return `The recording is longer than 3 minutes${detail ? ` (${detail})` : ""}.`;
    case "too_short":
      return `The recording is shorter than 3 seconds${detail ? ` (${detail})` : ""}.`;
    case "unreadable":
      return "The file is corrupted or not an audio file.";
  }
}
