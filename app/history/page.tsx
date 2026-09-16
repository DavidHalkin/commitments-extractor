"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/app/components/api";
import { formatClock } from "@/app/components/clock";
import { runBadge, runTone } from "@/app/components/runBadge";
import { StatusMark } from "@/app/components/StatusMark";
import { formatMs, formatUsd } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import type { Run } from "@/lib/types";

function DurationBar({ run }: { run: Run }) {
  const sec = run.file.durationSec;
  const pct = sec != null ? Math.min(100, (sec / LIMITS.maxDurationSec) * 100) : 0;
  return (
    <span className="duration">
      <span className="minibar" aria-hidden="true">
        {sec != null ? <span className={`minibar-fill tone-${runTone(run)}`} style={{ width: `${pct}%` }} /> : null}
      </span>
      <span>{sec != null ? formatClock(sec) : "—"}</span>
    </span>
  );
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ runs: Run[] }>("/api/runs").then((r) => setRuns(r.runs)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <header className="page-intro">
        <h1>History</h1>
        <p className="lede">Every upload and what happened to it, newest first.</p>
      </header>
      {error ? <div className="banner tone-setaside" role="alert"><p className="banner-text">{error}</p></div> : null}
      {runs === null && !error ? <p className="muted">Loading…</p> : null}
      {runs?.length === 0 ? <p className="empty-note">No uploads yet. <Link href="/">Upload a recording</Link> to see it here.</p> : null}
      {runs && runs.length > 0 ? (
        <div className="scroll">
          <table className="data-table history-table">
            <thead>
              <tr>
                <th scope="col">Date (UTC)</th>
                <th scope="col">File</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Time to result</th>
                <th scope="col" className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="cell-date nowrap"><Link href={`/history/${r.id}`}>{r.createdAt.replace("T", " ").slice(0, 19)}</Link></td>
                  <td className="cell-file">{r.file.name}</td>
                  <td className="cell-duration"><DurationBar run={r} /></td>
                  <td className="cell-status nowrap"><StatusMark tone={runTone(r)}>{runBadge(r)}</StatusMark></td>
                  <td className="cell-time num"><span className="cell-label">Time to result </span>{formatMs(r.timeToResultMs)}</td>
                  <td className="cell-cost num">{formatUsd(r.cost?.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
