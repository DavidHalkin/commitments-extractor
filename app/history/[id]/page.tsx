"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { EventLog } from "@/app/components/EventLog";
import { MetricsView } from "@/app/components/MetricsView";
import { RecordingTimeline } from "@/app/components/RecordingTimeline";
import { buildMarkers } from "@/app/components/reportModel";
import { ReportView } from "@/app/components/ReportView";
import { runBadge, runTone } from "@/app/components/runBadge";
import { StatusMark } from "@/app/components/StatusMark";
import { TimelineLinkProvider } from "@/app/components/timelineLink";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";
import { useWaveform } from "@/app/components/useWaveform";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  // undefined while loading, null when the stored audio is not available.
  const [audio, setAudio] = useState<{ url: string; blob: Blob } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { audioRef, playSegment } = useSegmentPlayer();
  const waveform = useWaveform(audio?.blob ?? null);
  const markers = useMemo(() => buildMarkers(detail?.report), [detail?.report]);

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
        if (cancelled) return;
        if (!b) {
          setAudio(null);
          return;
        }
        url = URL.createObjectURL(b);
        setAudio({ url, blob: b });
      })
      .catch(() => {
        if (!cancelled) setAudio(null);
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

  if (error) return <div className="banner tone-setaside" role="alert"><p className="banner-text">{error}</p></div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { run, report, transcript, raw } = detail;
  const names = new Map((report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));

  return (
    <TimelineLinkProvider>
      <header className="page-intro">
        <h1 className="run-title">{run.file.name}</h1>
        <dl className="meta">
          <div><dt>Uploaded (UTC)</dt><dd>{run.createdAt.replace("T", " ").slice(0, 19)}</dd></div>
          <div><dt>Status</dt><dd><StatusMark tone={runTone(run)}>{runBadge(run)}</StatusMark></dd></div>
          <div><dt>Duration</dt><dd>{run.file.durationSec?.toFixed(1) ?? "—"} s</dd></div>
          <div><dt>Size</dt><dd>{(run.file.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd></div>
          <div><dt>Declared type</dt><dd>{run.file.declaredType || "none"}</dd></div>
          <div><dt>Detected format</dt><dd>{run.file.detectedFormat ?? "—"}</dd></div>
        </dl>
      </header>

      <RecordingTimeline
        audioRef={audioRef}
        audioSrc={audio?.url ?? null}
        durationSec={transcript?.durationSec ?? run.file.durationSec}
        waveform={waveform}
        markers={markers}
        onPlay={playSegment}
        missingAudioNote={audio === null ? "Audio not available." : undefined}
      />
      {run.rejection ? (
        <div className="banner tone-setaside" role="alert">
          <p className="banner-title">Rejected ({run.rejection.code})</p>
          <p className="banner-text">{run.rejection.message}</p>
        </div>
      ) : null}

      {report ? <ReportView report={report} onPlay={playSegment} /> : null}
      {transcript ? <TranscriptView transcript={transcript} onPlay={playSegment} names={names} /> : null}

      <section className="report-section">
        <h2>What happened</h2>
        <EventLog events={run.events} />
      </section>
      <MetricsView metrics={{ stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost }} />
      {raw ? (
        <details className="section-details">
          <summary>Raw API responses</summary>
          <h3>Deepgram</h3><pre>{JSON.stringify(raw.deepgram, null, 2)}</pre>
          <h3>Claude</h3><pre>{JSON.stringify(raw.claude, null, 2)}</pre>
        </details>
      ) : null}
      <div className="danger-zone">
        {deleteError ? <div className="banner tone-setaside" role="alert"><p className="banner-text">{deleteError}</p></div> : null}
        <button type="button" className="btn btn-danger" onClick={() => void remove()}>Delete run</button>
      </div>
    </TimelineLinkProvider>
  );
}
