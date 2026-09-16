"use client";

import { memo, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { formatClock } from "@/app/components/clock";
import type { OnPlay } from "@/app/components/EvidenceLine";
import type { TimelineMarker } from "@/app/components/reportModel";
import { TimelineLegend, TimelineMarkerLayer } from "@/app/components/TimelineMarkerLayer";
import { useMediaClock } from "@/app/components/useMediaClock";
import type { Waveform } from "@/app/components/useWaveform";

const EMPTY_SCALE_SEC = 180;

type Props = {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioSrc: string | null;
  /** Best known duration (client check, transcript or stored run). Falls back to the decoded or media duration. */
  durationSec: number | null;
  waveform: Waveform;
  markers: TimelineMarker[];
  onPlay: OnPlay;
  /** Empty/drop state content. When set, the strip shows a 0:00–3:00 scale and this content instead of the recording. */
  prompt?: ReactNode;
  onDropFile?: (file: File) => void;
  /** Shown under the strip when there is no audio to play. */
  missingAudioNote?: string;
};

function ticksFor(domainSec: number): number[] {
  const step = domainSec < 60 ? 10 : 30;
  const ticks: number[] = [];
  for (let t = 0; t <= domainSec + 0.001; t += step) ticks.push(t);
  return ticks;
}

const WaveformBars = memo(function WaveformBars({ peaks }: { peaks: number[] }) {
  const w = 100 / peaks.length;
  return (
    <svg className="timeline-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {peaks.map((p, i) => {
        const h = Math.max(1.5, p * 100);
        return <rect key={i} x={i * w + w * 0.15} y={(100 - h) / 2} width={w * 0.7} height={h} />;
      })}
    </svg>
  );
});

export function RecordingTimeline({ audioRef, audioSrc, durationSec, waveform, markers, onPlay, prompt, onDropFile, missingAudioNote }: Props) {
  const [over, setOver] = useState(false);
  const empty = prompt != null;
  const knownDuration = durationSec ?? waveform.durationSec;
  const { time, durationSec: mediaDuration, playheadRef } = useMediaClock(audioRef, audioSrc, knownDuration, EMPTY_SCALE_SEC);
  const domainSec = empty ? EMPTY_SCALE_SEC : Math.max(1, knownDuration ?? mediaDuration ?? EMPTY_SCALE_SEC);
  const canSeek = !empty && audioSrc != null;

  function seekTo(sec: number) {
    const audio = audioRef.current;
    if (!audio || !canSeek) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : domainSec;
    audio.currentTime = Math.min(limit, Math.max(0, sec));
  }

  function onSeekClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * domainSec);
  }

  function onSeekKey(e: KeyboardEvent<HTMLDivElement>) {
    const delta: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    if (e.key in delta) seekTo(time + delta[e.key]);
    else if (e.key === "Home") seekTo(0);
    else if (e.key === "End") seekTo(domainSec);
    else return;
    e.preventDefault();
  }

  const drop = onDropFile
    ? {
        onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
        onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
        onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onDropFile(f); },
      }
    : {};

  const ticks = ticksFor(domainSec);
  return (
    <div className="timeline-block">
      <div className="timeline-scroll">
        <div className={`timeline${over ? " is-over" : ""}${empty ? " is-empty" : ""}`} {...drop}>
          <div className="timeline-plot">
            {empty ? (
              <div className="timeline-prompt">{prompt}</div>
            ) : (
              <>
                {waveform.peaks ? <WaveformBars peaks={waveform.peaks} /> : <div className="timeline-baseline" aria-hidden="true" />}
                <div
                  className="timeline-seek"
                  role="slider"
                  tabIndex={canSeek ? 0 : -1}
                  aria-label="Seek in recording"
                  aria-disabled={!canSeek}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(domainSec)}
                  aria-valuenow={Math.round(time)}
                  aria-valuetext={`${formatClock(time)} of ${formatClock(domainSec)}`}
                  onClick={onSeekClick}
                  onKeyDown={onSeekKey}
                />
                {audioSrc ? <div ref={playheadRef} className="timeline-playhead" aria-hidden="true" /> : null}
                <TimelineMarkerLayer markers={markers} domainSec={domainSec} onPlay={onPlay} />
              </>
            )}
          </div>
          <div className="timeline-axis" aria-hidden="true">
            {ticks.map((t, i) => (
              <span
                key={t}
                className={`timeline-tick${i === 0 ? " is-first" : ""}${i === ticks.length - 1 && t >= domainSec - 0.001 ? " is-last" : ""}`}
                style={{ left: `${(t / domainSec) * 100}%` }}
              >
                <span className="timeline-tick-label">{formatClock(t)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {audioSrc ? <audio ref={audioRef} src={audioSrc} controls preload="metadata" className="timeline-audio" /> : null}
      <div className="timeline-caption">
        <TimelineLegend markers={empty ? [] : markers} />
        {!empty && waveform.status === "failed" ? (
          <p className="timeline-note">This browser could not draw the waveform. Markers and playback still work.</p>
        ) : null}
        {missingAudioNote ? <p className="timeline-note">{missingAudioNote}</p> : null}
      </div>
    </div>
  );
}
