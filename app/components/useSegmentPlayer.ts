"use client";

import { useCallback, useEffect, useRef } from "react";

export const SEGMENT_PADDING_SEC = 0.3;

export function useSegmentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (stopAt.current != null && audio.currentTime >= stopAt.current) {
        audio.pause();
        stopAt.current = null;
      }
    };
    const onSeekByUser = () => {
      if (audio.paused) stopAt.current = null;
    };
    const onSourceChange = () => {
      stopAt.current = null;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", onSeekByUser);
    audio.addEventListener("emptied", onSourceChange);
    audio.addEventListener("loadstart", onSourceChange);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", onSeekByUser);
      audio.removeEventListener("emptied", onSourceChange);
      audio.removeEventListener("loadstart", onSourceChange);
    };
  });

  const playSegment = useCallback((start: number, end: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, start - SEGMENT_PADDING_SEC);
    stopAt.current = end + SEGMENT_PADDING_SEC;
    void audio.play();
  }, []);

  return { audioRef, playSegment };
}
