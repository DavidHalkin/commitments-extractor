import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import type { Flag, Report, VerifiedItem } from "@/lib/types";

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

function TaskCard({ item, onPlay }: { item: VerifiedItem; onPlay: OnPlay }) {
  const showFields = item.finalStatus === "active" || item.owner.status === "disputed" || item.deadline.status === "disputed";
  return (
    <div className="card">
      <strong>{item.summary}</strong>
      {showFields ? (
        <>
          <div>
            Owner: {item.owner.name ?? <span className="muted">—</span>}
            {item.owner.evidence ? <EvidenceLine ev={item.owner.evidence} onPlay={onPlay} label="owner" /> : null}
          </div>
          <div>
            Deadline: {item.deadline.wording ? `“${item.deadline.wording}”` : <span className="muted">—</span>}
            {item.deadline.resolvedDate ? ` (${item.deadline.resolvedDate})` : null}
            {item.deadline.evidence ? <EvidenceLine ev={item.deadline.evidence} onPlay={onPlay} label="deadline" /> : null}
          </div>
        </>
      ) : null}
      <div>{item.flags.map((f) => <span key={f} className="flag">⚠ {FLAG_TEXT[f]}</span>)}</div>
      <details>
        <summary>Evidence timeline ({item.events.length})</summary>
        {item.events.map((ev, i) => <EvidenceLine key={i} ev={ev} onPlay={onPlay} label={EVENT_LABEL[ev.type] ?? ev.type} />)}
      </details>
    </div>
  );
}

function StatusBanner({ report }: { report: Report }) {
  if (report.status === "declined") {
    return (
      <div className="banner bad">
        <strong>Can’t produce a reliable commitments list.</strong>
        <ul>{report.declineReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  }
  if (report.status === "needs_clarification") {
    return <div className="banner warn"><strong>No commitment can be concluded from this recording.</strong> The points below must be clarified.</div>;
  }
  if (report.status === "no_commitments") {
    return <div className="banner warn"><strong>No tasks, decisions or open questions were discussed.</strong></div>;
  }
  return null;
}

export function ReportView({ report, onPlay }: { report: Report; onPlay: OnPlay }) {
  const by = (status: VerifiedItem["finalStatus"]) => report.items.filter((i) => i.kind === "task" && i.finalStatus === status);
  const active = by("active");
  const cancelled = by("cancelled");
  const notAccepted = by("not_accepted");
  return (
    <section>
      <h2>Final commitments</h2>
      <StatusBanner report={report} />
      {report.speakers.length > 0 ? (
        <>
          <h3>Speakers</h3>
          {report.speakers.map((s) =>
            s.intro ? (
              <EvidenceLine key={s.speaker} ev={s.intro} onPlay={onPlay} label={s.name ?? undefined} />
            ) : (
              <div key={s.speaker} className="muted">Speaker {s.speaker}: not identified</div>
            ),
          )}
        </>
      ) : null}
      {report.status === "ok" ? (
        <>
          <h3>Active tasks ({active.length})</h3>
          {active.length ? active.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />) : <p className="muted">No active tasks.</p>}
        </>
      ) : null}
      {report.clarifications.length > 0 ? (
        <>
          <h3>Needs clarification / open questions ({report.clarifications.length})</h3>
          {report.clarifications.map((c, i) => (
            <div key={i} className="card">
              <div><span className="tag">{c.about}</span><strong>{c.question}</strong></div>
              <EvidenceLine ev={c.evidence} onPlay={onPlay} />
            </div>
          ))}
        </>
      ) : null}
      {cancelled.length > 0 ? (
        <details>
          <summary>Cancelled ({cancelled.length})</summary>
          {cancelled.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />)}
        </details>
      ) : null}
      {notAccepted.length > 0 ? (
        <details>
          <summary>Proposals not accepted ({notAccepted.length}) — not commitments</summary>
          {notAccepted.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />)}
        </details>
      ) : null}
      {report.dropped.length > 0 ? (
        <details>
          <summary>Dropped by verifier ({report.dropped.length})</summary>
          <ul>{report.dropped.map((d, i) => <li key={i}><strong>{d.summary}</strong> — {d.reason}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
