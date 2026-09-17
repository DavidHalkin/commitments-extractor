"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { CommitmentList } from "@/app/components/CommitmentList";
import { EventLog } from "@/app/components/EventLog";
import { MetricsView } from "@/app/components/MetricsView";
import { RecordingTimeline } from "@/app/components/RecordingTimeline";
import { buildMarkers } from "@/app/components/reportModel";
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

  if (error) return <div className="notice-card tone-setaside" role="alert"><p>{error}</p></div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { run, report, transcript, raw } = detail;
  const names = new Map((report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));

  return (
    <TimelineLinkProvider>
      <header className="run-header card">
        <div className="run-header-top">
          <h1 className="run-title">{run.file.name}</h1>
          <StatusMark tone={runTone(run)}>{runBadge(run)}</StatusMark>
        </div>
        <dl className="meta">
          <div><dt>Uploaded (UTC)</dt><dd>{run.createdAt.replace("T", " ").slice(0, 19)}</dd></div>
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
        <div className="notice-card tone-setaside" role="alert">
          <p className="notice-card-title">File rejected ({run.rejection.code})</p>
          <p>{run.rejection.message}</p>
        </div>
      ) : null}

      {report ? <CommitmentList report={report} onPlay={playSegment} /> : null}

      <details className="details card">
        <summary>Details</summary>
        {transcript ? <TranscriptView transcript={transcript} onPlay={playSegment} names={names} /> : null}
        <details className="section-details">
          <summary>What happened</summary>
          <EventLog events={run.events} />
        </details>
        <MetricsView metrics={{ stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost }} />
        {raw ? (
          <details className="section-details">
            <summary>Raw API responses</summary>
            <h3>Deepgram</h3><pre>{JSON.stringify(raw.deepgram, null, 2)}</pre>
            <h3>LLM (AI Gateway)</h3><pre>{JSON.stringify(raw.llm, null, 2)}</pre>
          </details>
        ) : null}
      </details>
      <div className="danger-zone">
        {deleteError ? <div className="notice-card tone-setaside" role="alert"><p>{deleteError}</p></div> : null}
        <button type="button" className="btn btn-danger" onClick={() => void remove()}>Delete run</button>
      </div>
    </TimelineLinkProvider>
  );
}
