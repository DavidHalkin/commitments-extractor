"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { clientFileCheck, type ClientCheck } from "@/app/components/clientFileCheck";
import { CommitmentList } from "@/app/components/CommitmentList";
import { MetricsView } from "@/app/components/MetricsView";
import { ProgressMeter } from "@/app/components/ProgressMeter";
import { initialSteps, progressPercent, type StepName, type Steps, type StepState } from "@/app/components/progressModel";
import { putWithProgress } from "@/app/components/putWithProgress";
import { RecordingTimeline } from "@/app/components/RecordingTimeline";
import { buildMarkers } from "@/app/components/reportModel";
import { TimelineLinkProvider } from "@/app/components/timelineLink";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";
import { useWaveform } from "@/app/components/useWaveform";
import type { Run, UploadTarget } from "@/lib/types";

const UPLOAD_TARGET_TTL_MS = 14 * 60 * 1000;

/** Steps the client drives with a request; "verify" finishes inside the extract request. */
type RequestStep = Exclude<StepName, "verify">;
const REQUEST_ORDER: RequestStep[] = ["upload", "transcribe", "extract"];

function lastFailure(run: Run): string {
  return [...run.events].reverse().find((e) => e.type === "failed")?.detail ?? `Run ${run.status}`;
}

export function Uploader() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ClientCheck | null>(null);
  const [steps, setSteps] = useState<Steps>(initialSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<RequestStep | null>(null);
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

  const patchStep = (s: StepName, patch: Partial<StepState>) => setSteps((prev) => ({ ...prev, [s]: { ...prev[s], ...patch } }));
  const failStep = (s: StepName, ms: number) => {
    const at = performance.now();
    setSteps((prev) => ({ ...prev, [s]: { ...prev[s], status: "failed", ms, frozenPercent: progressPercent(prev, at) } }));
  };

  async function process(from: RequestStep) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setFailedStep(null);
    let id = runId;
    for (const s of REQUEST_ORDER.slice(REQUEST_ORDER.indexOf(from))) {
      const t0 = performance.now();
      setSteps((prev) => ({ ...prev, [s]: { status: "running", startedAt: t0, ...(s === "upload" ? { fraction: 0 } : {}) } }));
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
          const put = await putWithProgress(target.url, target.method, target.headers, file, (fraction) => patchStep("upload", { fraction }));
          if (!put.ok) throw new Error(`Upload failed (${put.status})`);
          patchStep("upload", { status: "done", ms: performance.now() - t0 });
        } else if (s === "transcribe") {
          const { run } = await api<{ run: Run }>(`/api/runs/${id}/transcribe`, { method: "POST" });
          if (run.status === "failed") throw new Error(lastFailure(run));
          if (run.status === "rejected") {
            failStep("transcribe", performance.now() - t0);
            try {
              const d = await api<RunDetail>(`/api/runs/${id}`);
              setDetail(d);
              setError(d.run.rejection?.message ?? "File rejected");
            } catch {
              setError("The result is ready but could not be loaded. Open it from History.");
            }
            setBusy(false);
            return;
          }
          patchStep("transcribe", { status: "done", ms: performance.now() - t0 });
          if (run.status === "done") {
            // Declined before extraction: nothing left to run.
            patchStep("extract", { status: "done" });
            patchStep("verify", { status: "done" });
            try {
              setDetail(await api<RunDetail>(`/api/runs/${id}`));
            } catch {
              setError("The result is ready but could not be loaded. Open it from History.");
            }
            setBusy(false);
            return;
          }
        } else {
          const { run, report } = await api<{ run: Run; report: unknown }>(`/api/runs/${id}/extract`, { method: "POST" });
          if (!report) throw new Error(lastFailure(run));
          patchStep("extract", { status: "done", ms: run.stageMs.extract ?? performance.now() - t0 });
          patchStep("verify", { status: "done", ms: run.stageMs.verify });
          try {
            setDetail(await api<RunDetail>(`/api/runs/${id}`));
          } catch {
            setError("The result is ready but could not be loaded. Open it from History.");
          }
        }
      } catch (e) {
        failStep(s, performance.now() - t0);
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

      {runId ? <ProgressMeter steps={steps} error={error} /> : null}
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
