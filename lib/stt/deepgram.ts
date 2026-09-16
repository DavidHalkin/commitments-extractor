import { toArrayBuffer } from "@/lib/bytes";
import type { Transcript } from "@/lib/types";

export const DEEPGRAM_QUERY =
  "model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true";

type DgWord = { word: string; punctuated_word?: string; start: number; end: number; speaker?: number };
type DgUtterance = { start: number; end: number; transcript: string; speaker?: number; words: DgWord[] };
export type DeepgramResponse = { metadata: { duration: number }; results: { utterances?: DgUtterance[] } };

export function normalizeDeepgram(raw: DeepgramResponse): Transcript {
  const sorted = [...(raw.results.utterances ?? [])].sort((a, b) => a.start - b.start);
  const utterances = sorted.map((u, i) => ({
    id: `u${i + 1}`,
    speaker: u.speaker ?? 0,
    start: u.start,
    end: u.end,
    text: u.transcript,
    words: u.words.map((w) => ({ word: w.word, punctuated: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
  }));
  const counts = new Map<number, number>();
  for (const u of utterances) counts.set(u.speaker, (counts.get(u.speaker) ?? 0) + u.words.length);
  return {
    durationSec: raw.metadata.duration,
    utterances,
    speakerStats: [...counts]
      .map(([speaker, wordCount]) => ({ speaker, wordCount }))
      .sort((a, b) => a.speaker - b.speaker),
  };
}

export async function transcribeBytes(
  bytes: Uint8Array,
  contentType: string,
  apiKey = process.env.DEEPGRAM_API_KEY,
): Promise<{ transcript: Transcript; raw: DeepgramResponse }> {
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DEEPGRAM_QUERY}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
    body: toArrayBuffer(bytes),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const raw = (await res.json()) as DeepgramResponse;
  return { transcript: normalizeDeepgram(raw), raw };
}
