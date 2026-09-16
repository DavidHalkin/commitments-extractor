import type { EvidenceRef, ExtractedItem, Extraction } from "@/lib/extract/schema";
import { significantSpeakers } from "@/lib/gate/precheck";
import type {
  Clarification,
  Evidence,
  EvidenceType,
  EventType,
  Flag,
  Report,
  Transcript,
  Utterance,
  VerifiedItem,
} from "@/lib/types";
import { containsPhrase, findQuoteSpan, HEDGES, normalize, tokens } from "@/lib/verify/text";

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ABSOLUTE_DATE = new RegExp(
  `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`,
  "i",
);

export function isAbsoluteDate(text: string): boolean {
  return ABSOLUTE_DATE.test(text);
}

const SUPPORT: Record<ExtractedItem["final_status"], EventType[]> = {
  active: ["accepted", "assigned"],
  cancelled: ["cancelled"],
  not_accepted: ["proposed"],
  open: ["question_raised", "left_open"],
};

/** Timeline events whose latest occurrence determines a task's actual final state. */
const STATE_EVENT_STATUS: Partial<Record<EventType, ExtractedItem["final_status"]>> = {
  accepted: "active",
  assigned: "active",
  reopened: "active",
  cancelled: "cancelled",
  proposed: "not_accepted",
};

/** Event types whose evidence quote must not merely hedge or propose to count as real commitment support. */
const HEDGE_SENSITIVE_EVENTS = new Set<EventType>(["accepted", "assigned"]);

function isHedgedQuote(quote: string): boolean {
  return tokens(quote).some((tok) => HEDGES.has(tok));
}

/** An owner/deadline evidence utterance must sit within one utterance of one of the item's own timeline events. */
function isNearEvents(ev: Evidence, eventIndices: Set<number>, utteranceIndex: Map<string, number>): boolean {
  const idx = utteranceIndex.get(ev.utteranceId);
  if (idx == null) return false;
  for (const i of eventIndices) if (Math.abs(i - idx) <= 1) return true;
  return false;
}

type Locate = (ref: EvidenceRef | null, type: EvidenceType) => Evidence | null;

function makeLocator(t: Transcript, names: Map<number, string>): Locate {
  const byId = new Map(t.utterances.map((u) => [u.id, u]));
  const evidenceFrom = (u: Utterance, first: number, last: number, type: EvidenceType): Evidence => {
    const ws = u.words.slice(first, last + 1);
    return {
      type,
      quote: ws.map((w) => w.punctuated).join(" "),
      utteranceId: u.id,
      speaker: u.speaker,
      speakerName: names.get(u.speaker) ?? null,
      start: ws[0].start,
      end: ws[ws.length - 1].end,
    };
  };
  return (ref, type) => {
    if (!ref) return null;
    const preferred = byId.get(ref.utterance_id);
    const order = preferred ? [preferred, ...t.utterances.filter((u) => u !== preferred)] : t.utterances;
    for (const u of order) {
      const span = findQuoteSpan(ref.quote, u.words);
      if (span) return evidenceFrom(u, span.first, span.last, type);
    }
    return null;
  };
}

function emptyReport(status: Report["status"], declineReasons: string[] = []): Report {
  return { status, declineReasons, clarifications: [], speakers: [], items: [], dropped: [], metrics: null };
}

type Processed = { item: VerifiedItem; clarifications: Clarification[] } | { dropped: string };

function processItem(x: ExtractedItem, t: Transcript, locate: Locate): Processed {
  const consistent = (x.kind === "open_question") === (x.final_status === "open");
  if (!consistent) return { dropped: `inconsistent kind "${x.kind}" with status "${x.final_status}"` };

  const events = x.events
    .map((e) => locate(e, e.type))
    .filter((e): e is Evidence => e != null)
    .sort((a, b) => a.start - b.start);

  const needed = SUPPORT[x.final_status];
  const supportingEvents = events.filter(
    (e) => needed.includes(e.type as EventType) && !(HEDGE_SENSITIVE_EVENTS.has(e.type as EventType) && isHedgedQuote(e.quote)),
  );
  if (supportingEvents.length === 0) {
    return { dropped: `no verified quote for a ${needed.join(" or ")} event supporting status "${x.final_status}"` };
  }

  if (x.kind === "task") {
    const stateEvents = events.filter((e) => (e.type as EventType) in STATE_EVENT_STATUS);
    const latestState = stateEvents[stateEvents.length - 1];
    if (latestState) {
      const mapped = STATE_EVENT_STATUS[latestState.type as EventType];
      if (mapped && mapped !== x.final_status) {
        return { dropped: `latest verified event "${latestState.type}" contradicts status "${x.final_status}"` };
      }
    }
  }

  const utteranceIndex = new Map(t.utterances.map((u, i) => [u.id, i]));
  const eventIndices = new Set(
    events.map((e) => utteranceIndex.get(e.utteranceId)).filter((i): i is number => i != null),
  );
  const deadlineChangedEvents = events.filter((e) => e.type === "deadline_changed");
  const latestDeadlineChanged = deadlineChangedEvents[deadlineChangedEvents.length - 1];

  const flags: Flag[] = [];
  const clarifications: Clarification[] = [];
  const lastEvent = events[events.length - 1];
  const verified: VerifiedItem = {
    kind: x.kind,
    summary: x.summary,
    finalStatus: x.final_status,
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
    flags,
    events,
  };

  if (x.final_status === "open") {
    clarifications.push({ about: "question", itemSummary: x.summary, question: x.summary, evidence: lastEvent });
    return { item: verified, clarifications };
  }
  if (x.final_status === "cancelled") return { item: verified, clarifications };

  const isActive = x.final_status === "active";

  // Owner
  if (x.owner.status === "disputed") {
    const ev = locate(x.owner.evidence, "owner") ?? lastEvent;
    verified.owner = { status: "disputed", name: null, evidence: ev };
    flags.push("owner_disputed");
    clarifications.push({ about: "owner", itemSummary: x.summary, question: `Who owns "${x.summary}"?`, evidence: ev });
  } else if (isActive && x.owner.status === "agreed") {
    const ev = locate(x.owner.evidence, "owner");
    const name = x.owner.name;
    const supported =
      ev != null &&
      name != null &&
      isNearEvents(ev, eventIndices, utteranceIndex) &&
      ((ev.speakerName != null && normalize(ev.speakerName) === normalize(name)) || containsPhrase(ev.quote, name));
    if (supported) verified.owner = { status: "agreed", name, evidence: ev };
    else flags.push("owner_unverified");
  } else if (isActive) {
    flags.push("owner_missing");
  }

  // Deadline
  if (x.deadline.status === "disputed") {
    const ev = locate(x.deadline.evidence, "deadline") ?? lastEvent;
    verified.deadline = { status: "disputed", wording: null, resolvedDate: null, evidence: ev };
    flags.push("deadline_disputed");
    clarifications.push({ about: "deadline", itemSummary: x.summary, question: `What is the deadline for "${x.summary}"?`, evidence: ev });
  } else if (isActive && x.deadline.status === "agreed") {
    const ev = locate(x.deadline.evidence, "deadline");
    const wording = x.deadline.wording;
    const near = ev != null && isNearEvents(ev, eventIndices, utteranceIndex);
    const stale = ev != null && latestDeadlineChanged != null && ev.start < latestDeadlineChanged.start;
    if (ev && wording && near && !stale && containsPhrase(ev.quote, wording)) {
      const anchor = x.deadline.anchor_utterance_id
        ? t.utterances.find((u) => u.id === x.deadline.anchor_utterance_id)
        : undefined;
      const resolvedDate = x.deadline.resolved_date && anchor && isAbsoluteDate(anchor.text) ? x.deadline.resolved_date : null;
      verified.deadline = { status: "agreed", wording, resolvedDate, evidence: ev };
      if (!resolvedDate && !isAbsoluteDate(wording)) flags.push("date_context_missing");
    } else {
      flags.push("deadline_unverified");
    }
  } else if (isActive) {
    flags.push("deadline_missing");
  }

  return { item: verified, clarifications };
}

export function verify(t: Transcript, x: Extraction): Report {
  const byId = new Map(t.utterances.map((u) => [u.id, u]));
  const extracted = new Map(x.speakers.map((s) => [s.speaker, s]));
  const names = new Map<number, string>();
  const speakers: Report["speakers"] = [];
  const unnamed: number[] = [];

  for (const sp of significantSpeakers(t)) {
    const s = extracted.get(sp);
    const u = s?.intro_utterance_id ? byId.get(s.intro_utterance_id) : undefined;
    if (s?.name && u && u.speaker === sp && containsPhrase(u.text, s.name)) {
      names.set(sp, s.name);
      speakers.push({
        speaker: sp,
        name: s.name,
        intro: { type: "intro", quote: u.text, utteranceId: u.id, speaker: sp, speakerName: s.name, start: u.start, end: u.end },
      });
    } else {
      unnamed.push(sp);
      speakers.push({ speaker: sp, name: null, intro: null });
    }
  }

  if (unnamed.length > 0) {
    return {
      ...emptyReport("declined", [
        `Speaker ${unnamed.join(", ")} never introduces themselves by name; owners cannot be attributed.`,
      ]),
      speakers,
    };
  }

  const locate = makeLocator(t, names);
  const items: VerifiedItem[] = [];
  const clarifications: Clarification[] = [];
  const dropped: Report["dropped"] = [];
  for (const raw of x.items) {
    const p = processItem(raw, t, locate);
    if ("dropped" in p) dropped.push({ summary: raw.summary, reason: p.dropped });
    else {
      items.push(p.item);
      clarifications.push(...p.clarifications);
    }
  }

  const base = { declineReasons: [], clarifications, speakers, items, dropped, metrics: null };
  if (items.length === 0) {
    if (x.no_commitments_discussed && x.items.length === 0) return { ...base, status: "no_commitments" };
    return {
      ...base,
      status: "declined",
      declineReasons: ["None of the extracted items could be verified against the transcript."],
    };
  }
  const hasActive = items.some((i) => i.kind === "task" && i.finalStatus === "active");
  if (!hasActive && clarifications.length > 0) return { ...base, status: "needs_clarification" };
  return { ...base, status: "ok" };
}
