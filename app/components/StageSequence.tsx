import { formatMs } from "@/lib/format";

export type StepName = "upload" | "transcribe" | "extract";
export type StepState = { status: "pending" | "running" | "done" | "failed"; ms?: number };

export const ORDER: StepName[] = ["upload", "transcribe", "extract"];
const LABEL: Record<StepName, string> = {
  upload: "Uploading",
  transcribe: "Checking file and transcribing",
  extract: "Extracting and verifying",
};
const GLYPH = { pending: "○", running: "◐", done: "✓", failed: "✗" } as const;
const SPOKEN = { pending: "waiting", running: "in progress", done: "done", failed: "failed" } as const;

export const initialSteps = (): Record<StepName, StepState> => ({
  upload: { status: "pending" },
  transcribe: { status: "pending" },
  extract: { status: "pending" },
});

/** The three processing stages in order, each with its state glyph and duration. */
export function StageSequence({ steps }: { steps: Record<StepName, StepState> }) {
  return (
    <ol className="stages" aria-label="Processing" aria-live="polite">
      {ORDER.map((s) => (
        <li key={s} className={`stage is-${steps[s].status}`}>
          <span className="stage-glyph" aria-hidden="true">{GLYPH[steps[s].status]}</span>
          <span className="stage-label">{LABEL[s]}</span>
          <span className="sr-only">{SPOKEN[steps[s].status]}</span>
          {steps[s].ms != null ? <span className="stage-time">{formatMs(steps[s].ms)}</span> : null}
        </li>
      ))}
    </ol>
  );
}
