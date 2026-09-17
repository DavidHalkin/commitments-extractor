export type StepName = "upload" | "transcribe" | "extract" | "verify";
export type StepStatus = "pending" | "running" | "done" | "failed";
export type StepState = {
  status: StepStatus;
  /** `performance.now()` when the step started running. */
  startedAt?: number;
  /** Duration once the step finished or failed. */
  ms?: number;
  /** Real progress within the step (0–1), known only for the upload. */
  fraction?: number;
  /** Percent reached when the step failed; the bar stays there. */
  frozenPercent?: number;
};
export type Steps = Record<StepName, StepState>;

export const ORDER: StepName[] = ["upload", "transcribe", "extract", "verify"];

/** Share of the bar each step covers, in percent. */
export const SPAN: Record<StepName, [number, number]> = {
  upload: [0, 15],
  transcribe: [15, 30],
  extract: [30, 95],
  verify: [95, 100],
};

/** Typical durations (eval medians) that shape the time-based part of the bar. */
export const TYPICAL_MS: Partial<Record<StepName, number>> = { transcribe: 3_000, extract: 55_000 };

/** A time-based step never fills more than this share of its span before the server answers. */
export const TIME_CAP = 0.95;

export const STEP_LABEL: Record<StepName, string> = {
  upload: "Uploading",
  transcribe: "Transcribing",
  extract: "Finding commitments",
  verify: "Checking quotes",
};

export const STEP_HINT: Record<StepName, string> = {
  upload: "Sending the file to private storage.",
  transcribe: "Checking the file and turning speech into text with speaker labels.",
  extract: "The model reads the conversation and tracks what was agreed, changed or dropped. Usually under a minute.",
  verify: "Every item must match the transcript word for word.",
};

export const initialSteps = (): Steps => ({
  upload: { status: "pending" },
  transcribe: { status: "pending" },
  extract: { status: "pending" },
  verify: { status: "pending" },
});

/** Progress within a running step: real bytes for the upload, an ease-out curve on elapsed time otherwise. */
export function stepFraction(name: StepName, state: StepState, now: number): number {
  if (state.fraction != null) return Math.min(1, Math.max(0, state.fraction));
  const typical = TYPICAL_MS[name];
  if (!typical || state.startedAt == null) return 0;
  const elapsed = Math.max(0, now - state.startedAt);
  return TIME_CAP * (1 - Math.exp(-elapsed / typical));
}

/** Overall percent (integer 0–100) for the step states at time `now`. */
export function progressPercent(steps: Steps, now: number): number {
  let percent = 0;
  for (const name of ORDER) {
    const state = steps[name];
    const [from, to] = SPAN[name];
    if (state.status === "done") percent = to;
    else if (state.status === "running") percent = from + (to - from) * stepFraction(name, state, now);
    else if (state.status === "failed") return Math.floor(state.frozenPercent ?? from);
    else break;
  }
  return Math.floor(percent);
}

/** The step to show: the failed or running one, else the first pending one after the done ones, else the last. */
export function currentStep(steps: Steps): { name: StepName; index: number; status: StepStatus } {
  const index = ORDER.findIndex((name) => steps[name].status !== "done");
  const i = index === -1 ? ORDER.length - 1 : index;
  return { name: ORDER[i], index: i, status: steps[ORDER[i]].status };
}

export function allDone(steps: Steps): boolean {
  return ORDER.every((name) => steps[name].status === "done");
}
