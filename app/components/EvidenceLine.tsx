import { formatTime } from "@/lib/format";
import type { Evidence } from "@/lib/types";

export type OnPlay = (start: number, end: number) => void;

export function EvidenceLine({ ev, onPlay, label }: { ev: Evidence; onPlay: OnPlay; label?: string }) {
  return (
    <div className="evidence">
      <button
        type="button"
        className="play"
        onClick={() => onPlay(ev.start, ev.end)}
        title="Play this segment"
        aria-label={`Play from ${formatTime(ev.start)}`}
      >
        ▶ {formatTime(ev.start)}
      </button>
      {label ? <span className="tag">{label}</span> : null}
      <span className="speaker">{ev.speakerName ?? `Speaker ${ev.speaker}`}:</span> “{ev.quote}”
    </div>
  );
}
