"use client";

import { useEffect, useState } from "react";
import {
  allDone,
  currentStep,
  ORDER,
  progressPercent,
  STEP_HINT,
  STEP_LABEL,
  type Steps,
} from "@/app/components/progressModel";
import { formatMs } from "@/lib/format";

const TICK_MS = 250;

/** One large bar for the whole run: percent, current step, elapsed time and a plain-language line. */
export function ProgressMeter({ steps, error }: { steps: Steps; error: string | null }) {
  const running = ORDER.some((name) => steps[name].status === "running");
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // `now` comes from the interval tick while a step runs (0 before the first tick); finished and failed steps do not depend on time.
  const percent = progressPercent(steps, now);
  const step = currentStep(steps);
  const state = steps[step.name];
  const finished = allDone(steps);
  const failed = step.status === "failed";
  const elapsedMs = state.status === "running" && state.startedAt != null ? Math.max(0, now - state.startedAt) : state.ms;
  const title = finished ? "Done" : STEP_LABEL[step.name];
  const announcement = failed ? `${STEP_LABEL[step.name]} failed` : finished ? "Done" : STEP_LABEL[step.name];

  return (
    <section className={`progress card${failed ? " is-failed" : ""}${finished ? " is-finished" : ""}`} aria-label="Processing">
      <p className="progress-percent" aria-hidden="true">{percent}%</p>
      <h2 className="progress-title">{title}</h2>
      <p className="progress-meta">
        {finished ? "All steps finished" : `Step ${step.index + 1} of ${ORDER.length}`}
        {!finished && elapsedMs != null ? ` · ${Math.floor(elapsedMs / 1000)} s` : null}
      </p>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${title}, ${percent} percent`}
      >
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-hint">{failed ? error ?? "This step failed." : finished ? "Your commitments are below." : STEP_HINT[step.name]}</p>
      <ol className="progress-steps">
        {ORDER.map((name) => {
          const s = steps[name];
          return (
            <li key={name} className={`progress-step is-${s.status}`}>
              <span className="progress-step-icon" aria-hidden="true">{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.status === "running" ? "•" : ""}</span>
              <span>{STEP_LABEL[name]}</span>
              <span className="sr-only">{s.status}</span>
              {s.status === "done" && s.ms != null ? <span className="progress-step-time">{formatMs(s.ms)}</span> : null}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}
