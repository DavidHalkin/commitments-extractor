"use client";

import { memo } from "react";
import { formatClock } from "@/app/components/clock";
import type { OnPlay } from "@/app/components/EvidenceLine";
import type { TimelineMarker } from "@/app/components/reportModel";
import { StatusMark } from "@/app/components/StatusMark";
import { useTimelineLink } from "@/app/components/timelineLink";

// Markers appear one after another in time order; the whole entrance takes ~600 ms.
const STAGGER_MS = 450;

export const TimelineMarkerLayer = memo(function TimelineMarkerLayer({
  markers,
  domainSec,
  onPlay,
}: {
  markers: TimelineMarker[];
  domainSec: number;
  onPlay: OnPlay;
}) {
  const { activeKey, setActiveKey, openEvidence } = useTimelineLink();
  const last = Math.max(1, markers.length - 1);
  return (
    <>
      {markers.map((m, i) => {
        const label = `Play ${formatClock(m.start)} — ${m.summary}`;
        return (
          <button
            key={m.key}
            type="button"
            className={`marker tone-${m.tone}${activeKey === m.key ? " is-active" : ""}`}
            style={{ left: `${Math.min(100, (m.start / domainSec) * 100)}%`, animationDelay: `${Math.round((i / last) * STAGGER_MS)}ms` }}
            aria-label={label}
            title={label}
            onClick={() => {
              onPlay(m.start, m.end);
              openEvidence(m.key);
            }}
            onMouseEnter={() => setActiveKey(m.key)}
            onMouseLeave={() => setActiveKey(null)}
            onFocus={() => setActiveKey(m.key)}
            onBlur={() => setActiveKey(null)}
          />
        );
      })}
    </>
  );
});

const LEGEND: { tone: TimelineMarker["tone"]; label: string }[] = [
  { tone: "agreed", label: "Agreed" },
  { tone: "unsettled", label: "Needs clarification" },
  { tone: "setaside", label: "Not a commitment" },
];

export function TimelineLegend({ markers }: { markers: TimelineMarker[] }) {
  const tones = new Set(markers.map((m) => m.tone));
  const shown = LEGEND.filter((l) => tones.has(l.tone));
  if (shown.length === 0) return null;
  return (
    <ul className="timeline-legend" aria-label="Marker colours">
      {shown.map((l) => (
        <li key={l.tone}><StatusMark tone={l.tone}>{l.label}</StatusMark></li>
      ))}
    </ul>
  );
}
