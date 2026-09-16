"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Follows an audio element. `time`/`durationSec` are React state updated at media-event rate
 * (for labels and ARIA); `playheadRef` is moved every animation frame while playing, without re-rendering.
 */
export function useMediaClock(audioRef: RefObject<HTMLAudioElement | null>, src: string | null, knownDurationSec: number | null, fallbackSec: number) {
  const [time, setTime] = useState(0);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    let raf = 0;
    const place = () => {
      // Same domain rule as the strip: known duration, else the media's own duration, else the fallback scale.
      const domainSec = Math.max(1, knownDurationSec ?? (Number.isFinite(audio.duration) ? audio.duration : fallbackSec));
      const line = playheadRef.current;
      if (line) line.style.left = `${Math.min(100, Math.max(0, (audio.currentTime / domainSec) * 100))}%`;
    };
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onStop = () => {
      cancelAnimationFrame(raf);
      place();
      setTime(audio.currentTime);
    };
    const onTime = () => {
      if (audio.paused) place();
      setTime(audio.currentTime);
    };
    const onDuration = () => setDurationSec(Number.isFinite(audio.duration) ? audio.duration : null);
    const onEmptied = () => {
      place();
      setTime(0);
      setDurationSec(null);
    };
    const events: [string, () => void][] = [
      ["play", onPlay], ["pause", onStop], ["ended", onStop], ["seeked", onStop], ["seeking", onTime],
      ["timeupdate", onTime], ["loadedmetadata", onDuration], ["durationchange", onDuration], ["emptied", onEmptied],
    ];
    events.forEach(([name, fn]) => audio.addEventListener(name, fn));
    raf = requestAnimationFrame(() => {
      onDuration();
      if (audio.paused) onStop();
      else onPlay();
    });
    return () => {
      cancelAnimationFrame(raf);
      events.forEach(([name, fn]) => audio.removeEventListener(name, fn));
    };
  }, [audioRef, src, knownDurationSec, fallbackSec]);

  return { time, durationSec, playheadRef };
}
