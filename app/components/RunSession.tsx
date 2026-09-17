"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { clientFileCheck, type ClientCheck } from "@/app/components/clientFileCheck";
import { initialSteps, progressPercent, type StepName, type Steps, type StepState } from "@/app/components/progressModel";
import { putWithProgress } from "@/app/components/putWithProgress";
import type { Run, UploadTarget } from "@/lib/types";

const UPLOAD_TARGET_TTL_MS = 14 * 60 * 1000;
const TICK_MS = 250;

/** Steps the client drives with a request; "verify" finishes inside the extract request. */
export type RequestStep = Exclude<StepName, "verify">;
const REQUEST_ORDER: RequestStep[] = ["upload", "transcribe", "extract"];

function lastFailure(run: Run): string {
  return [...run.events].reverse().find((e) => e.type === "failed")?.detail ?? `Run ${run.status}`;
}

type RunSession = {
  file: File | null;
  check: ClientCheck | null;
  steps: Steps;
  /** Ticks every 250 ms while a step runs; the progress card and the header badge share it. */
  now: number;
  percent: number;
  busy: boolean;
  error: string | null;
  failedStep: RequestStep | null;
  runId: string | null;
  detail: RunDetail | null;
  choose: (f: File | undefined) => void;
  process: (from: RequestStep) => Promise<void>;
};

const RunSessionContext = createContext<RunSession | null>(null);

/**
 * Holds one run (file, steps, result) for the whole app. It lives in the root layout, which Next.js
 * keeps mounted across navigation, so switching to History and back does not reset a run in progress.
 */
export function RunSessionProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ClientCheck | null>(null);
  const [steps, setSteps] = useState<Steps>(initialSteps);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<RequestStep | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{ target: UploadTarget; createdAt: number } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let cancelled = false;
    void clientFileCheck(file, url).then((r) => {
      if (!cancelled) setCheck(r);
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const choose = useCallback((f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setCheck(null);
    setDetail(null);
    setError(null);
    setFailedStep(null);
    setRunId(null);
    setUploadTarget(null);
    setSteps(initialSteps());
  }, []);

  const process = useCallback(
    async (from: RequestStep) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      setFailedStep(null);
      const patchStep = (s: StepName, patch: Partial<StepState>) => setSteps((prev) => ({ ...prev, [s]: { ...prev[s], ...patch } }));
      const failStep = (s: StepName, ms: number) => {
        const at = performance.now();
        setSteps((prev) => ({ ...prev, [s]: { ...prev[s], status: "failed", ms, frozenPercent: progressPercent(prev, at) } }));
      };
      // The detail fetch happens after a stage already succeeded, so its failure must not fail the stage.
      const loadDetail = async (id: string) => {
        try {
          setDetail(await api<RunDetail>(`/api/runs/${id}`));
          return true;
        } catch {
          setError("The result is ready but could not be loaded. Open it from History.");
          return false;
        }
      };

      let id = runId;
      for (const s of REQUEST_ORDER.slice(REQUEST_ORDER.indexOf(from))) {
        const t0 = performance.now();
        setNow(t0);
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
              const loaded = await loadDetail(id!);
              if (loaded) setError(run.rejection?.message ?? "File rejected");
              setBusy(false);
              return;
            }
            patchStep("transcribe", { status: "done", ms: performance.now() - t0 });
            if (run.status === "done") {
              // Declined before extraction: nothing left to run.
              patchStep("extract", { status: "done" });
              patchStep("verify", { status: "done" });
              await loadDetail(id!);
              setBusy(false);
              return;
            }
          } else {
            const { run, report } = await api<{ run: Run; report: unknown }>(`/api/runs/${id}/extract`, { method: "POST" });
            if (!report) throw new Error(lastFailure(run));
            patchStep("extract", { status: "done", ms: run.stageMs.extract ?? performance.now() - t0 });
            patchStep("verify", { status: "done", ms: run.stageMs.verify });
            await loadDetail(id!);
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
    },
    [file, runId, uploadTarget],
  );

  const percent = progressPercent(steps, now);
  const value = useMemo(
    () => ({ file, check, steps, now, percent, busy, error, failedStep, runId, detail, choose, process }),
    [file, check, steps, now, percent, busy, error, failedStep, runId, detail, choose, process],
  );
  return <RunSessionContext.Provider value={value}>{children}</RunSessionContext.Provider>;
}

export function useRunSession(): RunSession {
  const value = useContext(RunSessionContext);
  if (!value) throw new Error("useRunSession must be used inside RunSessionProvider");
  return value;
}
