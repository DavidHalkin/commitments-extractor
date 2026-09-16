import type { OnPlay } from "@/app/components/EvidenceLine";
import { formatTime } from "@/lib/format";
import type { Transcript } from "@/lib/types";

export function TranscriptView({ transcript, onPlay, names }: { transcript: Transcript; onPlay: OnPlay; names?: Map<number, string> }) {
  return (
    <details>
      <summary>Transcript ({transcript.utterances.length} utterances)</summary>
      {transcript.utterances.map((u) => (
        <div key={u.id} className="evidence">
          <button type="button" className="play" onClick={() => onPlay(u.start, u.end)} aria-label={`Play from ${formatTime(u.start)}`}>▶ {formatTime(u.start)}</button>
          <span className="speaker">{names?.get(u.speaker) ?? `Speaker ${u.speaker}`}:</span> {u.text}
        </div>
      ))}
    </details>
  );
}
