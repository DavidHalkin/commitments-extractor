import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { showFields } from "@/app/components/reportModel";
import type { Flag, VerifiedItem } from "@/lib/types";

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

const OWNER_FLAGS: Flag[] = ["owner_missing", "owner_disputed", "owner_unverified"];
const DEADLINE_FLAGS: Flag[] = ["deadline_missing", "deadline_disputed", "deadline_unverified", "date_context_missing"];

function FieldFlags({ flags }: { flags: Flag[] }) {
  return <>{flags.map((f) => <p key={f} className="flag">⚠ {FLAG_TEXT[f]}</p>)}</>;
}

function Empty() {
  return <span className="muted">—</span>;
}

/** One task as a ledger row: summary, then Owner and Deadline, each with its quote and inline flags. */
export function LedgerRow({ item, onPlay }: { item: VerifiedItem; onPlay: OnPlay }) {
  const fields = showFields(item);
  return (
    <article className={`ledger-row${fields ? "" : " is-summary-only"}`}>
      <p className="ledger-summary">{item.summary}</p>
      {fields ? (
        <>
          <div className="ledger-field">
            <p className="field-label">Owner</p>
            <p className="field-value">{item.owner.name ?? <Empty />}</p>
            {item.owner.evidence ? <EvidenceLine ev={item.owner.evidence} onPlay={onPlay} label="owner" /> : null}
            <FieldFlags flags={item.flags.filter((f) => OWNER_FLAGS.includes(f))} />
          </div>
          <div className="ledger-field">
            <p className="field-label">Deadline</p>
            <p className="field-value">
              {item.deadline.wording ? `“${item.deadline.wording}”` : <Empty />}
              {item.deadline.resolvedDate ? ` (${item.deadline.resolvedDate})` : null}
            </p>
            {item.deadline.evidence ? <EvidenceLine ev={item.deadline.evidence} onPlay={onPlay} label="deadline" /> : null}
            <FieldFlags flags={item.flags.filter((f) => DEADLINE_FLAGS.includes(f))} />
          </div>
        </>
      ) : null}
      <details className="ledger-evidence">
        <summary>Evidence timeline ({item.events.length})</summary>
        {item.events.map((ev, i) => <EvidenceLine key={i} ev={ev} onPlay={onPlay} label={EVENT_LABEL[ev.type] ?? ev.type} />)}
      </details>
    </article>
  );
}
