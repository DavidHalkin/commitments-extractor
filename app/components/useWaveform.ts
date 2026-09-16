"use client";

import { useEffect, useState } from "react";

export type WaveformStatus = "idle" | "decoding" | "ready" | "failed";
export type Waveform = { status: WaveformStatus; peaks: number[] | null; durationSec: number | null };

const BARS = 300;
// Peaks only need a coarse signal; decoding at a low rate keeps a 3-minute file cheap.
const DECODE_SAMPLE_RATE = 8000;

async function decodePeaks(source: Blob, bars: number): Promise<{ peaks: number[]; durationSec: number }> {
  if (typeof OfflineAudioContext === "undefined") throw new Error("Web Audio is not available");
  const ctx = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(await source.arrayBuffer());
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const bucket = Math.max(1, Math.floor(buffer.length / bars));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const end = Math.min(buffer.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      for (const data of channels) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return { peaks: max > 0 ? peaks.map((p) => p / max) : peaks, durationSec: buffer.duration };
}

/** Decodes the recording in the browser and downsamples it to ~300 normalized peak bars. */
export function useWaveform(source: Blob | null): Waveform {
  const [result, setResult] = useState<{ source: Blob; waveform: Waveform } | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    decodePeaks(source, BARS)
      .then(({ peaks, durationSec }) => {
        if (!cancelled) setResult({ source, waveform: { status: "ready", peaks, durationSec } });
      })
      .catch(() => {
        if (!cancelled) setResult({ source, waveform: { status: "failed", peaks: null, durationSec: null } });
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source) return { status: "idle", peaks: null, durationSec: null };
  if (result?.source !== source) return { status: "decoding", peaks: null, durationSec: null };
  return result.waveform;
}
