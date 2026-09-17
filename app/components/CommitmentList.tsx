import { ClarificationRow, DroppedRow, ItemRow } from "@/app/components/CommitmentRow";
import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { summaryCounts, tasksBy } from "@/app/components/reportModel";
import type { Report } from "@/lib/types";

function StatusCard({ report }: { report: Report }) {
  if (report.status === "declined") {
    return (
      <div className="notice-card tone-setaside" role="status">
        <p className="notice-card-title">Can&apos;t produce a reliable commitments list.</p>
        <ul className="notice-card-list">{report.declineReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  }
  if (report.status === "needs_clarification") {
    return (
      <div className="notice-card tone-unsettled" role="status">
        <p className="notice-card-title">No commitment can be concluded from this recording.</p>
        <p>The points below must be clarified.</p>
      </div>
    );
  }
  if (report.status === "no_commitments") {
    return (
      <div className="notice-card tone-neutral" role="status">
        <p className="notice-card-title">No tasks, decisions or open questions were discussed.</p>
      </div>
    );
  }
  return null;
}

/** The report as a compact list: summary counts, then agreed items, items to clarify and set-aside items. */
export function CommitmentList({ report, onPlay }: { report: Report; onPlay: OnPlay }) {
  const counts = summaryCounts(report);
  const active = report.status === "ok" ? tasksBy(report, "active") : [];
  const setAside = [...tasksBy(report, "cancelled"), ...tasksBy(report, "not_accepted")];
  const speakers = report.speakers.filter((s) => s.intro);

  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title" className="section-title">Commitments</h2>
      <StatusCard report={report} />

      {report.status !== "declined" ? (
        <ul className="summary" aria-label="Summary">
          <li className="summary-stat tone-agreed"><b>{counts.agreed}</b> agreed</li>
          <li className="summary-stat tone-unsettled"><b>{counts.toClarify}</b> to clarify</li>
          <li className="summary-stat tone-setaside"><b>{counts.notCommitments}</b> not commitments</li>
        </ul>
      ) : null}

      {active.length > 0 ? (
        <section className="group" aria-label="Agreed">
          <h3 className="group-title">Agreed</h3>
          <ul className="rows">{active.map((it, i) => <ItemRow key={i} item={it} tone="agreed" onPlay={onPlay} />)}</ul>
        </section>
      ) : null}

      {report.clarifications.length > 0 ? (
        <section className="group" aria-label="Needs clarification">
          <h3 className="group-title">Needs clarification</h3>
          <ul className="rows">{report.clarifications.map((c, i) => <ClarificationRow key={i} clarification={c} onPlay={onPlay} />)}</ul>
        </section>
      ) : null}

      {counts.notCommitments > 0 ? (
        <details className="group group-collapsible">
          <summary className="group-title">Not commitments ({counts.notCommitments})</summary>
          <ul className="rows">
            {setAside.map((it, i) => <ItemRow key={i} item={it} tone="setaside" onPlay={onPlay} />)}
            {report.dropped.map((d, i) => <DroppedRow key={`d${i}`} summary={d.summary} reason={d.reason} />)}
          </ul>
        </details>
      ) : null}

      {speakers.length > 0 ? (
        <details className="group group-collapsible">
          <summary className="group-title">Speakers ({speakers.length})</summary>
          <div className="speakers">
            {speakers.map((s) => <EvidenceLine key={s.speaker} ev={s.intro!} onPlay={onPlay} label="introduction" />)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
