import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { LedgerRow } from "@/app/components/LedgerRow";
import { tasksBy } from "@/app/components/reportModel";
import type { Clarification, Report } from "@/lib/types";

const ABOUT_LABEL: Record<Clarification["about"], string> = {
  owner: "Owner to settle",
  deadline: "Deadline to settle",
  question: "Open question",
};

function StatusBanner({ report }: { report: Report }) {
  if (report.status === "declined") {
    return (
      <div className="banner tone-setaside" role="status">
        <p className="banner-title">Can’t produce a reliable commitments list.</p>
        <ul className="banner-list">{report.declineReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  }
  if (report.status === "needs_clarification") {
    return (
      <div className="banner tone-unsettled" role="status">
        <p className="banner-title">No commitment can be concluded from this recording.</p>
        <p className="banner-text">The points below must be clarified.</p>
      </div>
    );
  }
  if (report.status === "no_commitments") {
    return (
      <div className="banner tone-neutral" role="status">
        <p className="banner-title">No tasks, decisions or open questions were discussed.</p>
      </div>
    );
  }
  return null;
}

export function ReportView({ report, onPlay }: { report: Report; onPlay: OnPlay }) {
  const active = tasksBy(report, "active");
  const cancelled = tasksBy(report, "cancelled");
  const notAccepted = tasksBy(report, "not_accepted");
  const hasSetAside = cancelled.length > 0 || notAccepted.length > 0 || report.dropped.length > 0;
  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title">Final commitments</h2>
      <StatusBanner report={report} />

      {report.status === "ok" ? (
        <section className="report-section">
          <h3>Agreed ({active.length})</h3>
          {active.length ? (
            <div className="ledger">{active.map((it, i) => <LedgerRow key={i} item={it} onPlay={onPlay} />)}</div>
          ) : (
            <p className="muted">No agreed tasks.</p>
          )}
        </section>
      ) : null}

      {report.clarifications.length > 0 ? (
        <section className="report-section">
          <h3>Needs clarification ({report.clarifications.length})</h3>
          <div className="ledger">
            {report.clarifications.map((c, i) => (
              <article key={i} className="clarify-row">
                <p className="clarify-about">
                  <span className="clarify-kind">{ABOUT_LABEL[c.about]}</span>
                  {c.itemSummary && c.itemSummary !== c.question ? <span className="clarify-item">{c.itemSummary}</span> : null}
                </p>
                <p className="clarify-question">{c.question}</p>
                <EvidenceLine ev={c.evidence} onPlay={onPlay} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {hasSetAside ? (
        <section className="report-section">
          <h3>Not commitments</h3>
          <div className="groups">
            {cancelled.length > 0 ? (
              <details className="group">
                <summary>Cancelled ({cancelled.length})</summary>
                <div className="ledger">{cancelled.map((it, i) => <LedgerRow key={i} item={it} onPlay={onPlay} />)}</div>
              </details>
            ) : null}
            {notAccepted.length > 0 ? (
              <details className="group">
                <summary>Proposals not accepted ({notAccepted.length}) — not a commitment</summary>
                <div className="ledger">{notAccepted.map((it, i) => <LedgerRow key={i} item={it} onPlay={onPlay} />)}</div>
              </details>
            ) : null}
            {report.dropped.length > 0 ? (
              <details className="group">
                <summary>Dropped by verifier ({report.dropped.length})</summary>
                <ul className="dropped-list">
                  {report.dropped.map((d, i) => (
                    <li key={i}><span className="dropped-summary">{d.summary}</span> <span className="muted">{d.reason}</span></li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {report.speakers.length > 0 ? (
        <section className="report-section">
          <h3>Speakers</h3>
          {report.speakers.map((s) =>
            s.intro ? (
              <EvidenceLine key={s.speaker} ev={s.intro} onPlay={onPlay} label="introduction" />
            ) : (
              <p key={s.speaker} className="muted">Speaker {s.speaker} was not identified.</p>
            ),
          )}
        </section>
      ) : null}
    </section>
  );
}
