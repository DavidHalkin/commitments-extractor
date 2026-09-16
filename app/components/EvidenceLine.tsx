"use client";

import { formatClock } from "@/app/components/clock";
import { evidenceKey } from "@/app/components/reportModel";
import { useTimelineLink } from "@/app/components/timelineLink";
import type { Evidence } from "@/lib/types";

export type OnPlay = (start: number, end: number) => void;

export function EvidenceLine({ ev, onPlay, label }: { ev: Evidence; onPlay: OnPlay; label?: string }) {
  const { activeKey, setActiveKey } = useTimelineLink();
  const key = evidenceKey(ev);
  return (
    <div
      className={`line${activeKey === key ? " is-active" : ""}`}
      onMouseEnter={() => setActiveKey(key)}
      onMouseLeave={() => setActiveKey(null)}
    >
      <button
        type="button"
        className="timestamp"
        onClick={() => onPlay(ev.start, ev.end)}
        onFocus={() => setActiveKey(key)}
        onBlur={() => setActiveKey(null)}
        title="Play this segment"
        aria-label={`Play from ${formatClock(ev.start)}`}
      >
        <span aria-hidden="true" className="timestamp-glyph">▶</span> {formatClock(ev.start)}
      </button>
      <div className="line-body">
        <p className="line-meta">
          <span className="line-speaker">{ev.speakerName ?? `Speaker ${ev.speaker}`}</span>
          {label ? <span className="line-kind">{label}</span> : null}
        </p>
        <p className="quote">“{ev.quote}”</p>
      </div>
    </div>
  );
}
