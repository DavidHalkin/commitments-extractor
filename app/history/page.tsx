"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/app/components/api";
import { formatMs, formatUsd } from "@/lib/format";
import type { Run } from "@/lib/types";

function runBadge(run: Run): string {
  if (run.status === "done") return (run.reportStatus ?? "done").replace("_", " ");
  return run.status;
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ runs: Run[] }>("/api/runs").then((r) => setRuns(r.runs)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>History</h1>
      <p className="muted">Every upload and what happened to it. Newest first, last 50 runs.</p>
      {error ? <div className="banner bad">{error}</div> : null}
      {runs === null && !error ? <p className="muted">Loading…</p> : null}
      {runs?.length === 0 ? <p className="muted">No uploads yet.</p> : null}
      {runs && runs.length > 0 ? (
        <div className="scroll">
          <table>
            <thead><tr><th>Date (UTC)</th><th>File</th><th>Duration</th><th>Status</th><th>Time to result</th><th>Cost</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/history/${r.id}`}>{r.createdAt.replace("T", " ").slice(0, 19)}</Link></td>
                  <td>{r.file.name}</td>
                  <td>{r.file.durationSec != null ? `${r.file.durationSec.toFixed(1)} s` : "—"}</td>
                  <td>{runBadge(r)}</td>
                  <td>{formatMs(r.timeToResultMs)}</td>
                  <td>{formatUsd(r.cost?.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
