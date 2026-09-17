# Playful UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole browser UI in the lispr.ai visual language, replace the static stage line with one honest progress bar, and show the report as a compact expandable list.

**Architecture:** Pure view models (`progressModel.ts`, `summaryCounts` in `reportModel.ts`) carry the logic and are unit-tested. New presentational components (`ProgressMeter`, `CommitmentList`, `CommitmentRow`) and an XHR upload helper replace `StageSequence`, `ReportView` and `LedgerRow`. `app/globals.css` is rewritten around new tokens; pages keep their data flow and API calls.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript strict, plain CSS, `next/font/google` (Fredoka, Inter), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-17-playful-ui-redesign-design.md`

## Global Constraints

- All UI text, code and comments in English.
- Shared-history notice text, verbatim: "Uploads are visible to everyone who opens this demo and are deleted after 30 days."
- Tokens: `--bg #fbf1df`, `--bg-2 #fff8ec`, `--surface #ffffff`, `--ink #241d3a`, `--mut #6a637e`, `--line #e7ddc6`, `--shadow #c9a23a`, `--agreed #11c2d4` / `#d8f6f8`, `--unsettled #ffbe2e` / `#fff1cf`, `--setaside #ff6a4d` / `#ffe6df`, `--accent #7b5cff` / `#f1edff`.
- Fonts: Fredoka 500/600/700 (display), Inter 400/500/600 normal+italic (body).
- Progress spans: upload 0–15, transcribe 15–30, extract 30–95, verify 95–100; typical ms: transcribe 3000, extract 55000; time-based fraction `0.95 × (1 − e^(−elapsed/typical))`.
- Status colour is never the only signal: every status has an icon and a text label (visible or `sr-only`).
- All motion is disabled under `prefers-reduced-motion: reduce`.
- No new npm dependencies. No changes under `lib/` or `app/api/`.
- React compiler lint rules apply (`npm run lint`): no impure calls such as `performance.now()` during render.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

```
app/components/progressModel.ts     (new)  step states, spans, percent, current step, labels and hints
app/components/putWithProgress.ts   (new)  XHR upload with progress callback
app/components/ProgressMeter.tsx    (new)  the progress card; replaces StageSequence.tsx
app/components/CommitmentRow.tsx    (new)  Chip, ItemRow, ClarificationRow, DroppedRow
app/components/CommitmentList.tsx   (new)  status card, summary, groups; replaces ReportView.tsx + LedgerRow.tsx
app/components/reportModel.ts       (mod)  summaryCounts, exported itemEvidence
app/components/timelineLink.tsx     (mod)  openRequest / openEvidence
app/components/TimelineMarkerLayer.tsx (mod) marker click opens its row
app/components/MetricsView.tsx      (mod)  collapsed by default
app/components/Uploader.tsx         (mod)  new layout, four-step progress, XHR upload
app/layout.tsx                      (mod)  Fredoka + Inter, header
app/history/page.tsx                (mod)  run cards
app/history/[id]/page.tsx           (mod)  header card, list, Details block
app/globals.css                     (rewrite)
tests/app/progressModel.test.ts     (new)
tests/app/reportModel.test.ts       (new)
deleted: app/components/StageSequence.tsx, ReportView.tsx, LedgerRow.tsx
```

---

### Task 1: Progress model and upload helper

**Files:**
- Create: `app/components/progressModel.ts`, `app/components/putWithProgress.ts`, `tests/app/progressModel.test.ts`

**Interfaces:**
- Produces:
  - `type StepName = "upload" | "transcribe" | "extract" | "verify"`; `type StepStatus = "pending" | "running" | "done" | "failed"`;
    `type StepState = { status; startedAt?: number; ms?: number; fraction?: number; frozenPercent?: number }`; `type Steps = Record<StepName, StepState>`.
  - `ORDER`, `SPAN`, `TYPICAL_MS`, `TIME_CAP`, `STEP_LABEL`, `STEP_HINT`, `initialSteps()`.
  - `stepFraction(name, state, now): number`, `progressPercent(steps, now): number` (integer), `currentStep(steps): { name; index; status }`, `allDone(steps): boolean`.
  - `putWithProgress(url, method, headers, body: Blob, onProgress: (fraction) => void): Promise<{ ok: boolean; status: number }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/app/progressModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  allDone,
  currentStep,
  initialSteps,
  ORDER,
  progressPercent,
  SPAN,
  stepFraction,
  TIME_CAP,
  type Steps,
} from "@/app/components/progressModel";

const with_ = (patch: Partial<Steps>): Steps => ({ ...initialSteps(), ...patch });

describe("progress spans", () => {
  it("cover 0–100 without gaps, in step order", () => {
    let expected = 0;
    for (const name of ORDER) {
      expect(SPAN[name][0]).toBe(expected);
      expected = SPAN[name][1];
    }
    expect(expected).toBe(100);
  });
});

describe("progressPercent", () => {
  it("is 0 before anything runs and 100 when every step is done", () => {
    expect(progressPercent(initialSteps(), 0)).toBe(0);
    const done = { status: "done" as const };
    expect(progressPercent({ upload: done, transcribe: done, extract: done, verify: done }, 0)).toBe(100);
  });

  it("moves the upload by real bytes", () => {
    expect(progressPercent(with_({ upload: { status: "running", startedAt: 0, fraction: 0.5 } }), 99_999)).toBe(7);
  });

  it("moves transcription and extraction by time, slowing down and never reaching the end of the step", () => {
    const at = (elapsed: number) =>
      progressPercent(with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "running", startedAt: 1_000 } }), 1_000 + elapsed);
    expect(at(0)).toBe(30);
    const values = [5_000, 20_000, 55_000, 120_000, 600_000].map(at);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(at(55_000)).toBeGreaterThan(60);
    expect(at(10 * 60_000)).toBeLessThan(95);
  });

  it("keeps the time-based fraction under the cap at any elapsed time", () => {
    for (const elapsed of [0, 1, 1_000, 55_000, 1e9]) {
      expect(stepFraction("extract", { status: "running", startedAt: 0 }, elapsed)).toBeLessThan(TIME_CAP + 1e-9);
    }
  });

  it("jumps to the end of extraction and verification when the extract response arrives", () => {
    const steps = with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "done" }, verify: { status: "done" } });
    expect(progressPercent(steps, 0)).toBe(100);
  });

  it("freezes at the percent reached when a step fails", () => {
    const steps = with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "failed", frozenPercent: 71.6 } });
    expect(progressPercent(steps, 1e9)).toBe(71);
  });
});

describe("currentStep", () => {
  it("points at the first step that is not done", () => {
    expect(currentStep(initialSteps())).toEqual({ name: "upload", index: 0, status: "pending" });
    expect(currentStep(with_({ upload: { status: "done" }, transcribe: { status: "running", startedAt: 0 } }))).toEqual({ name: "transcribe", index: 1, status: "running" });
    expect(currentStep(with_({ upload: { status: "done" }, transcribe: { status: "failed" } }))).toEqual({ name: "transcribe", index: 1, status: "failed" });
  });

  it("points at the last step when everything is done", () => {
    const done = { status: "done" as const };
    const steps = { upload: done, transcribe: done, extract: done, verify: done };
    expect(currentStep(steps)).toEqual({ name: "verify", index: 3, status: "done" });
    expect(allDone(steps)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/progressModel.test.ts`
Expected: FAIL — cannot resolve `@/app/components/progressModel`.

- [ ] **Step 3: Write the model**

Create `app/components/progressModel.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/progressModel.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the upload helper**

Create `app/components/putWithProgress.ts`:

```ts
/**
 * PUT/POST a body with upload progress. `fetch` cannot report request-body progress,
 * so this uses XMLHttpRequest with the same URL, method and headers.
 * Network errors reject; HTTP errors resolve with `ok: false`.
 */
export function putWithProgress(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(body);
  });
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (existing 97 tests + 9 new).

```bash
git add app/components/progressModel.ts app/components/putWithProgress.ts tests/app/progressModel.test.ts
git commit -m "feat: progress model with honest time-based steps and XHR upload helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Report list and progress components

**Files:**
- Create: `app/components/ProgressMeter.tsx`, `app/components/CommitmentRow.tsx`, `app/components/CommitmentList.tsx`, `tests/app/reportModel.test.ts`
- Modify: `app/components/reportModel.ts`, `app/components/timelineLink.tsx`, `app/components/TimelineMarkerLayer.tsx`

**Interfaces:**
- Consumes: Task 1 `progressModel` exports; existing `EvidenceLine`, `OnPlay`, `evidenceKey`, `showFields`, `tasksBy`, `Tone`, `formatMs`.
- Produces:
  - `reportModel.ts`: `type SummaryCounts = { agreed: number; toClarify: number; notCommitments: number }`, `summaryCounts(report)`, `itemEvidence(item): Evidence[]` (exported; renamed from the private `displayedEvidence`).
  - `timelineLink.tsx`: context adds `openRequest: { key: string; nonce: number } | null` and `openEvidence(key: string)`; `type OpenRequest`.
  - `<ProgressMeter steps={Steps} error={string | null} />`.
  - `CommitmentRow.tsx`: `Chip`, `ItemRow({ item, tone: "agreed" | "unsettled" | "setaside", onPlay })`, `ClarificationRow({ clarification, onPlay })`, `DroppedRow({ summary, reason })`.
  - `<CommitmentList report={Report} onPlay={OnPlay} />`.
  - Rows carry `data-evidence-keys` (space-separated evidence keys) so `openEvidence` can scroll to them.

- [ ] **Step 1: Write the failing test**

Create `tests/app/reportModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summaryCounts } from "@/app/components/reportModel";
import type { Clarification, Evidence, Report, VerifiedItem } from "@/lib/types";

const ev: Evidence = { type: "accepted", quote: "ok", utteranceId: "u1", speaker: 0, speakerName: "Anna", start: 1, end: 2 };

function item(kind: VerifiedItem["kind"], finalStatus: VerifiedItem["finalStatus"], summary: string): VerifiedItem {
  return {
    kind,
    summary,
    finalStatus,
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
    flags: [],
    events: [ev],
  };
}

const clarification = (about: Clarification["about"], question: string): Clarification => ({ about, itemSummary: question, question, evidence: ev });

function report(patch: Partial<Report>): Report {
  return { status: "ok", declineReasons: [], clarifications: [], speakers: [], items: [], dropped: [], metrics: null, ...patch };
}

describe("summaryCounts", () => {
  it("counts agreed tasks and everything set aside in an ok report", () => {
    const r = report({
      items: [
        item("task", "active", "Write the API docs"),
        item("task", "active", "Client demo"),
        item("task", "cancelled", "Customer survey"),
        item("task", "not_accepted", "Landing page"),
      ],
      dropped: [{ summary: "Invented task", reason: "quote not found" }],
    });
    expect(summaryCounts(r)).toEqual({ agreed: 2, toClarify: 0, notCommitments: 3 });
  });

  it("counts an open question once, through its clarification", () => {
    const r = report({
      status: "needs_clarification",
      items: [item("open_question", "open", "When is the report due?"), item("task", "not_accepted", "Update the road map")],
      clarifications: [clarification("question", "When is the report due?"), clarification("owner", "Who owns the client report?")],
    });
    expect(summaryCounts(r)).toEqual({ agreed: 0, toClarify: 2, notCommitments: 1 });
  });

  it("does not count active tasks as agreed unless the report is ok", () => {
    const r = report({ status: "declined", items: [item("task", "active", "Something")] });
    expect(summaryCounts(r).agreed).toBe(0);
  });
});
```

Run: `npx vitest run tests/app/reportModel.test.ts`
Expected: FAIL — `summaryCounts` is not exported.

- [ ] **Step 2: Extend the report model**

In `app/components/reportModel.ts`, insert before `/** Owner and deadline fields are shown…`:

```ts
export type SummaryCounts = { agreed: number; toClarify: number; notCommitments: number };

/** Header counts: active tasks, clarifications (which already include open questions), and everything set aside. */
export function summaryCounts(report: Report): SummaryCounts {
  return {
    agreed: report.status === "ok" ? tasksBy(report, "active").length : 0,
    toClarify: report.clarifications.length,
    notCommitments: tasksBy(report, "cancelled").length + tasksBy(report, "not_accepted").length + report.dropped.length,
  };
}
```

Replace `function displayedEvidence(item: VerifiedItem): Evidence[] {` with:

```ts
/** Evidence shown for an item: owner and deadline quotes when its fields are shown, then its event timeline. */
export function itemEvidence(item: VerifiedItem): Evidence[] {
```

and replace both remaining `displayedEvidence(item)` calls in `buildMarkers` with `itemEvidence(item)`.

Run: `npx vitest run tests/app/reportModel.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Let the timeline open rows**

Replace `app/components/timelineLink.tsx` with:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type OpenRequest = { key: string; nonce: number };

type TimelineLink = {
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  /** The last evidence moment picked on the timeline; rows that contain it open themselves. */
  openRequest: OpenRequest | null;
  openEvidence: (key: string) => void;
};

const TimelineLinkContext = createContext<TimelineLink>({
  activeKey: null,
  setActiveKey: () => {},
  openRequest: null,
  openEvidence: () => {},
});

/** Shares the hovered/focused evidence moment and "open the row for this moment" requests between the timeline and the report. */
export function TimelineLinkProvider({ children }: { children: ReactNode }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const openEvidence = useCallback((key: string) => {
    setOpenRequest((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }));
    const row = document.querySelector(`[data-evidence-keys~="${CSS.escape(key)}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, []);
  const value = useMemo(() => ({ activeKey, setActiveKey, openRequest, openEvidence }), [activeKey, openRequest, openEvidence]);
  return <TimelineLinkContext.Provider value={value}>{children}</TimelineLinkContext.Provider>;
}

export function useTimelineLink(): TimelineLink {
  return useContext(TimelineLinkContext);
}
```

In `app/components/TimelineMarkerLayer.tsx` replace `const { activeKey, setActiveKey } = useTimelineLink();` with `const { activeKey, setActiveKey, openEvidence } = useTimelineLink();` and replace `onClick={() => onPlay(m.start, m.end)}` with:

```tsx
            onClick={() => {
              onPlay(m.start, m.end);
              openEvidence(m.key);
            }}
```

- [ ] **Step 4: Add the progress card**

Create `app/components/ProgressMeter.tsx`:

```tsx
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
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // `now` only matters while a step runs; finished and failed steps do not depend on time.
  const percent = progressPercent(steps, now);
  const step = currentStep(steps);
  const state = steps[step.name];
  const finished = allDone(steps);
  const failed = step.status === "failed";
  const elapsedMs = state.status === "running" && state.startedAt != null ? now - state.startedAt : state.ms;
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
```

- [ ] **Step 5: Add the report rows and list**

Create `app/components/CommitmentRow.tsx`:

```tsx
"use client";

import { useId, useState, type ReactNode } from "react";
import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { evidenceKey, itemEvidence, showFields, type Tone } from "@/app/components/reportModel";
import { useTimelineLink } from "@/app/components/timelineLink";
import type { Clarification, Flag, VerifiedItem } from "@/lib/types";

type RowTone = Exclude<Tone, "neutral">;

const ICON: Record<RowTone, string> = { agreed: "✓", unsettled: "?", setaside: "✕" };
const SPOKEN: Record<RowTone, string> = { agreed: "Agreed", unsettled: "Needs clarification", setaside: "Not a commitment" };

const FLAG_TEXT: Record<Flag, string> = {
  owner_missing: "No owner agreed",
  owner_disputed: "Owner disputed — not settled",
  owner_unverified: "Owner not supported by a quote — removed",
  deadline_missing: "No deadline agreed",
  deadline_disputed: "Deadline disputed — not settled",
  deadline_unverified: "Deadline not supported by a quote — removed",
  date_context_missing: "Relative date: the recording does not state the calendar date",
};

const EVENT_LABEL: Record<string, string> = {
  proposed: "proposed", accepted: "accepted", assigned: "assigned", deadline_set: "deadline set",
  deadline_changed: "deadline changed", cancelled: "cancelled", reopened: "reopened",
  question_raised: "question raised", left_open: "left open",
};

const STATUS_CHIP: Partial<Record<VerifiedItem["finalStatus"], string>> = { cancelled: "Cancelled", not_accepted: "Not accepted" };

const ABOUT_LABEL: Record<Clarification["about"], string> = {
  owner: "Owner to settle",
  deadline: "Deadline to settle",
  question: "Open question",
};

export function Chip({ tone, children }: { tone?: RowTone | "accent"; children: ReactNode }) {
  return <span className={`chip${tone ? ` chip-${tone}` : ""}`}>{children}</span>;
}

/** A collapsible list row: status icon, title and chips; the body holds quotes and warnings. */
function Row({ tone, title, chips, evidenceKeys, children }: { tone: RowTone; title: string; chips: ReactNode; evidenceKeys: string[]; children: ReactNode }) {
  const bodyId = useId();
  const { activeKey, openRequest } = useTimelineLink();
  const [userOpen, setUserOpen] = useState(false);
  const [dismissedNonce, setDismissedNonce] = useState<number | null>(null);
  const forced = openRequest != null && evidenceKeys.includes(openRequest.key) && openRequest.nonce !== dismissedNonce;
  const open = userOpen || forced;
  const linked = activeKey != null && evidenceKeys.includes(activeKey);

  function toggle() {
    if (open) {
      setUserOpen(false);
      if (forced) setDismissedNonce(openRequest.nonce);
    } else {
      setUserOpen(true);
    }
  }

  return (
    <li className={`row tone-${tone}${open ? " is-open" : ""}${linked ? " is-linked" : ""}`} data-evidence-keys={evidenceKeys.join(" ")}>
      <button type="button" className="row-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="row-icon" aria-hidden="true">{ICON[tone]}</span>
        <span className="sr-only">{SPOKEN[tone]}: </span>
        <span className="row-title">{title}</span>
        <span className="row-chips">{chips}</span>
        <span className="row-chevron" aria-hidden="true">▾</span>
      </button>
      <div id={bodyId} className="row-body" hidden={!open}>{children}</div>
    </li>
  );
}

function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return <ul className="row-flags">{flags.map((f) => <li key={f}>⚠ {FLAG_TEXT[f]}</li>)}</ul>;
}

export function ItemRow({ item, tone, onPlay }: { item: VerifiedItem; tone: RowTone; onPlay: OnPlay }) {
  const fields = showFields(item);
  const chips = (
    <>
      {STATUS_CHIP[item.finalStatus] ? <Chip tone="setaside">{STATUS_CHIP[item.finalStatus]}</Chip> : null}
      {fields ? <Chip tone={item.owner.name ? "accent" : "unsettled"}>{item.owner.name ?? "No owner"}</Chip> : null}
      {fields ? <Chip tone={item.deadline.wording ? "accent" : "unsettled"}>{item.deadline.wording ?? "No deadline"}</Chip> : null}
    </>
  );
  return (
    <Row tone={tone} title={item.summary} chips={chips} evidenceKeys={itemEvidence(item).map(evidenceKey)}>
      {fields && item.owner.evidence ? <EvidenceLine ev={item.owner.evidence} onPlay={onPlay} label="owner" /> : null}
      {fields && item.deadline.evidence ? (
        <EvidenceLine ev={item.deadline.evidence} onPlay={onPlay} label={item.deadline.resolvedDate ? `deadline (${item.deadline.resolvedDate})` : "deadline"} />
      ) : null}
      <Flags flags={item.flags} />
      <p className="row-subhead">How it was decided</p>
      {item.events.map((ev, i) => <EvidenceLine key={i} ev={ev} onPlay={onPlay} label={EVENT_LABEL[ev.type] ?? ev.type} />)}
    </Row>
  );
}

export function ClarificationRow({ clarification, onPlay }: { clarification: Clarification; onPlay: OnPlay }) {
  const c = clarification;
  return (
    <Row
      tone="unsettled"
      title={c.question}
      chips={<Chip tone="unsettled">{ABOUT_LABEL[c.about]}</Chip>}
      evidenceKeys={[evidenceKey(c.evidence)]}
    >
      {c.itemSummary && c.itemSummary !== c.question ? <p className="row-note">About: {c.itemSummary}</p> : null}
      <EvidenceLine ev={c.evidence} onPlay={onPlay} />
    </Row>
  );
}

export function DroppedRow({ summary, reason }: { summary: string; reason: string }) {
  return (
    <li className="row tone-setaside is-static">
      <div className="row-head">
        <span className="row-icon" aria-hidden="true">{ICON.setaside}</span>
        <span className="sr-only">Removed by the quote check: </span>
        <span className="row-title">{summary}</span>
        <span className="row-chips"><Chip tone="setaside">Removed</Chip></span>
      </div>
      <p className="row-note row-note-static">{reason}</p>
    </li>
  );
}
```

Create `app/components/CommitmentList.tsx`:

```tsx
import { ClarificationRow, DroppedRow, ItemRow } from "@/app/components/CommitmentRow";
import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import { summaryCounts, tasksBy } from "@/app/components/reportModel";
import type { Report } from "@/lib/types";

function StatusCard({ report }: { report: Report }) {
  if (report.status === "declined") {
    return (
      <div className="notice-card tone-setaside" role="status">
        <p className="notice-card-title">Can’t produce a reliable commitments list.</p>
        <ul className="notice-card-list">{report.declineReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  }
  if (report.status === "needs_clarification") {
    return (
      <div className="notice-card tone-unsettled" role="status">
        <p className="notice-card-title">No commitment can be concluded from this recording.</p>
        <p>The points below must be clarified.</p>
      </div>
    );
  }
  if (report.status === "no_commitments") {
    return (
      <div className="notice-card tone-neutral" role="status">
        <p className="notice-card-title">No tasks, decisions or open questions were discussed.</p>
      </div>
    );
  }
  return null;
}

/** The report as a compact list: summary counts, then agreed items, items to clarify and set-aside items. */
export function CommitmentList({ report, onPlay }: { report: Report; onPlay: OnPlay }) {
  const counts = summaryCounts(report);
  const active = report.status === "ok" ? tasksBy(report, "active") : [];
  const setAside = [...tasksBy(report, "cancelled"), ...tasksBy(report, "not_accepted")];
  const speakers = report.speakers.filter((s) => s.intro);

  return (
    <section className="report" aria-labelledby="report-title">
      <h2 id="report-title" className="section-title">Commitments</h2>
      <StatusCard report={report} />

      {report.status !== "declined" ? (
        <ul className="summary" aria-label="Summary">
          <li className="summary-stat tone-agreed"><b>{counts.agreed}</b> agreed</li>
          <li className="summary-stat tone-unsettled"><b>{counts.toClarify}</b> to clarify</li>
          <li className="summary-stat tone-setaside"><b>{counts.notCommitments}</b> not commitments</li>
        </ul>
      ) : null}

      {active.length > 0 ? (
        <section className="group" aria-label="Agreed">
          <h3 className="group-title">Agreed</h3>
          <ul className="rows">{active.map((it, i) => <ItemRow key={i} item={it} tone="agreed" onPlay={onPlay} />)}</ul>
        </section>
      ) : null}

      {report.clarifications.length > 0 ? (
        <section className="group" aria-label="Needs clarification">
          <h3 className="group-title">Needs clarification</h3>
          <ul className="rows">{report.clarifications.map((c, i) => <ClarificationRow key={i} clarification={c} onPlay={onPlay} />)}</ul>
        </section>
      ) : null}

      {counts.notCommitments > 0 ? (
        <details className="group group-collapsible">
          <summary className="group-title">Not commitments ({counts.notCommitments})</summary>
          <ul className="rows">
            {setAside.map((it, i) => <ItemRow key={i} item={it} tone="setaside" onPlay={onPlay} />)}
            {report.dropped.map((d, i) => <DroppedRow key={`d${i}`} summary={d.summary} reason={d.reason} />)}
          </ul>
        </details>
      ) : null}

      {speakers.length > 0 ? (
        <details className="group group-collapsible">
          <summary className="group-title">Speakers ({speakers.length})</summary>
          <div className="speakers">
            {speakers.map((s) => <EvidenceLine key={s.speaker} ev={s.intro!} onPlay={onPlay} label="introduction" />)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. The new components are not rendered by any page yet; Task 3 wires them in.

```bash
git add app/components tests/app/reportModel.test.ts
git commit -m "feat: progress card and compact commitments list components

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: New visual system and pages

**Files:**
- Modify: `app/globals.css` (full rewrite), `app/layout.tsx`, `app/components/Uploader.tsx`, `app/components/MetricsView.tsx`, `app/history/page.tsx`, `app/history/[id]/page.tsx`
- Delete: `app/components/StageSequence.tsx`, `app/components/ReportView.tsx`, `app/components/LedgerRow.tsx`

**Interfaces:**
- Consumes: Task 1 (`progressModel`, `putWithProgress`), Task 2 (`ProgressMeter`, `CommitmentList`, `TimelineLinkProvider` with `openEvidence`).
- Produces: CSS classes used by all components (`card`, `btn`, `btn-primary`, `btn-danger`, `chip*`, `status-mark`, `notice-card*`, `hero`, `progress*`, `summary*`, `group*`, `rows`, `row*`, `line*`, `timestamp*`, `details`, `section-details`, `run-list`, `run-card*`, `run-header*`, `meta`, `danger-zone`, `timeline*`, `marker`, `tone-*`).

- [ ] **Step 1: Replace the stylesheet**

Replace `app/globals.css` with:

```css
/* ---------- Tokens ---------- */
:root {
  --bg: #fbf1df;
  --bg-2: #fff8ec;
  --surface: #ffffff;
  --ink: #241d3a;
  --mut: #6a637e;
  --line: #e7ddc6;
  --shadow: #c9a23a;

  --agreed: #11c2d4;
  --agreed-fill: #d8f6f8;
  --unsettled: #ffbe2e;
  --unsettled-fill: #fff1cf;
  --setaside: #ff6a4d;
  --setaside-fill: #ffe6df;
  --accent: #7b5cff;
  --accent-fill: #f1edff;
  --neutral: #6a637e;
  --neutral-fill: #f4f4f7;

  --font-display-stack: var(--font-display), "Trebuchet MS", system-ui, sans-serif;
  --font-body-stack: var(--font-body), -apple-system, "Segoe UI", system-ui, sans-serif;
  --font-mono-stack: ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 15px;
  --text-lg: 17px;
  --text-xl: 22px;
  --text-2xl: 44px;

  --border: 2.5px solid var(--ink);
  --border-thin: 2px solid var(--ink);
  --radius-page: 26px;
  --radius-card: 18px;
  --radius-inner: 14px;
  --radius-pill: 999px;

  --content: 960px;
  --gutter: 24px;
  --spring: cubic-bezier(0.2, 1.3, 0.4, 1);
}

/* Tone classes set the colour pair used by icons, chips, markers, notices and bars. */
.tone-agreed { --tone: var(--agreed); --tone-fill: var(--agreed-fill); }
.tone-unsettled { --tone: var(--unsettled); --tone-fill: var(--unsettled-fill); }
.tone-setaside { --tone: var(--setaside); --tone-fill: var(--setaside-fill); }
.tone-neutral { --tone: var(--neutral); --tone-fill: var(--neutral-fill); }

/* ---------- Base ---------- */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body-stack);
  font-size: var(--text-md);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
h1, h2, h3 { margin: 0; font-family: var(--font-display-stack); font-weight: 700; line-height: 1.1; text-wrap: balance; }
h1 { font-size: var(--text-2xl); letter-spacing: -0.01em; }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); font-weight: 600; }
p { margin: 0; }
a { color: var(--ink); text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: var(--accent); }
a:hover { text-decoration-color: var(--ink); }
button { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.muted { color: var(--mut); }
.nowrap { white-space: nowrap; }
.text-setaside { color: #c2412a; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.scroll { overflow-x: auto; }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}

/* ---------- Frame ---------- */
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 2px solid var(--line);
}
.site-header-inner {
  max-width: calc(var(--content) + 2 * var(--gutter));
  margin: 0 auto;
  padding: 14px var(--gutter) 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
}
.brand { font-family: var(--font-display-stack); font-weight: 700; font-size: 22px; text-decoration: none; }
.site-nav { display: flex; gap: 8px; }
.site-nav a {
  font-family: var(--font-display-stack);
  font-weight: 600;
  text-decoration: none;
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
}
.site-nav a:hover { border-color: var(--ink); background: var(--surface); }
.notice {
  max-width: calc(var(--content) + 2 * var(--gutter));
  margin: 0 auto;
  padding: 0 var(--gutter) 10px;
  font-size: var(--text-xs);
  color: var(--mut);
}
.page {
  max-width: calc(var(--content) + 2 * var(--gutter));
  margin: 0 auto;
  padding: 48px var(--gutter) 96px;
}
.hero { margin-bottom: 28px; }
.hero-small h1 { font-size: 36px; }
.lede { margin-top: 12px; max-width: 60ch; font-size: var(--text-lg); color: var(--mut); }
.card {
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius-page);
  box-shadow: 0 6px 0 0 var(--line);
}
.section-title { margin-bottom: 14px; }

/* ---------- Controls ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 22px;
  border: var(--border-thin);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--font-display-stack);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.2;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
.btn:hover { background: var(--bg-2); }
.btn-primary {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
  box-shadow: 0 6px 0 0 var(--shadow);
}
.btn-primary:hover { background: #342b52; }
.btn-primary:active { transform: translateY(4px); box-shadow: 0 2px 0 0 var(--shadow); }
.btn-danger { border-color: var(--setaside); color: #c2412a; }
.btn-danger:hover { background: var(--setaside-fill); }
.btn:disabled { background: var(--neutral-fill); border-color: var(--line); color: var(--mut); box-shadow: none; cursor: not-allowed; transform: none; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 20px; margin-top: 18px; }

.chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 10px;
  border: var(--border-thin);
  border-radius: var(--radius-pill);
  background: var(--surface);
  font-family: var(--font-display-stack);
  font-weight: 600;
  font-size: var(--text-sm);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-agreed { background: var(--agreed-fill); }
.chip-unsettled { background: var(--unsettled-fill); }
.chip-setaside { background: var(--setaside-fill); }
.chip-accent { background: var(--accent-fill); }

.status-mark {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 10px 2px 6px;
  border: var(--border-thin);
  border-radius: var(--radius-pill);
  background: var(--tone-fill);
  font-family: var(--font-display-stack);
  font-weight: 600;
  font-size: var(--text-sm);
  white-space: nowrap;
}
.status-mark-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ink); background: var(--tone); flex: none; }

.notice-card {
  margin: 18px 0;
  padding: 14px 18px;
  border: var(--border);
  border-radius: var(--radius-card);
  background: var(--tone-fill, var(--surface));
  animation: pop-in 350ms var(--spring) both;
}
.notice-card-title { font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-lg); }
.notice-card-title + p { margin-top: 2px; }
.notice-card-list { margin: 6px 0 0; padding-left: 20px; }

/* ---------- Recording timeline ---------- */
.timeline-block { margin-bottom: 20px; }
.timeline-scroll { overflow-x: auto; padding: 4px 4px 10px; margin: -4px -4px -10px; }
.timeline {
  position: relative;
  min-width: 560px;
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius-page);
  box-shadow: 0 6px 0 0 var(--line);
  transition: background 150ms ease;
}
.timeline.is-empty { background: var(--bg-2); border-style: dashed; box-shadow: none; }
.timeline.is-over { background: var(--surface); border-style: solid; }
.timeline-plot { position: relative; height: 150px; margin: 0 24px; }
.timeline.is-empty .timeline-plot { height: 190px; }
.timeline-wave { position: absolute; left: 0; top: 26px; width: 100%; height: calc(100% - 34px); fill: var(--accent); opacity: 0.35; }
.timeline-baseline { position: absolute; left: 0; right: 0; top: calc(26px + (100% - 34px) / 2); border-top: 2px dashed var(--line); }
.timeline-seek { position: absolute; inset: 0; cursor: pointer; border-radius: var(--radius-inner); }
.timeline-seek[aria-disabled="true"] { cursor: default; }
.timeline-playhead { position: absolute; top: 18px; bottom: 0; left: 0; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--ink); pointer-events: none; }
.timeline-prompt { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 8px; text-align: center; }
.timeline-prompt-text { font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-xl); }
.timeline-axis { position: relative; height: 32px; margin: 0 24px; border-top: 2px solid var(--line); }
.timeline-tick { position: absolute; top: 0; width: 2px; height: 6px; background: var(--line); }
.timeline-tick-label {
  position: absolute; top: 9px; left: 0;
  transform: translateX(-50%);
  font-family: var(--font-display-stack); font-weight: 500;
  font-size: var(--text-xs); line-height: 1; color: var(--mut);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.timeline-tick.is-first .timeline-tick-label { transform: none; }
.timeline-tick.is-last .timeline-tick-label { transform: translateX(-100%); }
.timeline-audio { display: block; width: 100%; height: 40px; margin-top: 14px; }
.timeline-caption { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 24px; min-height: 24px; margin-top: 10px; font-size: var(--text-sm); }
.timeline-note { color: var(--mut); }
.timeline-legend { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 0; padding: 0; list-style: none; }

.marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 26px;
  margin-left: -13px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tone);
  cursor: pointer;
  transform-origin: 50% 0;
  animation: marker-in 350ms var(--spring) both;
}
.marker::before {
  content: "";
  position: absolute;
  left: 12px;
  top: 16px;
  bottom: 0;
  width: 2px;
  background: var(--ink);
  opacity: 0.25;
}
.marker::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 2px;
  width: 18px;
  height: 18px;
  border: var(--border-thin);
  border-radius: 50%;
  background: currentColor;
  transition: transform 150ms var(--spring);
}
.marker:hover::before, .marker.is-active::before { opacity: 0.8; }
.marker:hover::after, .marker.is-active::after { transform: scale(1.3); }
@keyframes marker-in {
  from { opacity: 0; transform: scale(0.3); }
  to { opacity: 1; transform: none; }
}

/* ---------- File and progress ---------- */
.file-panel { margin-top: 18px; }
.file-facts { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; min-width: 0; }
.file-name { font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-lg); overflow-wrap: anywhere; }

.progress {
  margin-top: 28px;
  padding: 26px 26px 22px;
  text-align: center;
  animation: pop-in 350ms var(--spring) both;
}
.progress-percent { font-family: var(--font-display-stack); font-weight: 700; font-size: 56px; line-height: 1; font-variant-numeric: tabular-nums; }
.progress-title { margin-top: 8px; }
.progress-meta { margin-top: 4px; color: var(--mut); font-family: var(--font-display-stack); font-weight: 500; font-variant-numeric: tabular-nums; }
.progress-bar {
  position: relative;
  height: 24px;
  margin: 18px 0 12px;
  border: var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-2);
  overflow: hidden;
}
.progress-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: repeating-linear-gradient(-45deg, var(--accent) 0 14px, #9479ff 14px 28px);
  background-size: 40px 40px;
  transition: width 400ms ease-out;
  animation: stripes 1.2s linear infinite;
}
.progress.is-finished .progress-fill { background: var(--agreed); animation: none; }
.progress.is-failed .progress-fill { background: var(--setaside); animation: none; }
@keyframes stripes { to { background-position: 40px 0; } }
.progress-hint { max-width: 56ch; margin: 0 auto; color: var(--mut); }
.progress.is-failed .progress-hint { color: #c2412a; font-weight: 500; }
.progress-steps { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
.progress-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 5px;
  border: 2px dashed var(--line);
  border-radius: var(--radius-pill);
  font-family: var(--font-display-stack);
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--mut);
}
.progress-step-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--line); background: var(--surface);
  font-size: 11px; line-height: 1;
}
.progress-step.is-running { border: var(--border-thin); color: var(--ink); background: var(--unsettled-fill); }
.progress-step.is-running .progress-step-icon { border-color: var(--ink); background: var(--unsettled); }
.progress-step.is-done { border: var(--border-thin); color: var(--ink); background: var(--agreed-fill); }
.progress-step.is-done .progress-step-icon { border-color: var(--ink); background: var(--agreed); }
.progress-step.is-failed { border: var(--border-thin); color: var(--ink); background: var(--setaside-fill); }
.progress-step.is-failed .progress-step-icon { border-color: var(--ink); background: var(--setaside); color: #fff; }
.progress-step-time { color: var(--mut); font-weight: 500; font-variant-numeric: tabular-nums; }

/* ---------- Report ---------- */
.report { margin-top: 40px; animation: pop-in 350ms var(--spring) both; }
.summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 22px; padding: 0; list-style: none; }
.summary-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 16px;
  border: var(--border-thin);
  border-radius: var(--radius-card);
  background: var(--tone-fill);
  font-family: var(--font-display-stack);
  font-weight: 600;
}
.summary-stat b { font-size: 24px; line-height: 1; }
.group { margin-top: 22px; }
.group-title { display: block; margin-bottom: 10px; font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-lg); }
.group-collapsible > summary { cursor: pointer; list-style: none; }
.group-collapsible > summary::-webkit-details-marker { display: none; }
.group-collapsible > summary::before { content: "▸"; display: inline-block; margin-right: 8px; transition: transform 150ms ease; }
.group-collapsible[open] > summary::before { transform: rotate(90deg); }

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 5px 0 0 var(--line);
  overflow: hidden;
}
.row { border-bottom: 2px solid var(--line); animation: pop-in 350ms var(--spring) both; }
.row:last-child { border-bottom: 0; }
.row.is-open, .row.is-linked { background: var(--bg-2); }
.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.row.is-static .row-head { cursor: default; }
.row-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex: none;
  border: var(--border-thin); border-radius: 8px;
  background: var(--tone);
  font-weight: 700; font-size: 14px; line-height: 1;
}
.tone-setaside .row-icon { color: #fff; }
.row-title { flex: 1 1 220px; min-width: 0; font-family: var(--font-display-stack); font-weight: 600; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
.row.tone-setaside .row-title { color: var(--mut); }
.row-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.row-chevron { flex: none; color: var(--mut); transition: transform 150ms ease; }
.row.is-open .row-chevron { transform: rotate(180deg); }
.row-body { padding: 0 16px 14px 54px; }
.row-flags { margin: 8px 0 0; padding: 0; list-style: none; font-size: var(--text-sm); }
.row-flags li { margin-top: 4px; padding: 2px 10px; border-radius: 10px; background: var(--unsettled-fill); display: inline-block; margin-right: 6px; }
.row-subhead { margin-top: 12px; font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-sm); color: var(--mut); }
.row-note { margin-top: 2px; color: var(--mut); font-size: var(--text-sm); }
.row-note-static { padding: 0 16px 12px 54px; margin: 0; }
.speakers { padding: 4px 0; }

.line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-inner);
  border: 2px solid transparent;
}
.line.is-active { background: var(--surface); border-color: var(--ink); }
.timestamp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 1px;
  padding: 3px 10px 3px 4px;
  border: var(--border-thin);
  border-radius: var(--radius-pill);
  background: var(--surface);
  font-family: var(--font-display-stack);
  font-weight: 600;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 120ms ease;
}
.timestamp:hover { background: var(--accent-fill); }
.timestamp:active { transform: scale(0.96); }
.timestamp-glyph {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--ink); color: #fff; font-size: 8px;
}
.line-body { min-width: 0; }
.line-meta { display: flex; flex-wrap: wrap; gap: 0 10px; font-size: var(--text-sm); }
.line-speaker { font-family: var(--font-display-stack); font-weight: 600; }
.line-kind { color: var(--mut); }
.quote { font-style: italic; line-height: 1.55; max-width: 68ch; overflow-wrap: anywhere; }

/* ---------- Details ---------- */
.details { margin-top: 32px; padding: 6px 20px; }
.details > summary { padding: 10px 0; font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-lg); cursor: pointer; }
.details[open] { padding-bottom: 18px; }
.section-details { margin-top: 10px; padding-top: 10px; border-top: 2px solid var(--line); }
.section-details > summary { font-family: var(--font-display-stack); font-weight: 600; cursor: pointer; }
.section-details h3 { margin-top: 16px; font-size: var(--text-md); }
.transcript { margin-top: 6px; }

.data-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.data-table th, .data-table td { padding: 9px 14px 9px 0; text-align: left; vertical-align: top; border-bottom: 2px solid var(--line); }
.data-table th:last-child, .data-table td:last-child { padding-right: 0; }
.data-table thead th { font-family: var(--font-display-stack); font-weight: 600; color: var(--mut); white-space: nowrap; }
.data-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.data-table .cell-detail { overflow-wrap: anywhere; min-width: 16ch; }
.kv-table { margin-top: 10px; font-size: var(--text-md); }
.kv-table th { width: 40%; font-weight: 400; color: var(--mut); }
.kv-table td.num { width: 1%; white-space: nowrap; }
.kv-table td.muted { font-size: var(--text-sm); }
.kv-group-start th, .kv-group-start td { border-top: 2px solid var(--ink); }
.kv-total th, .kv-total td { font-family: var(--font-display-stack); font-weight: 600; color: var(--ink); }

pre {
  margin: 8px 0 16px;
  padding: 12px;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono-stack);
  font-size: var(--text-xs);
  background: var(--bg-2);
  border: 2px solid var(--line);
  border-radius: var(--radius-inner);
}

/* ---------- History ---------- */
.run-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.run-card {
  display: grid;
  grid-template-columns: 9.5rem minmax(0, 1fr) auto 5.5rem;
  grid-template-areas: "status file duration numbers" "status date duration numbers";
  align-items: center;
  gap: 2px 18px;
  padding: 14px 18px;
  background: var(--surface);
  border: var(--border);
  border-radius: var(--radius-card);
  box-shadow: 0 5px 0 0 var(--line);
  text-decoration: none;
  transition: transform 150ms var(--spring), box-shadow 150ms ease;
  animation: pop-in 350ms var(--spring) both;
}
.run-card:hover { transform: translateY(-2px); box-shadow: 0 7px 0 0 var(--shadow); }
.run-card-status { grid-area: status; }
.run-card-file { grid-area: file; font-family: var(--font-display-stack); font-weight: 600; font-size: 16px; overflow-wrap: anywhere; }
.run-card-date { grid-area: date; font-size: var(--text-sm); color: var(--mut); }
.run-card-duration { grid-area: duration; }
.run-card-numbers { grid-area: numbers; display: grid; justify-items: end; font-family: var(--font-display-stack); font-weight: 600; font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
.duration { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; font-family: var(--font-display-stack); font-weight: 500; font-size: var(--text-sm); }
.minibar { display: inline-block; width: 72px; height: 10px; border: var(--border-thin); border-radius: var(--radius-pill); background: var(--bg-2); overflow: hidden; }
.minibar-fill { display: block; height: 100%; background: var(--tone); }

/* ---------- Run page ---------- */
.run-header { margin-bottom: 22px; padding: 20px 22px; }
.run-header-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
.run-title { font-size: 28px; overflow-wrap: anywhere; }
.meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 22px; margin: 14px 0 0; }
.meta dt { font-size: var(--text-xs); color: var(--mut); }
.meta dd { margin: 0; font-family: var(--font-display-stack); font-weight: 600; overflow-wrap: anywhere; }
.danger-zone { margin-top: 40px; padding-top: 20px; border-top: 2px dashed var(--line); }

/* ---------- Narrow screens ---------- */
@media (max-width: 640px) {
  :root { --gutter: 16px; }
  h1 { font-size: 32px; }
  .hero-small h1 { font-size: 30px; }
  .lede { font-size: var(--text-md); }
  .page { padding-top: 28px; }
  .progress { padding: 20px 16px 18px; }
  .progress-percent { font-size: 44px; }
  .row-body, .row-note-static { padding-left: 16px; }
  .run-card {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "file status" "date date" "duration numbers";
    gap: 6px 12px;
  }
  .run-card-numbers { grid-auto-flow: column; gap: 12px; }
  .kv-table th { width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 2: Fonts and header**

Replace `app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Fredoka, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const displayFont = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const bodyFont = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Commitments from recordings",
  description: "Final tasks, owners, deadlines and open questions with timestamped evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">Commitments</Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/">New upload</Link>
              <Link href="/history">History</Link>
            </nav>
          </div>
          <p className="notice">Uploads are visible to everyone who opens this demo and are deleted after 30 days.</p>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Home page flow**

Replace `app/components/Uploader.tsx` with:

```tsx
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
  const failStep = (s: StepName, ms: number) =>
    setSteps((prev) => ({ ...prev, [s]: { ...prev[s], status: "failed", ms, frozenPercent: progressPercent(prev, performance.now()) } }));

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
            setDetail(await api<RunDetail>(`/api/runs/${id}`));
            setBusy(false);
            return;
          }
          patchStep("transcribe", { status: "done", ms: performance.now() - t0 });
          if (run.status === "done") {
            // Declined before extraction: nothing left to run.
            patchStep("extract", { status: "done" });
            patchStep("verify", { status: "done" });
            setDetail(await api<RunDetail>(`/api/runs/${id}`));
            setBusy(false);
            return;
          }
        } else {
          const { run, report } = await api<{ run: Run; report: unknown }>(`/api/runs/${id}/extract`, { method: "POST" });
          if (!report) throw new Error(lastFailure(run));
          patchStep("extract", { status: "done", ms: run.stageMs.extract ?? performance.now() - t0 });
          patchStep("verify", { status: "done", ms: run.stageMs.verify });
          setDetail(await api<RunDetail>(`/api/runs/${id}`));
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
        onDropFile={choose}
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
```

In `app/components/MetricsView.tsx` replace `<details open className="section-details">` with `<details className="section-details">`.

- [ ] **Step 4: History and run pages**

Replace `app/history/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/app/components/api";
import { formatClock } from "@/app/components/clock";
import { runBadge, runTone } from "@/app/components/runBadge";
import { StatusMark } from "@/app/components/StatusMark";
import { formatMs, formatUsd } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import type { Run } from "@/lib/types";

function DurationBar({ run }: { run: Run }) {
  const sec = run.file.durationSec;
  const pct = sec != null ? Math.min(100, (sec / LIMITS.maxDurationSec) * 100) : 0;
  return (
    <span className="duration">
      <span className="minibar" aria-hidden="true">
        {sec != null ? <span className={`minibar-fill tone-${runTone(run)}`} style={{ width: `${pct}%` }} /> : null}
      </span>
      <span>{sec != null ? formatClock(sec) : "—"}</span>
    </span>
  );
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ runs: Run[] }>("/api/runs").then((r) => setRuns(r.runs)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <header className="hero hero-small">
        <h1>History</h1>
        <p className="lede">Every upload and what happened to it, newest first.</p>
      </header>
      {error ? <div className="notice-card tone-setaside" role="alert"><p>{error}</p></div> : null}
      {runs === null && !error ? <p className="muted">Loading…</p> : null}
      {runs?.length === 0 ? (
        <div className="notice-card tone-neutral"><p>No uploads yet. <Link href="/">Upload a recording</Link> to see it here.</p></div>
      ) : null}
      {runs && runs.length > 0 ? (
        <ul className="run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/history/${r.id}`} className="run-card">
                <span className="run-card-status"><StatusMark tone={runTone(r)}>{runBadge(r)}</StatusMark></span>
                <span className="run-card-file">{r.file.name}</span>
                <span className="run-card-date">{r.createdAt.replace("T", " ").slice(0, 16)} UTC</span>
                <span className="run-card-duration"><DurationBar run={r} /></span>
                <span className="run-card-numbers">
                  <span><span className="sr-only">Time to result </span>{formatMs(r.timeToResultMs)}</span>
                  <span><span className="sr-only">Cost </span>{formatUsd(r.cost?.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

Replace `app/history/[id]/page.tsx` with:

```tsx
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
```

- [ ] **Step 5: Remove the replaced components**

```bash
git rm app/components/StageSequence.tsx app/components/ReportView.tsx app/components/LedgerRow.tsx
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass; `grep -rn "StageSequence\|ReportView\|LedgerRow\|banner\b\|ledger" app` prints nothing.

- [ ] **Step 7: Visual check**

Start `npm run dev` (or reuse a running one). Check in a browser, at desktop width and at a narrow window (~500px), and write what you saw into the report:

1. `/` empty state: cream background, big title, dashed drop zone with the "Choose file" pill button and its gold shadow.
2. Choose `testset/invalid/video-renamed.mp3`: the client check shows a coral notice card; "Find commitments" is disabled.
3. Choose `testset/01-normal/audio.mp3` and click "Find commitments" (this makes real Deepgram and AI Gateway calls, about 1 minute): the progress card shows the percent rising during upload, "Step 2 of 4" while transcribing, "Finding commitments" with the seconds counter and the bar slowing down, then 100% "Done".
4. The list: summary chips, "Agreed" rows with owner/deadline chips; clicking a row expands quotes with ▶ that play the audio; clicking a coloured marker on the timeline opens and scrolls to its row; "Not commitments" is collapsed.
5. `/history`: run cards with status chip, name, date, duration bar, time and cost; clicking opens the run page with the header card, list and a collapsed "Details" block.
6. With the OS "reduce motion" setting on (or DevTools rendering emulation), rows appear without animation and the progress stripes do not move.
7. Keyboard: Tab reaches rows, Enter expands, Tab reaches ▶ buttons.

If step 3 cannot run (no API keys or rate limits), say so in the report and check steps 1–2 and 4–7 on an existing run from `/history`.

- [ ] **Step 8: Commit**

```bash
git add -A app
git commit -m "feat: playful visual system, progress card and compact report list across the app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
