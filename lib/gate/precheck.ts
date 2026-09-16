import { LIMITS } from "@/lib/limits";
import type { Transcript } from "@/lib/types";

function totalWords(t: Transcript): number {
  return t.speakerStats.reduce((sum, s) => sum + s.wordCount, 0);
}

/** Speakers with at least 5% of recognized words, ascending. */
export function significantSpeakers(t: Transcript): number[] {
  const total = totalWords(t);
  if (total === 0) return [];
  return t.speakerStats
    .filter((s) => s.wordCount / total >= 0.05)
    .map((s) => s.speaker)
    .sort((a, b) => a - b);
}

export function precheck(t: Transcript): string[] {
  const reasons: string[] = [];
  if (t.durationSec > LIMITS.serverMaxDurationSec) {
    reasons.push(`Recording is ${Math.round(t.durationSec)} s long; the limit is 3 minutes.`);
  }
  const total = totalWords(t);
  if (total < 20) {
    reasons.push(`Only ${total} words were recognized; there is not enough speech to extract commitments.`);
  } else {
    const n = significantSpeakers(t).length;
    if (n !== 2) reasons.push(`${n} speaker(s) detected; this product supports exactly 2 speakers.`);
  }
  return reasons;
}
