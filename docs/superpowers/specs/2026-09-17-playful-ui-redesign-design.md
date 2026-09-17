# Playful UI redesign and honest progress — design

Date: 2026-09-17. Scope: the whole browser UI (`app/`). The pipeline, API routes, storage, cost
accounting and report data model are unchanged.

## 1. Goals

- A friendlier, clearer interface in the visual language of https://lispr.ai/ru/windows/ (chosen by
  the user over a calmer adaptation and the current "ledger" style).
- During processing, the user always sees what is happening, how far along it is and how long it
  usually takes. Today the extraction step (45–60 s) shows one unchanging line.
- The commitments list is the primary content; technical blocks stay available but collapsed.

Out of scope: dark theme, new product features, text changes to the shared-history notice, any
change to what the report contains.

## 2. Decisions

| Topic | Decision |
|---|---|
| Visual direction | Faithful to lispr.ai: cream background, thick ink borders, pill buttons with a hard offset shadow, bright accents, springy entrance motion |
| Progress display | One large progress bar with a percentage, step name, "Step N of 4 · elapsed" and a plain-language sentence |
| Report layout | Compact list: summary counts, one row per item, click to expand quotes and warnings |
| Scope | Whole app: home (upload, progress, report), History, run page |
| Styling approach | Rewrite in place with plain CSS in `app/globals.css` and `next/font`; no new dependencies |
| Theme | Light only |
| UI language | English (all UI text, code and comments) |

## 3. Visual system

### 3a. Tokens (`:root` in `app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fbf1df` | page background |
| `--bg-2` | `#fff8ec` | soft panels, expanded rows |
| `--surface` | `#ffffff` | cards, list, inputs |
| `--ink` | `#241d3a` | text, borders, primary button |
| `--mut` | `#6a637e` | secondary text |
| `--line` | `#e7ddc6` | dividers, card drop shadow |
| `--shadow` | `#c9a23a` | hard shadow under primary buttons |
| `--agreed` | `#11c2d4` (fill `#d8f6f8`) | agreed items, done steps |
| `--unsettled` | `#ffbe2e` (fill `#fff1cf`) | open questions, needs clarification, running step |
| `--setaside` | `#ff6a4d` (fill `#ffe6df`) | cancelled, not accepted, dropped, rejected, failed |
| `--accent` | `#7b5cff` (fill `#f1edff`) | owner and deadline chips, progress fill |

Status colours are never the only signal: each status also has an icon and a text label.
Text on coloured fills stays `--ink` (contrast AA).

### 3b. Type and shape

- Fonts via `next/font/google`: **Fredoka** (500/600/700) for headings, buttons, chips, numbers;
  **Inter** (400/500/600) for body. Quotes from the recording use Inter italic. The current
  Schibsted Grotesk and Literata fonts are removed.
- Sizes: page title 44px (32px under 640px), section title 22px, row title 16px, body 15px, small 13px.
- Borders 2–2.5px `--ink`; radius 26px for page cards, 18px for list/cards, 14px for inner panels,
  999px for buttons and chips.
- Primary button: `--ink` fill, white Fredoka text, `box-shadow: 0 6px 0 0 var(--shadow)`; on
  `:active` it moves down 4px and the shadow shrinks. Secondary button: white fill, ink border.
- Motion: rows and cards enter with a short spring (`opacity` + `translateY(12px)`, 350 ms);
  progress fill animates width. All motion is disabled under `prefers-reduced-motion: reduce`.
- Layout: content max width 960px, 16px side gutter on phones, no horizontal page scroll at 375px.

## 4. Pages

### 4a. Shell (`app/layout.tsx`)

Sticky header on `--bg` with a 2px `--line` bottom border: brand "Commitments" (Fredoka), links
"New upload" and "History". The notice stays verbatim in small `--mut` text under the header row:
"Uploads are visible to everyone who opens this demo and are deleted after 30 days."

### 4b. Home — before upload (`Uploader`)

- Title "Recording in. Commitments out." and one line: "English, two speakers who introduce
  themselves, up to 3 minutes. Every item links to the moment it was said."
- Large drop zone card (dashed ink border, `--bg-2`): "Drop a recording here" and primary button
  "Choose file". Drag-over state: solid border and `--surface` fill.
- After a file is chosen: the drop zone becomes the recording timeline (waveform, markers after the
  report) with the file facts row (name, size, format, duration) and "Choose a different file".
  Client check errors show as a set-aside card. Primary action: "Find commitments".

### 4c. Home — processing (`ProgressMeter`, replaces `StageSequence`)

Card with, top to bottom: percentage (Fredoka 56px, 44px on phones), step name (22px), "Step N of 4 · 23 s",
the bar (24px tall, ink border, accent fill), a one-line explanation, and a row of the four step
names with ✓ for finished ones and their durations.

| # | Step name | Explanation line |
|---|---|---|
| 1 | Uploading | "Sending the file to private storage." |
| 2 | Transcribing | "Checking the file and turning speech into text with speaker labels." |
| 3 | Finding commitments | "The model reads the conversation and tracks what was agreed, changed or dropped. Usually under a minute." |
| 4 | Checking quotes | "Every item must match the transcript word for word." |

### 4d. Home — result

- Rejected by the server check: set-aside card "File rejected" + reason + "Choose another file".
- Otherwise the report (§6), then a collapsed **Details** block containing the transcript,
  "Speed and cost" (`MetricsView`), "Download JSON" and "Open this run in History".

### 4e. History (`app/history/page.tsx`)

Title "History", line "Every upload and what happened to it, newest first." The table becomes a list
of row cards (whole row is a link): status icon + label, file name, UTC date, duration mini bar and
`m:ss`, time to result, cost. Empty state card with a link to upload. Loading and error states keep
their text.

### 4f. Run page (`app/history/[id]/page.tsx`)

Header card: file name, status chip, then small facts (uploaded, duration, size, declared type,
detected format). Then the timeline, rejection card if any, the report (§6), then one collapsed
**Details** card containing "Transcript", "What happened" (`EventLog`), "Speed and cost" and "Raw
API responses". Delete button (secondary style with set-aside border) below, with the existing
confirm dialog.

## 5. Progress model

### 5a. Module

`app/components/progressModel.ts`, pure and unit-tested:

```ts
export type StepName = "upload" | "transcribe" | "extract" | "verify";
export type StepStatus = "pending" | "running" | "done" | "failed";
export type StepState = { status: StepStatus; startedAt?: number; ms?: number; fraction?: number };
export type Steps = Record<StepName, StepState>;

export const ORDER: StepName[] = ["upload", "transcribe", "extract", "verify"];
export const SPAN: Record<StepName, [number, number]> = {
  upload: [0, 15], transcribe: [15, 30], extract: [30, 95], verify: [95, 100],
};
export const TYPICAL_MS = { transcribe: 3_000, extract: 55_000 };

/** Overall percent (0–100, integer) for the current step states at time `now`. */
export function progressPercent(steps: Steps, now: number): number;
/** The step to show: the first step that is not done (running, failed or pending), else the last one. */
export function currentStep(steps: Steps): { name: StepName; index: number; status: StepStatus };
```

Rules:

- A `done` step contributes its full span. A `pending` step contributes 0.
- `upload` while running: `fraction` is the real byte ratio from `XMLHttpRequest.upload.onprogress`
  (0 when unknown).
- `transcribe` and `extract` while running: `fraction = 1 − exp(−elapsed / TYPICAL_MS[step])`,
  capped at 0.95, so the bar slows down and never reaches the end of the step before the response.
- `verify` is never `running` in the client: it runs inside the extract request on the server. When
  the extract response arrives, `extract` and `verify` both become `done`; `verify.ms` comes from
  `run.stageMs.verify`, `extract.ms` from `run.stageMs.extract` (falls back to the client-measured time).
- A `failed` step keeps the percent reached at the moment of failure.
- The component re-renders every 250 ms while a step is running (single interval, cleared on
  unmount and when nothing runs). Elapsed seconds shown as whole seconds.

### 5b. Upload with progress

The upload step replaces `fetch(target.url, { method: "PUT", … })` with a small
`putWithProgress(url, method, headers, body, onProgress): Promise<{ ok: boolean; status: number }>`
helper based on `XMLHttpRequest` (same URL, method and headers, so presigned Blob URLs and the local
upload route both keep working). Network errors reject; HTTP errors resolve with `ok: false`,
matching today's handling.

### 5c. Accessibility

- The bar: `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow`,
  `aria-valuetext="Finding commitments, 62 percent"`.
- A visually hidden `aria-live="polite"` region announces only step changes and completion/failure,
  not every percent.

### 5d. Failure and retry

- The failed step and the bar fill turn set-aside; the explanation line is replaced by the failure
  message (last failed event detail or request error).
- Button "Try again" resumes from the failed step (existing `process(from)` behaviour);
  upload failures restart from upload.

## 6. Report list (`CommitmentList`, `CommitmentRow`; replace `ReportView`, `LedgerRow`)

- **Status card** above the list for `declined` (set-aside, reasons), `needs_clarification`
  (unsettled, "No commitment can be concluded from this recording. The points below must be
  clarified."), `no_commitments` (neutral). Texts are the current ones.
- **Summary strip**: "N agreed", "N to clarify", "N not commitments" (agreed = active tasks; to
  clarify = `report.clarifications`, which already include every open question plus disputed or
  missing owners/deadlines; not commitments = cancelled + not accepted + dropped by the verifier).
  Computed by a pure `summaryCounts(report)` in `app/components/reportModel.ts`.
- **Groups**, in order: "Agreed" (active tasks), "Needs clarification" (`report.clarifications`),
  "Not commitments" (cancelled, not accepted, dropped — the group is collapsed by default). Items
  of kind `open_question` appear through their clarification; cancelled or not-accepted open
  questions are not listed (same as the timeline markers).
- **Row, collapsed**: status icon (✓ agreed / ? unsettled / ✕ set aside) with a visually hidden text
  label, summary, owner chip ("Mark" or "No owner" in unsettled fill), deadline chip (the wording,
  e.g. "by Wednesday", or "No deadline"), chevron. The whole row header is a `<button>` with
  `aria-expanded` and `aria-controls`.
- **Row, expanded**: owner and deadline quotes with ▶ (existing `EvidenceLine`), flags as warning
  lines with their current texts, and the event timeline ("proposed", "accepted", …) with ▶.
  Clarification rows show the question and its quote. Dropped rows show summary and reason.
- **Speakers** as a collapsed group under the list: names with their introduction quote ▶.
- **Timeline markers** keep their link to rows through `TimelineLinkProvider`: activating a marker
  expands and highlights its row and scrolls it into view; playing a row's quote highlights the marker.

## 7. Files

| File | Change |
|---|---|
| `app/globals.css` | Rewritten around §3 tokens; old ledger classes removed |
| `app/layout.tsx` | Fredoka + Inter, new header markup |
| `app/components/progressModel.ts` | New (§5a) |
| `app/components/ProgressMeter.tsx` | New, replaces `StageSequence.tsx` (deleted) |
| `app/components/putWithProgress.ts` | New (§5b) |
| `app/components/Uploader.tsx` | New layout (§4b–4d), uses progress model and XHR upload |
| `app/components/CommitmentList.tsx`, `CommitmentRow.tsx` | New, replace `ReportView.tsx`, `LedgerRow.tsx` (deleted) |
| `app/components/reportModel.ts` | Add `summaryCounts` |
| `app/components/RecordingTimeline.tsx`, `TimelineMarkerLayer.tsx`, `EvidenceLine.tsx`, `TranscriptView.tsx`, `EventLog.tsx`, `MetricsView.tsx`, `StatusMark.tsx` | Markup/class updates for the new styles; behaviour unchanged |
| `app/history/page.tsx`, `app/history/[id]/page.tsx` | New layouts (§4e, §4f) |

## 8. Testing

- Unit (vitest, `tests/app/`): `progressModel` — spans sum to 100; pending/done contributions;
  upload uses the byte fraction; time-based fraction is below 0.95 of the step at any elapsed time
  and increases monotonically; extract response marks verify done; failed step freezes the percent;
  `currentStep` for each state. `summaryCounts` — counts for an ok report with cancelled/not-accepted items, a
  needs_clarification report (open question counted once), and dropped items.
- Existing 97 tests stay green; `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Visual check on `npm run dev` with screenshots at 1280px and 375px: empty home, file chosen,
  processing (upload, transcribe, extract), result for `testset/01-normal`, rejected
  `testset/invalid/video-renamed.mp3`, History, run page; keyboard pass (Tab to rows, Enter
  expands, ▶ plays); `prefers-reduced-motion` disables motion.
