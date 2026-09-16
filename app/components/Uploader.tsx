"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { clientFileCheck, type ClientCheck } from "@/app/components/clientFileCheck";
import { MetricsView } from "@/app/components/MetricsView";
import { ReportView } from "@/app/components/ReportView";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";
import { formatMs } from "@/lib/format";
import type { Run, UploadTarget } from "@/lib/types";

type StepName = "upload" | "transcribe" | "extract";
type StepState = { status: "pending" | "running" | "done" | "failed"; ms?: number };
const ORDER: StepName[] = ["upload", "transcribe", "extract"];
const LABEL: Record<StepName, string> = {
  upload: "Uploading",
  transcribe: "Checking file and transcribing",
  extract: "Extracting and verifying",
};
const ICON = { pending: "○", running: "…", done: "✓", failed: "✗" } as const;
const initialSteps = (): Record<StepName, StepState> => ({ upload: { status: "pending" }, transcribe: { status: "pending" }, extract: { status: "pending" } });

function lastFailure(run: Run): string {
  return [...run.events].reverse().find((e) => e.type === "failed")?.detail ?? `Run ${run.status}`;
}

export function Uploader() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ClientCheck | null>(null);
  const [over, setOver] = useState(false);
  const [steps, setSteps] = useState(initialSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<StepName | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const { audioRef, playSegment } = useSegmentPlayer();

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  async function choose(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setCheck(null);
    setDetail(null);
    setError(null);
    setFailedStep(null);
    setRunId(null);
    setSteps(initialSteps());
  }

  useEffect(() => {
    if (file && objectUrl) void clientFileCheck(file, objectUrl).then(setCheck);
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
          const created = await api<{ runId: string; upload: UploadTarget }>("/api/runs", {
            method: "POST",
            body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, declaredType: file.type }),
          });
          id = created.runId;
          setRunId(id);
          const put = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: file });
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

  return (
    <div>
      <h1>Recorded conversation → final commitments</h1>
      <p className="muted">Upload an English recording (up to 3 minutes, two speakers who introduce themselves). You get the final tasks, owners, deadlines and open questions, each with a quote you can play.</p>

      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void choose(e.dataTransfer.files[0]); }}
      >
        <p>Drop an audio file here</p>
        <input id="audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <button type="button" onClick={() => document.getElementById("audio-file")?.click()}>Choose file</button>
      </div>

      {file ? (
        <div className="card">
          <div className="row"><strong>{file.name}</strong><span className="muted">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
            {check?.ok ? <span className="muted">{check.format.toUpperCase()}, {check.durationSec?.toFixed(1) ?? "?"} s</span> : null}
          </div>
          {objectUrl ? <audio ref={audioRef} src={objectUrl} controls preload="metadata" /> : null}
          {check && !check.ok ? <div className="banner bad">{check.message}</div> : null}
          <div className="row">
            <button type="button" className="primary" disabled={!check?.ok || busy} onClick={() => void process("upload")}>Extract commitments</button>
            {failedStep && !busy ? <button type="button" onClick={() => void process(failedStep === "upload" || !runId ? "upload" : failedStep)}>Retry</button> : null}
          </div>
        </div>
      ) : null}

      {runId ? (
        <ul className="steps">
          {ORDER.map((s) => (
            <li key={s}>{ICON[steps[s].status]} {LABEL[s]} {steps[s].ms != null ? <span className="muted">{formatMs(steps[s].ms)}</span> : null}</li>
          ))}
        </ul>
      ) : null}
      {error ? <div className="banner bad">{error}</div> : null}

      {detail?.run.status === "rejected" && detail.run.rejection ? (
        <div className="banner bad"><strong>File rejected by the server check:</strong> {detail.run.rejection.message}</div>
      ) : null}

      {detail?.report ? <ReportView report={detail.report} onPlay={playSegment} /> : null}
      {detail?.transcript ? <TranscriptView transcript={detail.transcript} onPlay={playSegment} names={names} /> : null}
      {detail ? (
        <>
          <MetricsView metrics={{ stageMs: detail.run.stageMs, timeToResultMs: detail.run.timeToResultMs, usage: detail.run.usage, cost: detail.run.cost }} />
          <div className="row">
            {detail.report ? (
              <button type="button" onClick={() => {
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
    </div>
  );
}
