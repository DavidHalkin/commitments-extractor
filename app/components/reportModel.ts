import type { Evidence, Report, VerifiedItem } from "@/lib/types";

export type Tone = "agreed" | "unsettled" | "setaside" | "neutral";

export type TimelineMarker = {
  key: string;
  start: number;
  end: number;
  tone: Exclude<Tone, "neutral">;
  summary: string;
};

/** Identifies one spoken moment; shared by timeline markers and evidence lines so hovering one highlights the other. */
export function evidenceKey(ev: Evidence): string {
  return `${ev.utteranceId}@${ev.start}`;
}

export function tasksBy(report: Report, status: VerifiedItem["finalStatus"]): VerifiedItem[] {
  return report.items.filter((i) => i.kind === "task" && i.finalStatus === status);
}

export type SummaryCounts = { agreed: number; toClarify: number; notCommitments: number };

/** Header counts: active tasks, clarifications (which already include open questions), and everything set aside. */
export function summaryCounts(report: Report): SummaryCounts {
  return {
    agreed: report.status === "ok" ? tasksBy(report, "active").length : 0,
    toClarify: report.clarifications.length,
    notCommitments: tasksBy(report, "cancelled").length + tasksBy(report, "not_accepted").length + report.dropped.length,
  };
}

/** Owner and deadline fields are shown for active items, and for others only when a field is disputed. */
export function showFields(item: VerifiedItem): boolean {
  return item.finalStatus === "active" || item.owner.status === "disputed" || item.deadline.status === "disputed";
}

/** Evidence shown for an item: owner and deadline quotes when its fields are shown, then its event timeline. */
export function itemEvidence(item: VerifiedItem): Evidence[] {
  const fields = showFields(item) ? [item.owner.evidence, item.deadline.evidence] : [];
  return [...fields, ...item.events].filter((ev): ev is Evidence => ev != null);
}

// When one moment backs several items, the more urgent reading wins the marker colour.
const RANK: Record<TimelineMarker["tone"], number> = { unsettled: 0, agreed: 1, setaside: 2 };

/** One marker per evidence moment shown in the report, ordered by time. */
export function buildMarkers(report: Report | null | undefined): TimelineMarker[] {
  if (!report) return [];
  const byKey = new Map<string, TimelineMarker>();
  const add = (ev: Evidence, tone: TimelineMarker["tone"], summary: string) => {
    const key = evidenceKey(ev);
    const prev = byKey.get(key);
    if (!prev || RANK[tone] < RANK[prev.tone]) byKey.set(key, { key, start: ev.start, end: ev.end, tone, summary });
  };
  for (const c of report.clarifications) add(c.evidence, "unsettled", c.question);
  if (report.status === "ok") {
    for (const item of tasksBy(report, "active")) itemEvidence(item).forEach((ev) => add(ev, "agreed", item.summary));
  }
  for (const item of [...tasksBy(report, "cancelled"), ...tasksBy(report, "not_accepted")]) {
    itemEvidence(item).forEach((ev) => add(ev, "setaside", item.summary));
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start);
}
