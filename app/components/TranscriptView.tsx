import { formatClock } from "@/app/components/clock";
import type { OnPlay } from "@/app/components/EvidenceLine";
import type { Transcript } from "@/lib/types";

export function TranscriptView({ transcript, onPlay, names }: { transcript: Transcript; onPlay: OnPlay; names?: Map<number, string> }) {
  return (
    <details className="section-details">
      <summary>Transcript ({transcript.utterances.length} utterances)</summary>
      <div className="transcript">
        {transcript.utterances.map((u) => (
          <div key={u.id} className="line">
            <button type="button" className="timestamp" onClick={() => onPlay(u.start, u.end)} aria-label={`Play from ${formatClock(u.start)}`}>
              <span aria-hidden="true" className="timestamp-glyph">▶</span> {formatClock(u.start)}
            </button>
            <div className="line-body">
              <p className="line-meta"><span className="line-speaker">{names?.get(u.speaker) ?? `Speaker ${u.speaker}`}</span></p>
              <p className="quote">{u.text}</p>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
