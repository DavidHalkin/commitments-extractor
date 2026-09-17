import { toArrayBuffer } from "@/lib/bytes";
import type { Transcript } from "@/lib/types";

export const DEEPGRAM_QUERY =
  "model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true";

type DgWord = { word: string; punctuated_word?: string; start: number; end: number; speaker?: number };
type DgUtterance = { start: number; end: number; transcript: string; speaker?: number; words: DgWord[] };
export type DeepgramResponse = { metadata: { duration: number }; results: { utterances?: DgUtterance[] } };

/** Deepgram labels every word with a speaker but sometimes groups two speakers into one utterance; each run of
 * consecutive words with the same speaker becomes its own utterance. Words without a label continue the current run. */
function speakerRuns(u: DgUtterance): { speaker: number; words: DgWord[] }[] {
  const runs: { speaker: number; words: DgWord[] }[] = [];
  for (const w of u.words) {
    const last = runs[runs.length - 1];
    const speaker = w.speaker ?? last?.speaker ?? u.speaker ?? 0;
    if (last && last.speaker === speaker) last.words.push(w);
    else runs.push({ speaker, words: [w] });
  }
  return runs;
}

/** Deepgram ends an utterance after 0.8 s of silence, so a shorter gap between two segments of the same
 * speaker is one turn that only speaker labels split apart. Keeping it whole keeps its sentences quotable. */
const TURN_GAP_SEC = 0.8;

type Segment = { speaker: number; text: string | null; words: DgWord[] };

export function normalizeDeepgram(raw: DeepgramResponse): Transcript {
  const sorted = [...(raw.results.utterances ?? [])].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  for (const u of sorted) {
    const runs = speakerRuns(u);
    for (const r of runs) {
      const last = segments[segments.length - 1];
      const gap = last ? r.words[0].start - last.words[last.words.length - 1].end : Infinity;
      if (last && last.speaker === r.speaker && gap < TURN_GAP_SEC) {
        last.words.push(...r.words);
        last.text = null;
      } else {
        // A whole utterance kept by one speaker keeps its smart-formatted transcript as recognized.
        segments.push({ speaker: r.speaker, text: runs.length === 1 ? u.transcript : null, words: r.words });
      }
    }
  }
  const utterances = segments.map((seg, i) => ({
    id: `u${i + 1}`,
    speaker: seg.speaker,
    start: seg.words[0].start,
    end: seg.words[seg.words.length - 1].end,
    text: seg.text ?? seg.words.map((w) => w.punctuated_word ?? w.word).join(" "),
    words: seg.words.map((w) => ({ word: w.word, punctuated: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
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
