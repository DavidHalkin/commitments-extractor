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
      <header className="hero hero-small">
        <h1>History</h1>
        <p className="lede">Every upload and what happened to it, newest first.</p>
      </header>
      {error ? <div className="notice-card tone-setaside" role="alert"><p>{error}</p></div> : null}
      {runs === null && !error ? <p className="muted">Loading…</p> : null}
      {runs?.length === 0 ? (
        <div className="notice-card tone-neutral"><p>No uploads yet. <Link href="/">Upload a recording</Link> to see it here.</p></div>
      ) : null}
      {runs && runs.length > 0 ? (
        <ul className="run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/history/${r.id}`} className="run-card">
                <span className="run-card-status"><StatusMark tone={runTone(r)}>{runBadge(r)}</StatusMark></span>
                <span className="run-card-file">{r.file.name}</span>
                <span className="run-card-date">{r.createdAt.replace("T", " ").slice(0, 16)} UTC</span>
                <span className="run-card-duration"><DurationBar run={r} /></span>
                <span className="run-card-numbers">
                  <span><span className="sr-only">Time to result </span>{formatMs(r.timeToResultMs)}</span>
                  <span><span className="sr-only">Cost </span>{formatUsd(r.cost?.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
