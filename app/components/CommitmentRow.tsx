"use client";

import { useId, useState, type ReactNode } from "react";
import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { evidenceKey, itemEvidence, showFields, type Tone } from "@/app/components/reportModel";
import { useTimelineLink } from "@/app/components/timelineLink";
import type { Clarification, Flag, VerifiedItem } from "@/lib/types";

type RowTone = Exclude<Tone, "neutral">;

const ICON: Record<RowTone, string> = { agreed: "✓", unsettled: "?", setaside: "✕" };
const SPOKEN: Record<RowTone, string> = { agreed: "Agreed", unsettled: "Needs clarification", setaside: "Not a commitment" };

const FLAG_TEXT: Record<Flag, string> = {
  owner_missing: "No owner agreed",
  owner_disputed: "Owner disputed — not settled",
  owner_unverified: "Owner not supported by a quote — removed",
  deadline_missing: "No deadline agreed",
  deadline_disputed: "Deadline disputed — not settled",
  deadline_unverified: "Deadline not supported by a quote — removed",
  date_context_missing: "Relative date: the recording does not state the calendar date",
};

const EVENT_LABEL: Record<string, string> = {
  proposed: "proposed", accepted: "accepted", assigned: "assigned", deadline_set: "deadline set",
  deadline_changed: "deadline changed", cancelled: "cancelled", reopened: "reopened",
  question_raised: "question raised", left_open: "left open",
};

const STATUS_CHIP: Partial<Record<VerifiedItem["finalStatus"], string>> = { cancelled: "Cancelled", not_accepted: "Not accepted" };

const ABOUT_LABEL: Record<Clarification["about"], string> = {
  owner: "Owner to settle",
  deadline: "Deadline to settle",
  question: "Open question",
};

export function Chip({ tone, children }: { tone?: RowTone | "accent"; children: ReactNode }) {
  return <span className={`chip${tone ? ` chip-${tone}` : ""}`}>{children}</span>;
}

/** A collapsible list row: status icon, title and chips; the body holds quotes and warnings. */
function Row({ tone, title, chips, evidenceKeys, children }: { tone: RowTone; title: string; chips: ReactNode; evidenceKeys: string[]; children: ReactNode }) {
  const bodyId = useId();
  const { activeKey, openRequest } = useTimelineLink();
  const [userOpen, setUserOpen] = useState(false);
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null);
  const forced = openRequest != null && evidenceKeys.includes(openRequest.key) && openRequest.nonce !== dismissedNonce;
  const open = userOpen || forced;
  const linked = activeKey != null && evidenceKeys.includes(activeKey);

  function toggle() {
    if (open) {
      setUserOpen(false);
      if (forced) setDismissedNonce(openRequest.nonce);
    } else {
      setUserOpen(true);
    }
  }

  return (
    <li className={`row tone-${tone}${open ? " is-open" : ""}${linked ? " is-linked" : ""}`} data-evidence-keys={evidenceKeys.join(" ")}>
      <button type="button" className="row-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="row-icon" aria-hidden="true">{ICON[tone]}</span>
        <span className="sr-only">{SPOKEN[tone]}: </span>
        <span className="row-title">{title}</span>
        <span className="row-chips">{chips}</span>
        <span className="row-chevron" aria-hidden="true">▾</span>
      </button>
      <div id={bodyId} className="row-body" hidden={!open}>{children}</div>
    </li>
  );
}

function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return <ul className="row-flags">{flags.map((f) => <li key={f}>⚠ {FLAG_TEXT[f]}</li>)}</ul>;
}

export function ItemRow({ item, tone, onPlay }: { item: VerifiedItem; tone: RowTone; onPlay: OnPlay }) {
  const fields = showFields(item);
  const chips = (
    <>
      {STATUS_CHIP[item.finalStatus] ? <Chip tone="setaside">{STATUS_CHIP[item.finalStatus]}</Chip> : null}
      {fields ? <Chip tone={item.owner.name ? "accent" : "unsettled"}>{item.owner.name ?? "No owner"}</Chip> : null}
      {fields ? <Chip tone={item.deadline.wording ? "accent" : "unsettled"}>{item.deadline.wording ?? "No deadline"}</Chip> : null}
    </>
  );
  return (
    <Row tone={tone} title={item.summary} chips={chips} evidenceKeys={itemEvidence(item).map(evidenceKey)}>
      {fields && item.owner.evidence ? <EvidenceLine ev={item.owner.evidence} onPlay={onPlay} label="owner" /> : null}
      {fields && item.deadline.evidence ? (
        <EvidenceLine ev={item.deadline.evidence} onPlay={onPlay} label={item.deadline.resolvedDate ? `deadline (${item.deadline.resolvedDate})` : "deadline"} />
      ) : null}
      <Flags flags={item.flags} />
      <p className="row-subhead">How it was decided</p>
      {item.events.map((ev, i) => <EvidenceLine key={i} ev={ev} onPlay={onPlay} label={EVENT_LABEL[ev.type] ?? ev.type} />)}
    </Row>
  );
}

export function ClarificationRow({ clarification, onPlay }: { clarification: Clarification; onPlay: OnPlay }) {
  const c = clarification;
  return (
    <Row
      tone="unsettled"
      title={c.question}
      chips={<Chip tone="unsettled">{ABOUT_LABEL[c.about]}</Chip>}
      evidenceKeys={[evidenceKey(c.evidence)]}
    >
      {c.itemSummary && c.itemSummary !== c.question ? <p className="row-note">About: {c.itemSummary}</p> : null}
      <EvidenceLine ev={c.evidence} onPlay={onPlay} />
    </Row>
  );
}

export function DroppedRow({ summary, reason }: { summary: string; reason: string }) {
  return (
    <li className="row tone-setaside is-static">
      <div className="row-head">
        <span className="row-icon" aria-hidden="true">{ICON.setaside}</span>
        <span className="sr-only">Removed by the quote check: </span>
        <span className="row-title">{summary}</span>
        <span className="row-chips"><Chip tone="setaside">Removed</Chip></span>
      </div>
      <p className="row-note row-note-static">{reason}</p>
    </li>
  );
}
