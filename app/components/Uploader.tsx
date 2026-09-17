"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { CommitmentList } from "@/app/components/CommitmentList";
import { MetricsView } from "@/app/components/MetricsView";
import { ProgressMeter } from "@/app/components/ProgressMeter";
import { RecordingTimeline } from "@/app/components/RecordingTimeline";
import { buildMarkers } from "@/app/components/reportModel";
import { useRunSession } from "@/app/components/RunSession";
import { TimelineLinkProvider } from "@/app/components/timelineLink";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";
import { useWaveform } from "@/app/components/useWaveform";

export function Uploader() {
  const { file, check, steps, now, percent, busy, error, failedStep, runId, detail, choose, process } = useRunSession();
  const { audioRef, playSegment } = useSegmentPlayer();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  // Draw the waveform only for a file that passed the client check.
  const waveform = useWaveform(file && check?.ok ? file : null);
  const markers = useMemo(() => buildMarkers(detail?.report), [detail?.report]);

  const names = new Map((detail?.report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));
  const openPicker = () => inputRef.current?.click();
  const usable = file != null && check?.ok !== false;
  const rejection = detail?.run.status === "rejected" ? detail.run.rejection : null;

  return (
    <TimelineLinkProvider>
      <header className="hero">
        <h1>Recording in. Commitments out.</h1>
        <p className="lede">English, two speakers who introduce themselves, up to 3 minutes. Every item links to the moment it was said.</p>
      </header>

      <input ref={inputRef} id="audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac" hidden onChange={(e) => choose(e.target.files?.[0])} />
      <RecordingTimeline
        audioRef={audioRef}
        audioSrc={objectUrl}
        durationSec={check?.ok ? check.durationSec : null}
        waveform={waveform}
        markers={markers}
        onPlay={playSegment}
        onDropFile={busy ? undefined : choose}
        prompt={usable ? undefined : (
          <>
            <p className="timeline-prompt-text">Drop a recording here</p>
            <button type="button" className="btn btn-primary" onClick={openPicker}>Choose file</button>
          </>
        )}
      />

      {file ? (
        <div className="file-panel">
          <p className="file-facts">
            <span className="file-name">{file.name}</span>
            <span className="muted">
              {(file.size / 1024 / 1024).toFixed(2)} MB
              {check?.ok ? ` · ${check.format.toUpperCase()} · ${check.durationSec?.toFixed(1) ?? "?"} s` : null}
            </span>
          </p>
          {check === null ? <p className="muted" role="status">Checking the file…</p> : null}
          {check && !check.ok ? <div className="notice-card tone-setaside" role="alert"><p>{check.message}</p></div> : null}
          <div className="actions">
            {!runId || failedStep ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!check?.ok || busy}
                onClick={() => void process(failedStep && runId ? failedStep : "upload")}
              >
                {failedStep ? "Try again" : "Find commitments"}
              </button>
            ) : null}
            {usable && !busy ? <button type="button" className="btn" onClick={openPicker}>Choose a different file</button> : null}
          </div>
        </div>
      ) : null}

      {runId ? <ProgressMeter steps={steps} percent={percent} now={now} error={error} /> : null}
      {!runId && error ? <div className="notice-card tone-setaside" role="alert"><p>{error}</p></div> : null}

      {rejection ? (
        <div className="notice-card tone-setaside" role="alert">
          <p className="notice-card-title">File rejected</p>
          <p>{rejection.message}</p>
          <div className="actions"><button type="button" className="btn" onClick={openPicker}>Choose another file</button></div>
        </div>
      ) : null}

      {detail?.report ? <CommitmentList report={detail.report} onPlay={playSegment} /> : null}
      {detail && !rejection ? (
        <details className="details card">
          <summary>Details</summary>
          {detail.transcript ? <TranscriptView transcript={detail.transcript} onPlay={playSegment} names={names} /> : null}
          <MetricsView metrics={{ stageMs: detail.run.stageMs, timeToResultMs: detail.run.timeToResultMs, usage: detail.run.usage, cost: detail.run.cost }} />
          <div className="actions">
            {detail.report ? (
              <button type="button" className="btn" onClick={() => {
                const blob = new Blob([JSON.stringify({ report: detail.report, transcript: detail.transcript }, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `commitments-${detail.run.id}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}>Download JSON</button>
            ) : null}
            <Link href={`/history/${detail.run.id}`}>Open this run in History</Link>
          </div>
        </details>
      ) : null}
    </TimelineLinkProvider>
  );
}
