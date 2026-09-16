"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { clientFileCheck, type ClientCheck } from "@/app/components/clientFileCheck";
import { MetricsView } from "@/app/components/MetricsView";
import { RecordingTimeline } from "@/app/components/RecordingTimeline";
import { buildMarkers } from "@/app/components/reportModel";
import { ReportView } from "@/app/components/ReportView";
import { initialSteps, ORDER, StageSequence, type StepName, type StepState } from "@/app/components/StageSequence";
import { TimelineLinkProvider } from "@/app/components/timelineLink";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";
import { useWaveform } from "@/app/components/useWaveform";
import type { Run, UploadTarget } from "@/lib/types";

const UPLOAD_TARGET_TTL_MS = 14 * 60 * 1000;

function lastFailure(run: Run): string {
  return [...run.events].reverse().find((e) => e.type === "failed")?.detail ?? `Run ${run.status}`;
}

export function Uploader() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ClientCheck | null>(null);
  const [steps, setSteps] = useState(initialSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<StepName | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{ target: UploadTarget; createdAt: number } | null>(null);
  const { audioRef, playSegment } = useSegmentPlayer();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  // Draw the waveform only for a file that passed the client check.
  const waveform = useWaveform(file && check?.ok ? file : null);
  const markers = useMemo(() => buildMarkers(detail?.report), [detail?.report]);

  function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setCheck(null);
    setDetail(null);
    setError(null);
    setFailedStep(null);
    setRunId(null);
    setUploadTarget(null);
    setSteps(initialSteps());
  }

  useEffect(() => {
    if (!file || !objectUrl) return;
    let cancelled = false;
    void clientFileCheck(file, objectUrl).then((r) => {
      if (!cancelled) setCheck(r);
    });
    return () => {
      cancelled = true;
    };
  }, [file, objectUrl]);

  const setStep = (s: StepName, state: StepState) => setSteps((prev) => ({ ...prev, [s]: state }));

  async function process(from: StepName) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setFailedStep(null);
    let id = runId;
    for (const s of ORDER.slice(ORDER.indexOf(from))) {
      setStep(s, { status: "running" });
      const t0 = performance.now();
      try {
        if (s === "upload") {
          const target = id && uploadTarget && Date.now() - uploadTarget.createdAt < UPLOAD_TARGET_TTL_MS
            ? uploadTarget.target
            : await (async () => {
                const created = await api<{ runId: string; upload: UploadTarget }>("/api/runs", {
                  method: "POST",
                  body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, declaredType: file.type }),
                });
                id = created.runId;
                setRunId(id);
                setUploadTarget({ target: created.upload, createdAt: Date.now() });
                return created.upload;
              })();
          const put = await fetch(target.url, { method: target.method, headers: target.headers, body: file });
          if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        } else if (s === "transcribe") {
          const { run } = await api<{ run: Run }>(`/api/runs/${id}/transcribe`, { method: "POST" });
          if (run.status === "failed") throw new Error(lastFailure(run));
          if (run.status === "rejected" || run.status === "done") {
            setStep(s, { status: run.status === "rejected" ? "failed" : "done", ms: performance.now() - t0 });
            setDetail(await api<RunDetail>(`/api/runs/${id}`));
            setBusy(false);
            return;
          }
        } else {
          const { run, report } = await api<{ run: Run; report: unknown }>(`/api/runs/${id}/extract`, { method: "POST" });
          if (!report) throw new Error(lastFailure(run));
          setDetail(await api<RunDetail>(`/api/runs/${id}`));
        }
        setStep(s, { status: "done", ms: performance.now() - t0 });
      } catch (e) {
        setStep(s, { status: "failed", ms: performance.now() - t0 });
        setError(e instanceof Error ? e.message : String(e));
        setFailedStep(s);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  }

  const names = new Map((detail?.report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));
  const openPicker = () => inputRef.current?.click();
  const usable = file != null && check?.ok !== false;

  return (
    <TimelineLinkProvider>
      <header className="page-intro">
        <h1>Final commitments from a recorded discussion</h1>
        <p className="lede">Upload an English recording up to 3 minutes with two speakers who introduce themselves. Every item links to the moment it was said.</p>
      </header>

      <input ref={inputRef} id="audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac" hidden onChange={(e) => choose(e.target.files?.[0])} />
      <RecordingTimeline
        audioRef={audioRef}
        audioSrc={objectUrl}
        durationSec={check?.ok ? check.durationSec : null}
        waveform={waveform}
        markers={markers}
        onPlay={playSegment}
        onDropFile={choose}
        prompt={usable ? undefined : (
          <>
            <p className="timeline-prompt-text">Drop a recording here, or choose a file</p>
            <button type="button" className="btn btn-primary" onClick={openPicker}>Choose file</button>
          </>
        )}
      />

      {file ? (
        <div className="file-panel">
          <div className="file-row">
            <p className="file-facts">
              <span className="file-name">{file.name}</span>
              <span className="muted">
                {(file.size / 1024 / 1024).toFixed(2)} MB
                {check?.ok ? `, ${check.format.toUpperCase()}, ${check.durationSec?.toFixed(1) ?? "?"} s` : null}
              </span>
            </p>
            {usable ? <button type="button" className="btn btn-quiet" onClick={openPicker}>Choose a different file</button> : null}
          </div>
          {check === null ? <p className="muted" role="status">Checking the file…</p> : null}
          {check && !check.ok ? <div className="banner tone-setaside" role="alert"><p className="banner-text">{check.message}</p></div> : null}
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={!check?.ok || busy} onClick={() => void process("upload")}>Extract commitments</button>
            {failedStep && !busy ? <button type="button" className="btn" onClick={() => void process(failedStep === "upload" || !runId ? "upload" : failedStep)}>Retry</button> : null}
          </div>
        </div>
      ) : null}

      {runId ? <StageSequence steps={steps} /> : null}
      {error ? <div className="banner tone-setaside" role="alert"><p className="banner-text">{error}</p></div> : null}

      {detail?.run.status === "rejected" && detail.run.rejection ? (
        <div className="banner tone-setaside" role="alert">
          <p className="banner-title">File rejected by the server check.</p>
          <p className="banner-text">{detail.run.rejection.message}</p>
        </div>
      ) : null}

      {detail?.report ? <ReportView report={detail.report} onPlay={playSegment} /> : null}
      {detail?.transcript ? <TranscriptView transcript={detail.transcript} onPlay={playSegment} names={names} /> : null}
      {detail ? (
        <>
          <MetricsView metrics={{ stageMs: detail.run.stageMs, timeToResultMs: detail.run.timeToResultMs, usage: detail.run.usage, cost: detail.run.cost }} />
          <div className="actions actions-end">
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
        </>
      ) : null}
    </TimelineLinkProvider>
  );
}
