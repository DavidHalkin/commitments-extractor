import type { Transcript, Utterance } from "@/lib/types";

/** Builds a transcript with evenly spaced word timings: each word 0.3 s, 0.05 s gap, 0.5 s between utterances. */
export function makeTranscript(lines: [number, string][]): Transcript {
  let t = 0;
  const utterances: Utterance[] = lines.map(([speaker, text], i) => {
    const words = text
      .split(/\s+/)
      .filter(Boolean)
      .map((punctuated) => {
        const w = { word: punctuated.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""), punctuated, start: t, end: t + 0.3 };
        t += 0.35;
        return w;
      });
    t += 0.5;
    return { id: `u${i + 1}`, speaker, start: words[0].start, end: words[words.length - 1].end, text, words };
  });
  const counts = new Map<number, number>();
  for (const u of utterances) counts.set(u.speaker, (counts.get(u.speaker) ?? 0) + u.words.length);
  return {
    durationSec: t,
    utterances,
    speakerStats: [...counts].map(([speaker, wordCount]) => ({ speaker, wordCount })),
  };
}
