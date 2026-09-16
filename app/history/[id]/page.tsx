"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { EventLog } from "@/app/components/EventLog";
import { MetricsView } from "@/app/components/MetricsView";
import { ReportView } from "@/app/components/ReportView";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { audioRef, playSegment } = useSegmentPlayer();

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    api<RunDetail>(`/api/runs/${id}?raw=1`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    fetch(`/api/runs/${id}/audio`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b || cancelled) return;
        url = URL.createObjectURL(b);
        setAudioUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAudioUrl(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  async function remove() {
    if (!confirm("Delete this run and its audio for everyone?")) return;
    setDeleteError(null);
    try {
      await api(`/api/runs/${id}`, { method: "DELETE" });
      router.push("/history");
    } catch (e) {
      setDeleteError((e as Error).message);
    }
  }

  if (error) return <div className="banner bad">{error}</div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { run, report, transcript, raw } = detail;
  const names = new Map((report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));

  return (
    <div>
      <h1>{run.file.name}</h1>
      <p className="muted">
        {run.createdAt.replace("T", " ").slice(0, 19)} UTC · {(run.file.sizeBytes / 1024 / 1024).toFixed(2)} MB · declared “{run.file.declaredType || "none"}”, detected {run.file.detectedFormat ?? "—"} · {run.file.durationSec?.toFixed(1) ?? "—"} s · status {run.status}
      </p>
      {audioUrl ? <audio ref={audioRef} src={audioUrl} controls preload="metadata" /> : <p className="muted">Audio not available.</p>}
      {run.rejection ? <div className="banner bad"><strong>Rejected ({run.rejection.code}):</strong> {run.rejection.message}</div> : null}

      <h2>What happened</h2>
      <EventLog events={run.events} />

      {report ? <ReportView report={report} onPlay={playSegment} /> : null}
      {transcript ? <TranscriptView transcript={transcript} onPlay={playSegment} names={names} /> : null}
      <MetricsView metrics={{ stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost }} />
      {raw ? (
        <details>
          <summary>Raw API responses</summary>
          <h3>Deepgram</h3><pre>{JSON.stringify(raw.deepgram, null, 2)}</pre>
          <h3>Claude</h3><pre>{JSON.stringify(raw.claude, null, 2)}</pre>
        </details>
      ) : null}
      {deleteError ? <div className="banner bad">{deleteError}</div> : null}
      <p><button type="button" onClick={() => void remove()}>Delete run</button></p>
    </div>
  );
}
