# Commitments Extractor Implementation Plan

> **Superseded in part (2026-09-17):** Task 13 Step 6 onward and Tasks 14–15 are replaced by
> `docs/superpowers/plans/2026-09-17-vercel-ai-gateway.md` (Vercel hosting, AI Gateway extraction).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app that turns an uploaded ≤3-minute two-speaker English recording into a verified list of final commitments (tasks, owners, deadlines, open questions) with playable timestamped quotes, a shared run history, measured speed/cost, a reproducible test set, and GitHub → Cloud Run deployment.

**Architecture:** Next.js (App Router, TypeScript) served from one Docker image on Cloud Run. The browser uploads audio straight to Cloud Storage through a signed URL; stage endpoints validate the stored bytes, transcribe with Deepgram Nova-3, extract with Claude via structured outputs, and a deterministic verifier checks every quote, owner and deadline against the transcript. Every run (audio, event log, transcript, report, raw API responses) is stored under `runs/<id>/` behind a storage interface with `gcs` and `local` drivers.

**Tech Stack:** Next.js + React + TypeScript, `@anthropic-ai/sdk` + `zod`, Deepgram REST (fetch), `file-type`, `music-metadata`, `@google-cloud/storage`, Vitest, `tsx`, ffmpeg (test fixtures/synthesis only), Docker, GitHub Actions, Cloud Run, Artifact Registry, Secret Manager.

**Spec:** `docs/superpowers/specs/2026-09-16-commitments-extractor-design.md`

## Prerequisites (ask the user before the task that needs them)

- `DEEPGRAM_API_KEY` and `ANTHROPIC_API_KEY` in `.env.local` (Task 4 onward for live calls; Tasks 12–13 need both).
- ffmpeg/ffprobe on PATH (present on the dev machine: ffmpeg 8.1.2).
- A GCP project with billing, `gcloud` authenticated, and an empty GitHub repository (Task 14).

## Global Constraints

- Node 22; npm; TypeScript strict; import alias `@/*` → repository root.
- Extraction model from env `EXTRACT_MODEL`, default `claude-sonnet-5`. Never hardcode another model id elsewhere.
- Deepgram query: `model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true`.
- Limits: 1 KB ≤ size ≤ 35 MB; 3 s ≤ duration ≤ 180 s client-side, ≤ 185 s server-side.
- Rejection codes: `file_too_small`, `file_too_large`, `not_audio`, `contains_video`, `too_long`, `too_short`, `unreadable`.
- Report statuses: `ok` | `needs_clarification` | `no_commitments` | `declined`.
- Flags: `owner_missing` | `owner_disputed` | `owner_unverified` | `deadline_missing` | `deadline_disputed` | `deadline_unverified` | `date_context_missing`.
- Timestamps and speakers in evidence always come from Deepgram words, never from the model.
- Segment playback padding: 0.3 s before and after.
- Run ids: `YYYYMMDDTHHMMSSZ-xxxxxx` (6 chars `[a-z0-9]`); storage layout `runs/<id>/{audio,run.json,transcript.json,report.json,raw/deepgram.json,raw/claude.json}`.
- Shared-history notice text, verbatim: "Uploads are visible to everyone who opens this demo and are deleted after 30 days."
- No text input for the source recording anywhere in the UI; no microphone recording.
- Eval scripts never write to the shared history.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Refinements to the spec's expectation format (applied in Task 12/13, spec updated in the same commit)

The spec's §7 expectation format is extended so the deterministic eval is robust to wording the model and STT choose:
`anchor` may be a string or an array of alternatives; `owner_line` / `deadline_line` / `evidence_line` may be a number or an array (1-based script line numbers); `deadline_contains` (a phrase that must occur in the kept deadline wording, or `null` for "no deadline") replaces `deadline_wording`; `must_not` entries may use `has_deadline` and `deadline_contains`; `clarifications: [{ about: "owner" | "deadline" | "question", lines: number[] }]` checks clarification evidence by timestamp; precision counts extra **active** items as failures and lists other extras informationally. The `Clarification` type gains `about`.

## File Map

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts, eslint.config.mjs (scaffolded), .env.example, .gitignore
lib/types.ts                 shared domain types (Transcript, Evidence, Report, Run, Usage, CostBreakdown, …)
lib/limits.ts                limits, rejection codes, messages, audio extension set
lib/format.ts                mm:ss, ms, USD formatting
lib/bytes.ts                 Uint8Array → ArrayBuffer helper
lib/verify/text.ts           normalization, levenshtein, phrase search, quote span search
lib/gate/classify.ts         size/container/duration rules shared by client and server
lib/gate/file-check.ts       server-side file validation on bytes
lib/gate/precheck.ts         pre-LLM decline rules, significant speakers
lib/stt/deepgram.ts          Deepgram call + normalization to Transcript
lib/extract/schema.ts        zod schema for the model output
lib/extract/prompt.ts        system prompt + transcript rendering
lib/extract/claude.ts        structured-output call with one retry, attempt accounting
lib/verify/verify.ts         deterministic verifier → Report
lib/pricing.ts               dated price constants with sources
lib/metrics.ts               emptyUsage, computeCost
lib/store/store.ts           ObjectStore interface
lib/store/local.ts           filesystem driver
lib/store/gcs.ts             Cloud Storage driver
lib/store/index.ts           getStore()
lib/runs/runs.ts             run ids, run.json persistence, event log, listing, deletion
lib/pipeline.ts              runTranscribe, runExtract, processAudio, declinedReport, StageError
lib/runs/stages.ts           stageTranscribe, stageExtract (persistence + accounting)
app/layout.tsx, app/globals.css, app/page.tsx
app/api/health/route.ts
app/api/runs/route.ts                    POST create, GET list
app/api/runs/[id]/route.ts               GET, DELETE
app/api/runs/[id]/upload/route.ts        PUT (local driver only)
app/api/runs/[id]/transcribe/route.ts    POST
app/api/runs/[id]/extract/route.ts       POST
app/api/runs/[id]/audio/route.ts         GET
app/components/api.ts, clientFileCheck.ts, useSegmentPlayer.ts
app/components/EvidenceLine.tsx, ReportView.tsx, MetricsView.tsx, TranscriptView.tsx, EventLog.tsx, Uploader.tsx
app/history/page.tsx, app/history/[id]/page.tsx
scripts/make-invalid-fixtures.ts, scripts/synthesize.ts, scripts/eval-lib.ts, scripts/eval.ts
testset/invalid/* (+ expected.json), testset/01-normal|02-changed|03-clarify/{script.json,expected.json,audio.mp3,offsets.json}
tests/helpers/transcript.ts, tests/**/*.test.ts
Dockerfile, .dockerignore, infra/config.sh, infra/setup.sh, infra/cors.json, infra/lifecycle.json
.github/workflows/ci.yml, .github/workflows/deploy.yml
README.md, DELIVERY.md, eval/results/*
```

---

### Task 1: Project scaffold, test harness, shared types

**Files:**
- Create (scaffold): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `app/*`, `public/*`
- Create: `vitest.config.ts`, `.env.example`, `lib/types.ts`, `lib/limits.ts`, `lib/format.ts`, `lib/bytes.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Produces: all types in `lib/types.ts`; `LIMITS`, `RejectionCode`, `REJECTION_CODES`, `rejectionMessage(code, detail?)`, `AUDIO_EXTENSIONS` from `lib/limits.ts`; `formatTime(sec)`, `formatMs(ms)`, `formatUsd(n)` from `lib/format.ts`; `toArrayBuffer(bytes)` from `lib/bytes.ts`.

- [ ] **Step 1: Scaffold Next.js into a temporary folder and move it to the repo root**

```bash
cd E:/freelance/codebridge_test
npx create-next-app@latest scaffold --ts --eslint --app --no-tailwind --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes
cp -r scaffold/. . && rm -rf scaffold
npm install @anthropic-ai/sdk zod file-type music-metadata @google-cloud/storage
npm install -D vitest tsx
```

Expected: `package.json`, `app/`, `public/`, `next.config.ts`, `eslint.config.mjs` exist at the repo root; `git status` shows no changes to `docs/` or `TS.md`.

- [ ] **Step 2: Configure scripts, Next.js output and Vitest**

Edit `package.json` `"scripts"` to exactly:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "fixtures": "tsx scripts/make-invalid-fixtures.ts",
  "synth": "tsx --env-file=.env.local scripts/synthesize.ts",
  "eval": "tsx --env-file=.env.local scripts/eval.ts"
}
```

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
```

Create `.env.example`:

```
STORE_DRIVER=local
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=
EXTRACT_MODEL=claude-sonnet-5
# production only (Cloud Run sets these)
GCS_BUCKET=
```

Append to `.gitignore`:

```
.data/
testset/*/.work/
```

- [ ] **Step 3: Write shared types**

Create `lib/types.ts`:

```ts
export type Word = { word: string; punctuated: string; start: number; end: number };

export type Utterance = {
  id: string;
  speaker: number;
  start: number;
  end: number;
  text: string;
  words: Word[];
};

export type Transcript = {
  durationSec: number;
  utterances: Utterance[];
  speakerStats: { speaker: number; wordCount: number }[];
};

export const EVENT_TYPES = [
  "proposed",
  "accepted",
  "assigned",
  "deadline_set",
  "deadline_changed",
  "cancelled",
  "reopened",
  "question_raised",
  "left_open",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EvidenceType = EventType | "owner" | "deadline" | "intro";

export type Evidence = {
  type: EvidenceType;
  quote: string;
  utteranceId: string;
  speaker: number;
  speakerName: string | null;
  start: number;
  end: number;
};

export type Flag =
  | "owner_missing"
  | "owner_disputed"
  | "owner_unverified"
  | "deadline_missing"
  | "deadline_disputed"
  | "deadline_unverified"
  | "date_context_missing";

export type AgreementStatus = "agreed" | "none" | "disputed";
export type FinalStatus = "active" | "cancelled" | "not_accepted" | "open";

export type VerifiedItem = {
  kind: "task" | "open_question";
  summary: string;
  finalStatus: FinalStatus;
  owner: { status: AgreementStatus; name: string | null; evidence: Evidence | null };
  deadline: {
    status: AgreementStatus;
    wording: string | null;
    resolvedDate: string | null;
    evidence: Evidence | null;
  };
  flags: Flag[];
  events: Evidence[];
};

export type Clarification = {
  about: "owner" | "deadline" | "question";
  itemSummary: string;
  question: string;
  evidence: Evidence;
};

export type ReportStatus = "ok" | "needs_clarification" | "no_commitments" | "declined";

export type Stage = "upload" | "file-check" | "transcribe" | "precheck" | "extract" | "verify";

export type Usage = {
  audioSeconds: number;
  claudeModel: string;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeAttempts: number;
  gcsClassA: number;
  gcsClassB: number;
  storedBytes: number;
  retentionDays: number;
  egressBytes: number;
  cloudRunRequests: number;
  cloudRunSeconds: number;
  vcpu: number;
  memoryGib: number;
};

export type CostBreakdown = {
  recognition: number;
  reasoning: number;
  speech: number;
  storage: number;
  storageOps: number;
  egress: number;
  compute: number;
  total: number;
  perAudioMinute: number | null;
};

export type Metrics = {
  stageMs: Partial<Record<Stage, number>>;
  timeToResultMs: number | null;
  usage: Usage;
  cost: CostBreakdown;
};

export type Report = {
  status: ReportStatus;
  declineReasons: string[];
  clarifications: Clarification[];
  speakers: { speaker: number; name: string | null; intro: Evidence | null }[];
  items: VerifiedItem[];
  dropped: { summary: string; reason: string }[];
  metrics: Metrics | null;
};

export type RunStatus =
  | "created"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "extracting"
  | "done"
  | "rejected"
  | "failed";

export type RunEvent = {
  at: string;
  stage: Stage;
  type: "started" | "finished" | "rejected" | "failed" | "retry";
  detail: string;
  durationMs?: number;
};

export type Run = {
  id: string;
  createdAt: string;
  file: {
    name: string;
    sizeBytes: number;
    declaredType: string;
    detectedFormat: string | null;
    mime: string | null;
    durationSec: number | null;
    hasVideo: boolean | null;
  };
  status: RunStatus;
  failedStage: Stage | null;
  rejection: { code: string; message: string } | null;
  reportStatus: ReportStatus | null;
  events: RunEvent[];
  stageMs: Partial<Record<Stage, number>>;
  usage: Usage;
  timeToResultMs: number | null;
  cost: CostBreakdown | null;
};

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };
```

- [ ] **Step 4: Write limits, formatting and bytes helpers**

Create `lib/limits.ts`:

```ts
export const LIMITS = {
  minBytes: 1024,
  maxBytes: 35 * 1024 * 1024,
  minDurationSec: 3,
  maxDurationSec: 180,
  serverMaxDurationSec: 185,
} as const;

export const REJECTION_CODES = [
  "file_too_small",
  "file_too_large",
  "not_audio",
  "contains_video",
  "too_long",
  "too_short",
  "unreadable",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "mp4", "webm", "mkv", "ogg", "oga", "opus", "flac",
]);

export function rejectionMessage(code: RejectionCode, detail?: string): string {
  switch (code) {
    case "file_too_small":
      return "The file is empty or too small to be a recording (minimum 1 KB).";
    case "file_too_large":
      return "The file is larger than 35 MB.";
    case "not_audio":
      return `This is not an audio file${detail ? ` (detected: ${detail})` : ""}. Upload MP3, WAV, M4A, WebM, Ogg or FLAC audio.`;
    case "contains_video":
      return `This file contains video${detail ? ` (detected: ${detail} with a video track)` : ""}. Upload an audio-only file.`;
    case "too_long":
      return `The recording is longer than 3 minutes${detail ? ` (${detail})` : ""}.`;
    case "too_short":
      return `The recording is shorter than 3 seconds${detail ? ` (${detail})` : ""}.`;
    case "unreadable":
      return "The file is corrupted or not an audio file.";
  }
}
```

Create `lib/format.ts`:

```ts
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
}
```

Create `lib/bytes.ts`:

```ts
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
```

- [ ] **Step 5: Write the failing test**

Create `tests/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMs, formatTime, formatUsd } from "@/lib/format";

describe("format", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65.9)).toBe("01:05");
  });
  it("formats durations", () => {
    expect(formatMs(250)).toBe("250 ms");
    expect(formatMs(14230)).toBe("14.2 s");
    expect(formatMs(null)).toBe("—");
  });
  it("formats USD with enough precision for tiny costs", () => {
    expect(formatUsd(0.0586)).toBe("$0.0586");
    expect(formatUsd(0.00123)).toBe("$0.00123");
  });
});
```

- [ ] **Step 6: Run tests, typecheck, lint, build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: 3 tests pass; typecheck, lint and build succeed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app, vitest, shared types and limits

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Text normalization and quote matching

**Files:**
- Create: `lib/verify/text.ts`
- Test: `tests/lib/verify/text.test.ts`

**Interfaces:**
- Produces: `normalize(s): string`, `tokens(s): string[]`, `levenshtein(a,b): number`, `similarity(a,b): number`, `containsPhrase(haystack, needle): boolean`, `fuzzyContainsPhrase(haystack, needle, maxEdits?): boolean`, `findQuoteSpan(quote, words: {punctuated: string}[], minSimilarity = 0.9): { first: number; last: number } | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/verify/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  containsPhrase,
  findQuoteSpan,
  fuzzyContainsPhrase,
  levenshtein,
  normalize,
} from "@/lib/verify/text";

const words = (s: string) => s.split(" ").map((punctuated) => ({ punctuated }));

describe("normalize", () => {
  it("lowercases, drops apostrophes and punctuation, collapses spaces", () => {
    expect(normalize("  I'll write the API docs, by Wednesday! ")).toBe("ill write the api docs by wednesday");
    expect(normalize("It’s done")).toBe("its done");
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("survey", "server")).toBe(2);
    expect(levenshtein("docs", "docs")).toBe(0);
  });
});

describe("containsPhrase", () => {
  it("matches whole words only", () => {
    expect(containsPhrase("I'll write the API docs by Wednesday.", "by wednesday")).toBe(true);
    expect(containsPhrase("the API docs", "API doc")).toBe(false);
  });
});

describe("fuzzyContainsPhrase", () => {
  it("allows edits proportional to phrase length", () => {
    expect(fuzzyContainsPhrase("we need the API dogs soon", "API docs")).toBe(true);
    expect(fuzzyContainsPhrase("the staging server", "survey")).toBe(false);
    expect(fuzzyContainsPhrase("book the room for the demo", "book the room")).toBe(true);
  });
});

describe("findQuoteSpan", () => {
  const ws = words("Okay, so I'll write the API docs by Wednesday, promise.");
  it("finds an exact quote and returns word indices", () => {
    expect(findQuoteSpan("I'll write the API docs by Wednesday", ws)).toEqual({ first: 2, last: 8 });
  });
  it("tolerates small differences", () => {
    expect(findQuoteSpan("I will write the API docs by Wednesday", ws)).toEqual({ first: 2, last: 8 });
  });
  it("rejects fabricated quotes", () => {
    expect(findQuoteSpan("Anna will write the docs by Friday", ws)).toBeNull();
  });
  it("returns null for empty quotes", () => {
    expect(findQuoteSpan("  ", ws)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verify/text.test.ts`
Expected: FAIL — cannot resolve `@/lib/verify/text`.

- [ ] **Step 3: Write the implementation**

Create `lib/verify/text.ts`:

```ts
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export function containsPhrase(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  return ` ${normalize(haystack)} `.includes(` ${n} `);
}

export function fuzzyContainsPhrase(haystack: string, needle: string, maxEdits?: number): boolean {
  const nt = tokens(needle);
  if (!nt.length) return false;
  const n = nt.join(" ");
  const allowed = maxEdits ?? Math.min(2, Math.floor(n.length / 6));
  const ht = tokens(haystack);
  for (let i = 0; i + nt.length <= ht.length; i++) {
    if (levenshtein(ht.slice(i, i + nt.length).join(" "), n) <= allowed) return true;
  }
  return false;
}

export type WordSpan = { first: number; last: number };

export function findQuoteSpan(
  quote: string,
  words: { punctuated: string }[],
  minSimilarity = 0.9,
): WordSpan | null {
  const q = tokens(quote);
  if (!q.length) return null;
  const flat: { tok: string; wordIndex: number }[] = [];
  words.forEach((w, wordIndex) => tokens(w.punctuated).forEach((tok) => flat.push({ tok, wordIndex })));
  const qs = q.join(" ");
  let best: { span: WordSpan; score: number } | null = null;
  // Window sizes around the quote length absorb contractions such as "I'll" vs "I will".
  for (let size = Math.max(1, q.length - 1); size <= q.length + 1; size++) {
    for (let i = 0; i + size <= flat.length; i++) {
      const win = flat.slice(i, i + size);
      const ws = win.map((x) => x.tok).join(" ");
      const score = ws === qs ? 1 : similarity(ws, qs);
      if (score >= minSimilarity && (!best || score > best.score)) {
        best = { span: { first: win[0].wordIndex, last: win[win.length - 1].wordIndex }, score };
      }
    }
  }
  return best?.span ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/verify/text.test.ts`
Expected: PASS (all tests). If "I will write…" does not reach 0.9 similarity, lower nothing — instead check that the window loop covers `q.length - 1`; the expected similarity is `1 - 3/38 ≈ 0.92`.

- [ ] **Step 5: Commit**

```bash
git add lib/verify/text.ts tests/lib/verify/text.test.ts
git commit -m "feat: text normalization and verbatim quote matching

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: File classification and server-side file check

**Files:**
- Create: `lib/gate/classify.ts`, `lib/gate/file-check.ts`, `scripts/make-invalid-fixtures.ts`
- Create (generated, committed): `testset/invalid/video-renamed.mp3`, `video-renamed.m4a`, `webm-video-renamed.webm`, `text-renamed.mp3`, `wav-renamed.mp3`, `too-long.mp3`, `too-short.mp3`, `empty.mp3`, `expected.json`
- Test: `tests/lib/gate/classify.test.ts`, `tests/lib/gate/file-check.test.ts`

**Interfaces:**
- Consumes: `LIMITS`, `RejectionCode`, `rejectionMessage`, `AUDIO_EXTENSIONS` (Task 1).
- Produces:
  - `checkSize(n: number): RejectionCode | null`
  - `checkContainer(ft: { ext: string; mime: string } | undefined): { code: RejectionCode | null; detail?: string }`
  - `checkDuration(sec: number | null, max: number): RejectionCode | null`
  - `type FileCheckOk = { ok: true; detectedFormat: string; mime: string; durationSec: number | null; hasVideo: false }`
  - `type FileCheckFail = { ok: false; code: RejectionCode; message: string; detectedFormat: string | null; mime: string | null; durationSec: number | null; hasVideo: boolean | null }`
  - `checkAudioFile(bytes: Uint8Array): Promise<FileCheckOk | FileCheckFail>`
  - `mp4HasVideoHandler(bytes: Uint8Array): boolean`

The too-large case is tested with an in-memory buffer (a 37 MB fixture does not belong in git).

- [ ] **Step 1: Write the fixture generator**

Create `scripts/make-invalid-fixtures.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.join("testset", "invalid");
mkdirSync(dir, { recursive: true });

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

const videoIn = ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-f", "lavfi", "-i", "sine=frequency=440"];

// MP4 with a video track, saved under audio extensions
for (const name of ["video-renamed.mp3", "video-renamed.m4a"]) {
  ffmpeg([...videoIn, "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", path.join(dir, name)]);
}
// WebM with a video track
ffmpeg([...videoIn, "-t", "5", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", "-f", "webm", path.join(dir, "webm-video-renamed.webm")]);
// Valid WAV named .mp3
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-f", "wav", path.join(dir, "wav-renamed.mp3")]);
// 200 s and 1 s MP3
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=200", "-c:a", "libmp3lame", "-b:a", "32k", path.join(dir, "too-long.mp3")]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", "-b:a", "64k", path.join(dir, "too-short.mp3")]);
// Plain text (> 1 KB so the size rule does not fire first) and an empty file
writeFileSync(path.join(dir, "text-renamed.mp3"), "This is not audio. ".repeat(120));
writeFileSync(path.join(dir, "empty.mp3"), "");

writeFileSync(
  path.join(dir, "expected.json"),
  JSON.stringify(
    {
      "video-renamed.mp3": "contains_video",
      "video-renamed.m4a": "contains_video",
      "webm-video-renamed.webm": "contains_video",
      "text-renamed.mp3": "not_audio",
      "wav-renamed.mp3": "ok",
      "too-long.mp3": "too_long",
      "too-short.mp3": "too_short",
      "empty.mp3": "file_too_small",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Fixtures written to ${dir}`);
```

- [ ] **Step 2: Generate fixtures**

Run: `npm run fixtures && ls -la testset/invalid`
Expected: 9 files; `too-long.mp3` ≈ 800 KB; `empty.mp3` 0 bytes.

- [ ] **Step 3: Write the failing tests**

Create `tests/lib/gate/classify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS } from "@/lib/limits";

describe("classify", () => {
  it("checks size bounds", () => {
    expect(checkSize(0)).toBe("file_too_small");
    expect(checkSize(LIMITS.maxBytes + 1)).toBe("file_too_large");
    expect(checkSize(2 * 1024 * 1024)).toBeNull();
  });
  it("classifies containers by detected type, not extension", () => {
    expect(checkContainer(undefined).code).toBe("not_audio");
    expect(checkContainer({ ext: "mp3", mime: "audio/mpeg" }).code).toBeNull();
    expect(checkContainer({ ext: "mov", mime: "video/quicktime" })).toEqual({ code: "contains_video", detail: "MOV" });
    expect(checkContainer({ ext: "png", mime: "image/png" })).toEqual({ code: "not_audio", detail: "PNG" });
  });
  it("checks duration bounds and accepts unknown duration", () => {
    expect(checkDuration(null, 180)).toBeNull();
    expect(checkDuration(1, 180)).toBe("too_short");
    expect(checkDuration(183, 180)).toBe("too_long");
    expect(checkDuration(183, 185)).toBeNull();
  });
});
```

Create `tests/lib/gate/file-check.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAudioFile } from "@/lib/gate/file-check";
import { LIMITS } from "@/lib/limits";

const dir = path.join("testset", "invalid");
const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as Record<string, string>;

describe("checkAudioFile on fixtures", () => {
  for (const [file, want] of Object.entries(expected)) {
    it(`${file} → ${want}`, async () => {
      const result = await checkAudioFile(new Uint8Array(readFileSync(path.join(dir, file))));
      expect(result.ok ? "ok" : result.code).toBe(want);
    });
  }

  it("rejects files larger than the limit before parsing", async () => {
    const result = await checkAudioFile(new Uint8Array(LIMITS.maxBytes + 1));
    expect(result.ok ? "ok" : result.code).toBe("file_too_large");
  });

  it("reports detected format and duration for accepted audio", async () => {
    const result = await checkAudioFile(new Uint8Array(readFileSync(path.join(dir, "wav-renamed.mp3"))));
    expect(result).toMatchObject({ ok: true, detectedFormat: "wav", hasVideo: false });
    expect(result.durationSec).toBeCloseTo(5, 0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/lib/gate`
Expected: FAIL — cannot resolve `@/lib/gate/classify` / `@/lib/gate/file-check`.

- [ ] **Step 5: Write the implementation**

Create `lib/gate/classify.ts`:

```ts
import { AUDIO_EXTENSIONS, LIMITS, type RejectionCode } from "@/lib/limits";

export function checkSize(n: number): RejectionCode | null {
  if (n < LIMITS.minBytes) return "file_too_small";
  if (n > LIMITS.maxBytes) return "file_too_large";
  return null;
}

export function checkContainer(
  ft: { ext: string; mime: string } | undefined,
): { code: RejectionCode | null; detail?: string } {
  if (!ft) return { code: "not_audio" };
  if (AUDIO_EXTENSIONS.has(ft.ext)) return { code: null };
  if (ft.mime.startsWith("video/")) return { code: "contains_video", detail: ft.ext.toUpperCase() };
  return { code: "not_audio", detail: ft.ext.toUpperCase() };
}

export function checkDuration(sec: number | null, max: number): RejectionCode | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  if (sec < LIMITS.minDurationSec) return "too_short";
  if (sec > max) return "too_long";
  return null;
}
```

Create `lib/gate/file-check.ts`:

```ts
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS, rejectionMessage, type RejectionCode } from "@/lib/limits";

export type FileCheckOk = {
  ok: true;
  detectedFormat: string;
  mime: string;
  durationSec: number | null;
  hasVideo: false;
};

export type FileCheckFail = {
  ok: false;
  code: RejectionCode;
  message: string;
  detectedFormat: string | null;
  mime: string | null;
  durationSec: number | null;
  hasVideo: boolean | null;
};

/** ISO-BMFF `hdlr` box: [size:4]["hdlr"][version+flags:4][pre_defined:4][handler_type:4]. */
export function mp4HasVideoHandler(bytes: Uint8Array): boolean {
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (bytes[i] === 0x68 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x6c && bytes[i + 3] === 0x72) {
      if (String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]) === "vide") return true;
    }
  }
  return false;
}

function fail(code: RejectionCode, extra: Partial<FileCheckFail> = {}, detail?: string): FileCheckFail {
  return {
    ok: false,
    code,
    message: rejectionMessage(code, detail),
    detectedFormat: null,
    mime: null,
    durationSec: null,
    hasVideo: null,
    ...extra,
  };
}

export async function checkAudioFile(bytes: Uint8Array): Promise<FileCheckOk | FileCheckFail> {
  const sizeCode = checkSize(bytes.byteLength);
  if (sizeCode) return fail(sizeCode);

  const ft = await fileTypeFromBuffer(bytes);
  const container = checkContainer(ft);
  if (container.code || !ft) {
    return fail(container.code ?? "not_audio", { detectedFormat: ft?.ext ?? null, mime: ft?.mime ?? null }, container.detail);
  }
  const detectedFormat = ft.ext;
  const mime = ft.mime;

  let meta: Awaited<ReturnType<typeof parseBuffer>>;
  try {
    meta = await parseBuffer(bytes, { mimeType: mime, size: bytes.byteLength }, { duration: true });
  } catch {
    return fail("unreadable", { detectedFormat, mime });
  }

  const isoBmff = detectedFormat === "mp4" || detectedFormat === "m4a";
  const hasVideo =
    meta.format.hasVideo === true ||
    meta.format.trackInfo.some((t) => t.video != null) ||
    (isoBmff && mp4HasVideoHandler(bytes));
  if (hasVideo) return fail("contains_video", { detectedFormat, mime, hasVideo: true }, detectedFormat.toUpperCase());

  const durationSec = meta.format.duration ?? null;
  const durationCode = checkDuration(durationSec, LIMITS.serverMaxDurationSec);
  if (durationCode) {
    return fail(durationCode, { detectedFormat, mime, durationSec, hasVideo: false }, `${durationSec?.toFixed(1)} s`);
  }
  return { ok: true, detectedFormat, mime, durationSec, hasVideo: false };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/gate`
Expected: PASS. If `webm-video-renamed.webm` returns `ok`, inspect `meta.format.trackInfo` in a quick `tsx` one-liner and extend the `hasVideo` expression with the field that marks the video track (e.g. `t.type === 1` for Matroska video); keep the test unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/gate scripts/make-invalid-fixtures.ts testset/invalid tests/lib/gate
git commit -m "feat: content-based file validation (renamed video, size, duration)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Deepgram transcription and pre-LLM checks

**Files:**
- Create: `lib/stt/deepgram.ts`, `lib/gate/precheck.ts`, `tests/helpers/transcript.ts`
- Test: `tests/lib/stt/deepgram.test.ts`, `tests/lib/gate/precheck.test.ts`

**Interfaces:**
- Consumes: `Transcript` (Task 1), `toArrayBuffer` (Task 1), `LIMITS` (Task 1).
- Produces:
  - `DEEPGRAM_QUERY: string`
  - `type DeepgramResponse`
  - `normalizeDeepgram(raw: DeepgramResponse): Transcript`
  - `transcribeBytes(bytes: Uint8Array, contentType: string, apiKey?: string): Promise<{ transcript: Transcript; raw: DeepgramResponse }>`
  - `significantSpeakers(t: Transcript): number[]`
  - `precheck(t: Transcript): string[]` (empty array = pass)
  - test helper `makeTranscript(lines: [speaker: number, text: string][]): Transcript`

- [ ] **Step 1: Write the test helper**

Create `tests/helpers/transcript.ts`:

```ts
import type { Transcript, Utterance } from "@/lib/types";

/** Builds a transcript with evenly spaced word timings: each word 0.3 s, 0.05 s gap, 0.5 s between utterances. */
export function makeTranscript(lines: [number, string][]): Transcript {
  let t = 0;
  const utterances: Utterance[] = lines.map(([speaker, text], i) => {
    const words = text
      .split(/\s+/)
      .filter(Boolean)
      .map((punctuated) => {
        const w = { word: punctuated.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""), punctuated, start: t, end: t + 0.3 };
        t += 0.35;
        return w;
      });
    t += 0.5;
    return { id: `u${i + 1}`, speaker, start: words[0].start, end: words[words.length - 1].end, text, words };
  });
  const counts = new Map<number, number>();
  for (const u of utterances) counts.set(u.speaker, (counts.get(u.speaker) ?? 0) + u.words.length);
  return {
    durationSec: t,
    utterances,
    speakerStats: [...counts].map(([speaker, wordCount]) => ({ speaker, wordCount })),
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/stt/deepgram.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { normalizeDeepgram, transcribeBytes, type DeepgramResponse } from "@/lib/stt/deepgram";

const raw: DeepgramResponse = {
  metadata: { duration: 7.5 },
  results: {
    utterances: [
      {
        start: 4.1, end: 6.0, transcript: "I'm Mark.", speaker: 1,
        words: [
          { word: "i'm", punctuated_word: "I'm", start: 4.1, end: 4.4, speaker: 1 },
          { word: "mark", punctuated_word: "Mark.", start: 4.5, end: 6.0, speaker: 1 },
        ],
      },
      {
        start: 0.2, end: 2.0, transcript: "Hi, I'm Anna.", speaker: 0,
        words: [
          { word: "hi", punctuated_word: "Hi,", start: 0.2, end: 0.5, speaker: 0 },
          { word: "i'm", punctuated_word: "I'm", start: 0.6, end: 0.9, speaker: 0 },
          { word: "anna", punctuated_word: "Anna.", start: 1.0, end: 2.0, speaker: 0 },
        ],
      },
    ],
  },
};

describe("normalizeDeepgram", () => {
  it("orders utterances by time, assigns ids and counts words per speaker", () => {
    const t = normalizeDeepgram(raw);
    expect(t.durationSec).toBe(7.5);
    expect(t.utterances.map((u) => [u.id, u.speaker, u.text])).toEqual([
      ["u1", 0, "Hi, I'm Anna."],
      ["u2", 1, "I'm Mark."],
    ]);
    expect(t.utterances[0].words[0]).toEqual({ word: "hi", punctuated: "Hi,", start: 0.2, end: 0.5 });
    expect(t.speakerStats).toEqual([{ speaker: 0, wordCount: 3 }, { speaker: 1, wordCount: 2 }]);
  });
});

describe("transcribeBytes", () => {
  it("posts bytes with the fixed query and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { transcript } = await transcribeBytes(new Uint8Array([1, 2, 3]), "audio/mpeg", "key");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true",
    );
    expect(init.headers).toMatchObject({ Authorization: "Token key", "Content-Type": "audio/mpeg" });
    expect(transcript.utterances).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("throws with status on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })));
    await expect(transcribeBytes(new Uint8Array([1]), "audio/mpeg", "key")).rejects.toThrow("Deepgram 401");
    vi.unstubAllGlobals();
  });
});
```

Create `tests/lib/gate/precheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { precheck, significantSpeakers } from "@/lib/gate/precheck";
import { makeTranscript } from "../../helpers/transcript";

const long = "word ".repeat(12).trim();

describe("precheck", () => {
  it("passes two speakers with enough speech", () => {
    expect(precheck(makeTranscript([[0, long], [1, long]]))).toEqual([]);
  });
  it("declines three significant speakers", () => {
    const t = makeTranscript([[0, long], [1, long], [2, long]]);
    expect(significantSpeakers(t)).toEqual([0, 1, 2]);
    expect(precheck(t)[0]).toContain("3 speaker(s) detected");
  });
  it("ignores a speaker with under 5% of words", () => {
    const t = makeTranscript([[0, long + " " + long], [1, long], [2, "yes"]]);
    expect(significantSpeakers(t)).toEqual([0, 1]);
  });
  it("declines too little speech", () => {
    expect(precheck(makeTranscript([[0, "hello there"], [1, "hi"]]))[0]).toContain("Only 3 words");
  });
  it("declines recordings over 185 s", () => {
    const t = { ...makeTranscript([[0, long], [1, long]]), durationSec: 200 };
    expect(precheck(t)[0]).toContain("200 s");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/stt tests/lib/gate/precheck.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the implementation**

Create `lib/stt/deepgram.ts`:

```ts
import { toArrayBuffer } from "@/lib/bytes";
import type { Transcript } from "@/lib/types";

export const DEEPGRAM_QUERY =
  "model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true";

type DgWord = { word: string; punctuated_word?: string; start: number; end: number; speaker?: number };
type DgUtterance = { start: number; end: number; transcript: string; speaker?: number; words: DgWord[] };
export type DeepgramResponse = { metadata: { duration: number }; results: { utterances?: DgUtterance[] } };

export function normalizeDeepgram(raw: DeepgramResponse): Transcript {
  const sorted = [...(raw.results.utterances ?? [])].sort((a, b) => a.start - b.start);
  const utterances = sorted.map((u, i) => ({
    id: `u${i + 1}`,
    speaker: u.speaker ?? 0,
    start: u.start,
    end: u.end,
    text: u.transcript,
    words: u.words.map((w) => ({ word: w.word, punctuated: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
  }));
  const counts = new Map<number, number>();
  for (const u of utterances) counts.set(u.speaker, (counts.get(u.speaker) ?? 0) + u.words.length);
  return {
    durationSec: raw.metadata.duration,
    utterances,
    speakerStats: [...counts]
      .map(([speaker, wordCount]) => ({ speaker, wordCount }))
      .sort((a, b) => a.speaker - b.speaker),
  };
}

export async function transcribeBytes(
  bytes: Uint8Array,
  contentType: string,
  apiKey = process.env.DEEPGRAM_API_KEY,
): Promise<{ transcript: Transcript; raw: DeepgramResponse }> {
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DEEPGRAM_QUERY}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
    body: toArrayBuffer(bytes),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const raw = (await res.json()) as DeepgramResponse;
  return { transcript: normalizeDeepgram(raw), raw };
}
```

Create `lib/gate/precheck.ts`:

```ts
import { LIMITS } from "@/lib/limits";
import type { Transcript } from "@/lib/types";

function totalWords(t: Transcript): number {
  return t.speakerStats.reduce((sum, s) => sum + s.wordCount, 0);
}

/** Speakers with at least 5% of recognized words, ascending. */
export function significantSpeakers(t: Transcript): number[] {
  const total = totalWords(t);
  if (total === 0) return [];
  return t.speakerStats
    .filter((s) => s.wordCount / total >= 0.05)
    .map((s) => s.speaker)
    .sort((a, b) => a - b);
}

export function precheck(t: Transcript): string[] {
  const reasons: string[] = [];
  if (t.durationSec > LIMITS.serverMaxDurationSec) {
    reasons.push(`Recording is ${Math.round(t.durationSec)} s long; the limit is 3 minutes.`);
  }
  const total = totalWords(t);
  if (total < 20) {
    reasons.push(`Only ${total} words were recognized; there is not enough speech to extract commitments.`);
  } else {
    const n = significantSpeakers(t).length;
    if (n !== 2) reasons.push(`${n} speaker(s) detected; this product supports exactly 2 speakers.`);
  }
  return reasons;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/stt tests/lib/gate/precheck.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/stt lib/gate/precheck.ts tests/helpers tests/lib/stt tests/lib/gate/precheck.test.ts
git commit -m "feat: Deepgram transcription normalization and pre-LLM checks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Extraction schema, prompt and Claude call

**Files:**
- Create: `lib/extract/schema.ts`, `lib/extract/prompt.ts`, `lib/extract/claude.ts`
- Test: `tests/lib/extract/prompt.test.ts`, `tests/lib/extract/claude.test.ts`

**Interfaces:**
- Consumes: `Transcript`, `EVENT_TYPES` (Task 1); `formatTime` is not used here (prompt uses seconds with one decimal).
- Produces:
  - `ExtractionSchema` (zod), `type Extraction`, `type ExtractedItem = Extraction["items"][number]`, `type EvidenceRef = { utterance_id: string; quote: string }`
  - `SYSTEM_PROMPT: string`, `renderTranscript(t: Transcript): string`
  - `EXTRACT_MODEL: string`
  - `type ClaudeAttempt = { ok: boolean; stopReason: string | null; inputTokens: number; outputTokens: number; error?: string; raw: unknown }`
  - `class ExtractionError extends Error { attempts: ClaudeAttempt[] }`
  - `extractCommitments(t: Transcript, client?: Anthropic): Promise<{ extraction: Extraction; attempts: ClaudeAttempt[] }>`

Uses `client.messages.parse` with `output_config.format = zodOutputFormat(ExtractionSchema)` (structured outputs; documented in the claude-api skill). Thinking is left at the model default.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/extract/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { makeTranscript } from "../../helpers/transcript";

describe("renderTranscript", () => {
  it("renders one line per utterance with id, speaker and seconds", () => {
    const lines = renderTranscript(makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]])).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[u1] Speaker 0 (0.0–1.0 s): Hi, I'm Anna.");
    expect(lines[1]).toMatch(/^\[u2\] Speaker 1 \(\d+\.\d–\d+\.\d s\): I'm Mark\.$/);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("states the non-negotiable rules", () => {
    for (const phrase of ["we could", "cancelled", "null", "verbatim", "accepted", "assigned", "disputed"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });
});
```

Create `tests/lib/extract/claude.test.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ExtractionError, extractCommitments } from "@/lib/extract/claude";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]]);
const extraction: Extraction = { speakers: [], no_commitments_discussed: true, items: [] };

function fakeClient(responses: unknown[]) {
  const parse = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce(r);
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const ok = { parsed_output: extraction, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } };
const truncated = { parsed_output: null, stop_reason: "max_tokens", usage: { input_tokens: 1000, output_tokens: 16000 } };

describe("extractCommitments", () => {
  it("returns the parsed extraction and token usage", async () => {
    const { client, parse } = fakeClient([ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.extraction).toEqual(extraction);
    expect(result.attempts).toEqual([
      { ok: true, stopReason: "end_turn", inputTokens: 1000, outputTokens: 200, raw: ok },
    ]);
    const body = parse.mock.calls[0][0];
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages[0].content).toContain("[u1] Speaker 0");
    expect(body.output_config.format).toBeDefined();
  });

  it("retries once when the output is not parsed, counting both attempts", async () => {
    const { client } = fakeClient([truncated, ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0].outputTokens).toBe(16000);
  });

  it("throws ExtractionError with attempts after two failures", async () => {
    const { client } = fakeClient([truncated, new Error("invalid JSON")]);
    const err = await extractCommitments(transcript, client).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).attempts).toHaveLength(2);
    expect((err as ExtractionError).attempts[1].error).toContain("invalid JSON");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/extract`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the schema**

Create `lib/extract/schema.ts`:

```ts
import { z } from "zod";
import { EVENT_TYPES } from "@/lib/types";

const EvidenceRefSchema = z.object({
  utterance_id: z.string(),
  quote: z.string(),
});

const Agreement = z.enum(["agreed", "none", "disputed"]);

export const ExtractionSchema = z.object({
  speakers: z.array(
    z.object({
      speaker: z.number().int(),
      name: z.string().nullable(),
      intro_utterance_id: z.string().nullable(),
    }),
  ),
  no_commitments_discussed: z.boolean(),
  items: z.array(
    z.object({
      kind: z.enum(["task", "open_question"]),
      summary: z.string(),
      final_status: z.enum(["active", "cancelled", "not_accepted", "open"]),
      owner: z.object({
        status: Agreement,
        name: z.string().nullable(),
        evidence: EvidenceRefSchema.nullable(),
      }),
      deadline: z.object({
        status: Agreement,
        wording: z.string().nullable(),
        evidence: EvidenceRefSchema.nullable(),
        resolved_date: z.string().nullable(),
        anchor_utterance_id: z.string().nullable(),
      }),
      events: z.array(
        z.object({
          type: z.enum(EVENT_TYPES),
          utterance_id: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedItem = Extraction["items"][number];
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
```

- [ ] **Step 4: Write the prompt**

Create `lib/extract/prompt.ts`:

```ts
import type { Transcript } from "@/lib/types";

export const SYSTEM_PROMPT = `You extract the FINAL commitments from a transcript of a recorded project discussion between two people.
You are building a reliable commitments list, not a meeting summary. Every claim you make is checked against the transcript by code; anything without a verbatim quote is discarded.

Input: one line per utterance: [utterance_id] Speaker N (start–end s): text

Output rules:
1. speakers: for each speaker number, the name they introduce themselves with and the utterance_id where they say it. If a speaker never states their own name, name is null and intro_utterance_id is null. Never guess names.
2. items: every task, proposal and unresolved question discussed.
   - kind "task" with final_status:
     - "active": explicitly agreed and still in force at the end of the conversation.
     - "cancelled": agreed or planned earlier, then explicitly dropped.
     - "not_accepted": proposed but never agreed. Tentative language such as "we could", "maybe", "we should probably" is a proposal, not an agreement, unless the other person explicitly agrees.
   - kind "open_question" with final_status "open": a question raised and not answered or explicitly left open.
3. Later statements override earlier ones. Report only the final state, but record the history in events.
4. events: chronological evidence for the item. Each event has a type, the utterance_id and a quote copied verbatim from that single utterance (a contiguous run of its words, no paraphrase, no ellipsis). Types: proposed, accepted, assigned, deadline_set, deadline_changed, cancelled, reopened, question_raised, left_open.
   - Every "active" task MUST include an "accepted" or "assigned" event whose quote shows the agreement.
   - Every "cancelled" task MUST include a "cancelled" event. Every "not_accepted" task MUST include a "proposed" event. Every open question MUST include "question_raised" or "left_open".
5. owner:
   - status "agreed" only when a specific utterance settles who does it (the person commits: "I'll do it", or is named and accepts). name is that person's name; evidence is that utterance with a verbatim quote.
   - status "none" when nobody is named ("someone needs to…"): name null, evidence null. Never infer an owner from who raised the topic.
   - status "disputed" when responsibility is discussed but not settled: name null, evidence is the utterance that leaves it open.
6. deadline:
   - status "agreed" only when a specific utterance settles the deadline. wording is the deadline words copied verbatim (e.g. "by Wednesday", "before next Tuesday"). evidence is that utterance; for a corrected deadline use the correction, never the superseded date.
   - resolved_date: an ISO date ONLY if the recording itself states the calendar date needed to resolve it; then anchor_utterance_id is the utterance stating that date. Otherwise both are null. Never use today's real date.
   - status "none": wording, evidence, resolved_date and anchor_utterance_id are null.
   - status "disputed": wording null, evidence is the utterance that leaves it undecided.
7. no_commitments_discussed: true only if the conversation contains no tasks, proposals or questions about work.
8. Use null rather than guessing. Do not turn "we could" into "we will". Do not keep a cancelled task as active.`;

export function renderTranscript(t: Transcript): string {
  return t.utterances
    .map((u) => `[${u.id}] Speaker ${u.speaker} (${u.start.toFixed(1)}–${u.end.toFixed(1)} s): ${u.text}`)
    .join("\n");
}
```

- [ ] **Step 5: Write the Claude call**

Create `lib/extract/claude.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { ExtractionSchema, type Extraction } from "@/lib/extract/schema";
import type { Transcript } from "@/lib/types";

export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "claude-sonnet-5";
const MAX_ATTEMPTS = 2;

export type ClaudeAttempt = {
  ok: boolean;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  raw: unknown;
};

export class ExtractionError extends Error {
  constructor(message: string, public attempts: ClaudeAttempt[]) {
    super(message);
    this.name = "ExtractionError";
  }
}

export async function extractCommitments(
  transcript: Transcript,
  client: Anthropic = new Anthropic(),
): Promise<{ extraction: Extraction; attempts: ClaudeAttempt[] }> {
  const attempts: ClaudeAttempt[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await client.messages.parse({
        model: EXTRACT_MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: renderTranscript(transcript) }],
        output_config: { format: zodOutputFormat(ExtractionSchema) },
      });
      const attempt: ClaudeAttempt = {
        ok: res.parsed_output != null,
        stopReason: res.stop_reason,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        raw: res,
      };
      if (!attempt.ok) attempt.error = `No parsed output (stop_reason: ${res.stop_reason})`;
      attempts.push(attempt);
      if (res.parsed_output) return { extraction: res.parsed_output, attempts };
    } catch (e) {
      // Authentication, permission and request-shape errors will not fix themselves on retry.
      if (e instanceof Anthropic.APIError && e.status != null && [400, 401, 403, 404].includes(e.status)) throw e;
      attempts.push({
        ok: false,
        stopReason: null,
        inputTokens: 0,
        outputTokens: 0,
        error: e instanceof Error ? e.message : String(e),
        raw: null,
      });
    }
  }
  throw new ExtractionError(`Extraction failed after ${attempts.length} attempts`, attempts);
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/lib/extract && npm run typecheck`
Expected: PASS. If `zodOutputFormat` rejects `z.number().int()` or `.nullable()` at type level, follow the TypeScript error to the helper's accepted zod version (the `@anthropic-ai/sdk` package.json `peerDependencies` names it) and pin `zod` to that version; do not hand-roll JSON schema.

- [ ] **Step 7: Live smoke check (requires `ANTHROPIC_API_KEY` in `.env.local`)**

Run:

```bash
npx tsx --env-file=.env.local -e "import('./lib/extract/claude.ts').then(async m => { const t = {durationSec: 6, speakerStats: [], utterances: [{id:'u1',speaker:0,start:0,end:2,text:\"Hi, I'm Anna. Mark, can you write the API docs by Wednesday?\",words:[]},{id:'u2',speaker:1,start:2,end:4,text:\"I'm Mark. Sure, I'll write them by Wednesday.\",words:[]}]}; const r = await m.extractCommitments(t); console.log(JSON.stringify(r.extraction, null, 2), r.attempts.map(a => [a.inputTokens, a.outputTokens])); })"
```

Expected: one `task` item, `final_status: "active"`, owner Mark with evidence in `u2`, deadline wording containing "by Wednesday". Record the token counts in your notes for DELIVERY.md.

- [ ] **Step 8: Commit**

```bash
git add lib/extract tests/lib/extract
git commit -m "feat: structured Claude extraction with event timeline and retry accounting

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Deterministic verifier

**Files:**
- Create: `lib/verify/verify.ts`
- Test: `tests/lib/verify/verify.test.ts`

**Interfaces:**
- Consumes: `Transcript`, `Evidence`, `EvidenceType`, `VerifiedItem`, `Report`, `Flag`, `Clarification` (Task 1); `findQuoteSpan`, `containsPhrase`, `normalize` (Task 2); `significantSpeakers` (Task 4); `Extraction`, `ExtractedItem`, `EvidenceRef` (Task 5).
- Produces: `verify(t: Transcript, x: Extraction): Report` (with `metrics: null`), `isAbsoluteDate(text: string): boolean`.

Rules implemented (spec §5 and "Decline and status rules"):
1. Quote → located in the referenced utterance, else any utterance; evidence text, timestamps and speaker come from the transcript words.
2. Final-state support: `active` needs `accepted`/`assigned`; `cancelled` needs `cancelled`; `not_accepted` needs `proposed`; `open` needs `question_raised`/`left_open`. `open` only with `open_question`, and `open_question` only with `open`.
3. Owner/deadline processed fully for `active` tasks; for `not_accepted` tasks only `disputed` produces a flag and a clarification; cancelled items and questions carry no owner/deadline.
4. Speaker names accepted only from their own intro utterance; any significant speaker unnamed → `declined`.
5. Status: no kept items → `no_commitments` if the model said nothing was discussed and returned no items, else `declined`; no active task and ≥1 clarification → `needs_clarification`; else `ok`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/verify/verify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ExtractedItem, Extraction } from "@/lib/extract/schema";
import { isAbsoluteDate, verify } from "@/lib/verify/verify";
import { makeTranscript } from "../../helpers/transcript";

const t = makeTranscript([
  [0, "Hi, I'm Anna, the project manager."], // u1
  [1, "Hi, I'm Mark, the developer."], // u2
  [0, "Mark, the API docs are still missing."], // u3
  [1, "I'll write the API docs by Wednesday."], // u4
  [0, "We could also redo the landing page."], // u5
  [1, "Maybe later."], // u6
  [0, "Can you take the client report?"], // u7
  [1, "I'm not sure, maybe you could?"], // u8
  [0, "Let's drop the survey."], // u9
  [0, "Today is September 14, so the report is due on September 20."], // u10
]);

const speakers: Extraction["speakers"] = [
  { speaker: 0, name: "Anna", intro_utterance_id: "u1" },
  { speaker: 1, name: "Mark", intro_utterance_id: "u2" },
];

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    kind: "task",
    summary: "Write API docs",
    final_status: "active",
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, evidence: null, resolved_date: null, anchor_utterance_id: null },
    events: [{ type: "accepted", utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }],
    ...over,
  };
}

const run = (items: ExtractedItem[], extra: Partial<Extraction> = {}) =>
  verify(t, { speakers, no_commitments_discussed: false, items, ...extra });

describe("verify: quotes and timestamps", () => {
  it("takes evidence text and timestamps from the transcript words", () => {
    const r = run([item({})]);
    const ev = r.items[0].events[0];
    expect(ev.quote).toBe("I'll write the API docs by Wednesday.");
    expect(ev.utteranceId).toBe("u4");
    expect(ev.speakerName).toBe("Mark");
    expect(ev.start).toBe(t.utterances[3].words[0].start);
    expect(ev.end).toBe(t.utterances[3].words[6].end);
  });

  it("finds a quote cited with the wrong utterance id", () => {
    const r = run([item({ events: [{ type: "accepted", utterance_id: "u9", quote: "I'll write the API docs" }] })]);
    expect(r.items[0].events[0].utteranceId).toBe("u4");
  });

  it("drops an item whose supporting quote is fabricated", () => {
    const r = run([item({ events: [{ type: "accepted", utterance_id: "u4", quote: "Anna will do the docs by Friday" }] })]);
    expect(r.items).toHaveLength(0);
    expect(r.dropped[0].reason).toContain("accepted");
    expect(r.status).toBe("declined");
  });

  it("drops an active task supported only by a proposal", () => {
    const r = run([
      item({ summary: "Redo landing page", events: [{ type: "proposed", utterance_id: "u5", quote: "We could also redo the landing page" }] }),
    ]);
    expect(r.items).toHaveLength(0);
  });
});

describe("verify: owners", () => {
  it("keeps a self-committed owner with evidence", () => {
    const r = run([item({ owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u4", quote: "I'll write the API docs" } } })]);
    expect(r.items[0].owner).toMatchObject({ status: "agreed", name: "Mark" });
    expect(r.items[0].owner.evidence?.utteranceId).toBe("u4");
    expect(r.items[0].flags).toContain("deadline_missing");
  });

  it("rejects an owner whose evidence neither is spoken by nor names them", () => {
    const r = run([item({ owner: { status: "agreed", name: "Anna", evidence: { utterance_id: "u4", quote: "I'll write the API docs" } } })]);
    expect(r.items[0].owner).toMatchObject({ status: "none", name: null, evidence: null });
    expect(r.items[0].flags).toContain("owner_unverified");
  });

  it("accepts an owner named inside the evidence quote", () => {
    const r = run([item({ owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u3", quote: "Mark, the API docs are still missing" } } })]);
    expect(r.items[0].owner.name).toBe("Mark");
  });

  it("flags a missing owner", () => {
    expect(run([item({})]).items[0].flags).toContain("owner_missing");
  });
});

describe("verify: deadlines", () => {
  it("keeps relative wording and flags missing date context", () => {
    const r = run([item({ deadline: { status: "agreed", wording: "by Wednesday", evidence: { utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }, resolved_date: "2026-09-16", anchor_utterance_id: null } })]);
    expect(r.items[0].deadline).toMatchObject({ status: "agreed", wording: "by Wednesday", resolvedDate: null });
    expect(r.items[0].flags).toContain("date_context_missing");
  });

  it("rejects wording that is not in the evidence quote", () => {
    const r = run([item({ deadline: { status: "agreed", wording: "by Friday", evidence: { utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }, resolved_date: null, anchor_utterance_id: null } })]);
    expect(r.items[0].deadline.wording).toBeNull();
    expect(r.items[0].flags).toContain("deadline_unverified");
  });

  it("keeps a resolved date anchored in the recording", () => {
    const r = run([
      item({
        summary: "Client report",
        events: [{ type: "assigned", utterance_id: "u10", quote: "the report is due on September 20" }],
        deadline: { status: "agreed", wording: "on September 20", evidence: { utterance_id: "u10", quote: "the report is due on September 20" }, resolved_date: "2026-09-20", anchor_utterance_id: "u10" },
      }),
    ]);
    expect(r.items[0].deadline.resolvedDate).toBe("2026-09-20");
    expect(r.items[0].flags).not.toContain("date_context_missing");
  });

  it("recognizes absolute dates", () => {
    expect(isAbsoluteDate("on September 20")).toBe(true);
    expect(isAbsoluteDate("2026-09-20")).toBe(true);
    expect(isAbsoluteDate("by Wednesday")).toBe(false);
    expect(isAbsoluteDate("we may be late")).toBe(false);
  });
});

describe("verify: statuses and clarifications", () => {
  it("keeps cancelled and not-accepted items without owner flags", () => {
    const r = run([
      item({}),
      item({ summary: "Customer survey", final_status: "cancelled", events: [{ type: "cancelled", utterance_id: "u9", quote: "Let's drop the survey" }] }),
      item({ summary: "Landing page", final_status: "not_accepted", events: [{ type: "proposed", utterance_id: "u5", quote: "We could also redo the landing page" }] }),
    ]);
    expect(r.items.map((i) => i.finalStatus)).toEqual(["active", "cancelled", "not_accepted"]);
    expect(r.items[1].flags).toEqual([]);
    expect(r.items[2].flags).toEqual([]);
    expect(r.status).toBe("ok");
  });

  it("returns needs_clarification when only disputed work remains", () => {
    const r = run([
      item({
        summary: "Client report",
        final_status: "not_accepted",
        events: [{ type: "proposed", utterance_id: "u7", quote: "Can you take the client report?" }],
        owner: { status: "disputed", name: null, evidence: { utterance_id: "u8", quote: "I'm not sure, maybe you could?" } },
      }),
    ]);
    expect(r.status).toBe("needs_clarification");
    expect(r.clarifications).toHaveLength(1);
    expect(r.clarifications[0]).toMatchObject({ about: "owner", question: 'Who owns "Client report"?' });
    expect(r.clarifications[0].evidence.utteranceId).toBe("u8");
    expect(r.items[0].flags).toEqual(["owner_disputed"]);
  });

  it("turns open questions into clarifications", () => {
    const r = run([
      item({}),
      item({ kind: "open_question", summary: "Is the client report ours?", final_status: "open", events: [{ type: "question_raised", utterance_id: "u7", quote: "Can you take the client report?" }] }),
    ]);
    expect(r.status).toBe("ok");
    expect(r.clarifications.map((c) => c.about)).toEqual(["question"]);
  });

  it("drops inconsistent kind/status combinations", () => {
    const r = run([item({}), item({ summary: "Bad", final_status: "open", events: [{ type: "question_raised", utterance_id: "u7", quote: "Can you take the client report?" }] })]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped[0].reason).toContain("inconsistent");
  });

  it("declines when a speaker is not identified by their own introduction", () => {
    const r = verify(t, { speakers: [speakers[0], { speaker: 1, name: "Mark", intro_utterance_id: "u1" }], no_commitments_discussed: false, items: [item({})] });
    expect(r.status).toBe("declined");
    expect(r.declineReasons[0]).toContain("introduce");
    expect(r.items).toEqual([]);
  });

  it("reports no_commitments when nothing was discussed", () => {
    const r = run([], { no_commitments_discussed: true });
    expect(r.status).toBe("no_commitments");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/verify/verify.test.ts`
Expected: FAIL — cannot resolve `@/lib/verify/verify`.

- [ ] **Step 3: Write the implementation**

Create `lib/verify/verify.ts`:

```ts
import type { EvidenceRef, ExtractedItem, Extraction } from "@/lib/extract/schema";
import { significantSpeakers } from "@/lib/gate/precheck";
import type {
  Clarification,
  Evidence,
  EvidenceType,
  EventType,
  Flag,
  Report,
  Transcript,
  Utterance,
  VerifiedItem,
} from "@/lib/types";
import { containsPhrase, findQuoteSpan, normalize } from "@/lib/verify/text";

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ABSOLUTE_DATE = new RegExp(
  `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`,
  "i",
);

export function isAbsoluteDate(text: string): boolean {
  return ABSOLUTE_DATE.test(text);
}

const SUPPORT: Record<ExtractedItem["final_status"], EventType[]> = {
  active: ["accepted", "assigned"],
  cancelled: ["cancelled"],
  not_accepted: ["proposed"],
  open: ["question_raised", "left_open"],
};

type Locate = (ref: EvidenceRef | null, type: EvidenceType) => Evidence | null;

function makeLocator(t: Transcript, names: Map<number, string>): Locate {
  const byId = new Map(t.utterances.map((u) => [u.id, u]));
  const evidenceFrom = (u: Utterance, first: number, last: number, type: EvidenceType): Evidence => {
    const ws = u.words.slice(first, last + 1);
    return {
      type,
      quote: ws.map((w) => w.punctuated).join(" "),
      utteranceId: u.id,
      speaker: u.speaker,
      speakerName: names.get(u.speaker) ?? null,
      start: ws[0].start,
      end: ws[ws.length - 1].end,
    };
  };
  return (ref, type) => {
    if (!ref) return null;
    const preferred = byId.get(ref.utterance_id);
    const order = preferred ? [preferred, ...t.utterances.filter((u) => u !== preferred)] : t.utterances;
    for (const u of order) {
      const span = findQuoteSpan(ref.quote, u.words);
      if (span) return evidenceFrom(u, span.first, span.last, type);
    }
    return null;
  };
}

function emptyReport(status: Report["status"], declineReasons: string[] = []): Report {
  return { status, declineReasons, clarifications: [], speakers: [], items: [], dropped: [], metrics: null };
}

type Processed = { item: VerifiedItem; clarifications: Clarification[] } | { dropped: string };

function processItem(x: ExtractedItem, t: Transcript, locate: Locate): Processed {
  const consistent = (x.kind === "open_question") === (x.final_status === "open");
  if (!consistent) return { dropped: `inconsistent kind "${x.kind}" with status "${x.final_status}"` };

  const events = x.events.map((e) => locate(e, e.type)).filter((e): e is Evidence => e != null);
  const needed = SUPPORT[x.final_status];
  if (!events.some((e) => needed.includes(e.type as EventType))) {
    return { dropped: `no verified quote for a ${needed.join(" or ")} event supporting status "${x.final_status}"` };
  }

  const flags: Flag[] = [];
  const clarifications: Clarification[] = [];
  const lastEvent = events[events.length - 1];
  const verified: VerifiedItem = {
    kind: x.kind,
    summary: x.summary,
    finalStatus: x.final_status,
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
    flags,
    events,
  };

  if (x.final_status === "open") {
    clarifications.push({ about: "question", itemSummary: x.summary, question: x.summary, evidence: lastEvent });
    return { item: verified, clarifications };
  }
  if (x.final_status === "cancelled") return { item: verified, clarifications };

  const isActive = x.final_status === "active";

  // Owner
  if (x.owner.status === "disputed") {
    const ev = locate(x.owner.evidence, "owner") ?? lastEvent;
    verified.owner = { status: "disputed", name: null, evidence: ev };
    flags.push("owner_disputed");
    clarifications.push({ about: "owner", itemSummary: x.summary, question: `Who owns "${x.summary}"?`, evidence: ev });
  } else if (isActive && x.owner.status === "agreed") {
    const ev = locate(x.owner.evidence, "owner");
    const name = x.owner.name;
    const supported =
      ev != null &&
      name != null &&
      ((ev.speakerName != null && normalize(ev.speakerName) === normalize(name)) || containsPhrase(ev.quote, name));
    if (supported) verified.owner = { status: "agreed", name, evidence: ev };
    else flags.push("owner_unverified");
  } else if (isActive) {
    flags.push("owner_missing");
  }

  // Deadline
  if (x.deadline.status === "disputed") {
    const ev = locate(x.deadline.evidence, "deadline") ?? lastEvent;
    verified.deadline = { status: "disputed", wording: null, resolvedDate: null, evidence: ev };
    flags.push("deadline_disputed");
    clarifications.push({ about: "deadline", itemSummary: x.summary, question: `What is the deadline for "${x.summary}"?`, evidence: ev });
  } else if (isActive && x.deadline.status === "agreed") {
    const ev = locate(x.deadline.evidence, "deadline");
    const wording = x.deadline.wording;
    if (ev && wording && containsPhrase(ev.quote, wording)) {
      const anchor = x.deadline.anchor_utterance_id
        ? t.utterances.find((u) => u.id === x.deadline.anchor_utterance_id)
        : undefined;
      const resolvedDate = x.deadline.resolved_date && anchor && isAbsoluteDate(anchor.text) ? x.deadline.resolved_date : null;
      verified.deadline = { status: "agreed", wording, resolvedDate, evidence: ev };
      if (!resolvedDate && !isAbsoluteDate(wording)) flags.push("date_context_missing");
    } else {
      flags.push("deadline_unverified");
    }
  } else if (isActive) {
    flags.push("deadline_missing");
  }

  return { item: verified, clarifications };
}

export function verify(t: Transcript, x: Extraction): Report {
  const byId = new Map(t.utterances.map((u) => [u.id, u]));
  const extracted = new Map(x.speakers.map((s) => [s.speaker, s]));
  const names = new Map<number, string>();
  const speakers: Report["speakers"] = [];
  const unnamed: number[] = [];

  for (const sp of significantSpeakers(t)) {
    const s = extracted.get(sp);
    const u = s?.intro_utterance_id ? byId.get(s.intro_utterance_id) : undefined;
    if (s?.name && u && u.speaker === sp && containsPhrase(u.text, s.name)) {
      names.set(sp, s.name);
      speakers.push({
        speaker: sp,
        name: s.name,
        intro: { type: "intro", quote: u.text, utteranceId: u.id, speaker: sp, speakerName: s.name, start: u.start, end: u.end },
      });
    } else {
      unnamed.push(sp);
      speakers.push({ speaker: sp, name: null, intro: null });
    }
  }

  if (unnamed.length > 0) {
    return {
      ...emptyReport("declined", [
        `Speaker ${unnamed.join(", ")} never introduces themselves by name; owners cannot be attributed.`,
      ]),
      speakers,
    };
  }

  const locate = makeLocator(t, names);
  const items: VerifiedItem[] = [];
  const clarifications: Clarification[] = [];
  const dropped: Report["dropped"] = [];
  for (const raw of x.items) {
    const p = processItem(raw, t, locate);
    if ("dropped" in p) dropped.push({ summary: raw.summary, reason: p.dropped });
    else {
      items.push(p.item);
      clarifications.push(...p.clarifications);
    }
  }

  const base = { declineReasons: [], clarifications, speakers, items, dropped, metrics: null };
  if (items.length === 0) {
    if (x.no_commitments_discussed && x.items.length === 0) return { ...base, status: "no_commitments" };
    return {
      ...base,
      status: "declined",
      declineReasons: ["None of the extracted items could be verified against the transcript."],
    };
  }
  const hasActive = items.some((i) => i.kind === "task" && i.finalStatus === "active");
  if (!hasActive && clarifications.length > 0) return { ...base, status: "needs_clarification" };
  return { ...base, status: "ok" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/verify && npm run typecheck`
Expected: PASS. Fix the implementation, not the tests, if a rule misbehaves; the tests encode spec §5.

- [ ] **Step 5: Commit**

```bash
git add lib/verify/verify.ts tests/lib/verify/verify.test.ts
git commit -m "feat: deterministic verifier for quotes, owners, deadlines and statuses

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Pricing and cost computation

**Files:**
- Create: `lib/pricing.ts`, `lib/metrics.ts`
- Test: `tests/lib/metrics.test.ts`

**Interfaces:**
- Consumes: `Usage`, `CostBreakdown` (Task 1).
- Produces: `PRICING`, `emptyUsage(model: string): Usage`, `computeCost(u: Usage, p?: typeof PRICING): CostBreakdown`.

- [ ] **Step 1: Verify GCP prices before writing constants**

Open https://cloud.google.com/run/pricing and https://cloud.google.com/storage/pricing in a browser. For region `europe-west1` (Tier 1), request-based billing and Standard storage, confirm or correct these values and use the confirmed ones in Step 3: Cloud Run vCPU-second `0.000024`, GiB-second `0.0000025`, requests `0.40` per million; Cloud Storage Standard `0.020` per GB-month, Class A `0.005` per 1,000, Class B `0.0004` per 1,000, internet egress `0.12` per GB. Deepgram (Nova-3 pre-recorded `$0.0043/min`, diarization included; Aura-2 `$0.030/1k chars`) and Claude (Sonnet 5 `$2/$10`, Opus 5 `$5/$25` per MTok) were checked on 2026-09-16.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeCost, emptyUsage } from "@/lib/metrics";

describe("computeCost", () => {
  it("prices recognition and reasoning per audio minute", () => {
    const u = { ...emptyUsage("claude-sonnet-5"), audioSeconds: 120, claudeInputTokens: 10_000, claudeOutputTokens: 3_000, vcpu: 0, memoryGib: 0 };
    const c = computeCost(u);
    expect(c.recognition).toBeCloseTo(0.0086, 6);
    expect(c.reasoning).toBeCloseTo(0.05, 6);
    expect(c.speech).toBe(0);
    expect(c.total).toBeCloseTo(0.0586, 6);
    expect(c.perAudioMinute).toBeCloseTo(0.0293, 6);
  });

  it("includes storage, operations, egress and compute", () => {
    const u = {
      ...emptyUsage("claude-sonnet-5"),
      audioSeconds: 60,
      gcsClassA: 8,
      gcsClassB: 3,
      storedBytes: 1024 ** 3,
      egressBytes: 1024 ** 3,
      cloudRunRequests: 3,
      cloudRunSeconds: 20,
    };
    const c = computeCost(u);
    expect(c.storage).toBeCloseTo(0.02, 6);
    expect(c.storageOps).toBeCloseTo((8 * 0.005 + 3 * 0.0004) / 1000, 9);
    expect(c.egress).toBeCloseTo(0.12, 6);
    expect(c.compute).toBeCloseTo(20 * (0.000024 + 0.0000025) + 3 * 0.4 / 1e6, 9);
  });

  it("returns null per-minute cost when no audio was processed", () => {
    expect(computeCost(emptyUsage("claude-sonnet-5")).perAudioMinute).toBeNull();
  });

  it("fails loudly for an unpriced model", () => {
    expect(() => computeCost(emptyUsage("unknown-model"))).toThrow("No pricing");
  });
});
```

Note: if Step 1 changed any price, update the expected numbers in this test to match before running it.

- [ ] **Step 3: Write the implementation**

Create `lib/pricing.ts`:

```ts
/** List prices used for per-operation cost estimates. Free tiers and credits are ignored on purpose. */
export const PRICING = {
  checkedAt: "2026-09-16",
  deepgram: {
    nova3PerMinute: 0.0043,
    aura2Per1kChars: 0.03,
    source: "https://deepgram.com/pricing",
    note: "Pay-as-you-go, pre-recorded, English; speaker diarization and smart formatting included.",
  },
  anthropic: {
    models: {
      "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
    } as Record<string, { inputPerMTok: number; outputPerMTok: number }>,
    source: "https://docs.anthropic.com/en/docs/about-claude/pricing",
  },
  cloudRun: {
    vcpuSecond: 0.000024,
    gibSecond: 0.0000025,
    perMillionRequests: 0.4,
    source: "https://cloud.google.com/run/pricing",
    note: "europe-west1 (Tier 1), request-based billing.",
  },
  gcs: {
    standardGbMonth: 0.02,
    classAPer1000: 0.005,
    classBPer1000: 0.0004,
    egressPerGb: 0.12,
    source: "https://cloud.google.com/storage/pricing",
    note: "Standard storage, europe-west1 regional bucket, premium tier internet egress.",
  },
} as const;
```

Create `lib/metrics.ts`:

```ts
import { PRICING } from "@/lib/pricing";
import type { CostBreakdown, Usage } from "@/lib/types";

export function emptyUsage(model: string): Usage {
  return {
    audioSeconds: 0,
    claudeModel: model,
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
    claudeAttempts: 0,
    gcsClassA: 0,
    gcsClassB: 0,
    storedBytes: 0,
    retentionDays: 30,
    egressBytes: 0,
    cloudRunRequests: 0,
    cloudRunSeconds: 0,
    vcpu: 1,
    memoryGib: 1,
  };
}

const GIB = 1024 ** 3;

export function computeCost(u: Usage, p: typeof PRICING = PRICING): CostBreakdown {
  const model = p.anthropic.models[u.claudeModel];
  if (!model) throw new Error(`No pricing for model ${u.claudeModel}`);
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  const reasoning = (u.claudeInputTokens * model.inputPerMTok + u.claudeOutputTokens * model.outputPerMTok) / 1e6;
  const storage = (u.storedBytes / GIB) * p.gcs.standardGbMonth * (u.retentionDays / 30);
  const storageOps = (u.gcsClassA * p.gcs.classAPer1000 + u.gcsClassB * p.gcs.classBPer1000) / 1000;
  const egress = (u.egressBytes / GIB) * p.gcs.egressPerGb;
  const compute =
    u.cloudRunSeconds * (u.vcpu * p.cloudRun.vcpuSecond + u.memoryGib * p.cloudRun.gibSecond) +
    (u.cloudRunRequests / 1e6) * p.cloudRun.perMillionRequests;
  const total = recognition + reasoning + storage + storageOps + egress + compute;
  const minutes = u.audioSeconds / 60;
  return {
    recognition,
    reasoning,
    speech: 0,
    storage,
    storageOps,
    egress,
    compute,
    total,
    perAudioMinute: minutes > 0 ? total / minutes : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.ts lib/metrics.ts tests/lib/metrics.test.ts
git commit -m "feat: dated list prices and per-operation cost computation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Storage drivers and run log

**Files:**
- Create: `lib/store/store.ts`, `lib/store/local.ts`, `lib/store/gcs.ts`, `lib/store/index.ts`, `lib/runs/runs.ts`
- Test: `tests/lib/runs/runs.test.ts`

**Interfaces:**
- Consumes: `Run`, `RunEvent`, `Stage`, `UploadTarget` (Task 1); `LIMITS` (Task 1); `emptyUsage` (Task 7).
- Produces:
  - `interface ObjectStore { put(key, data: Uint8Array | string, contentType): Promise<void>; get(key): Promise<Uint8Array | null>; listDirs(prefix): Promise<string[]>; deletePrefix(prefix): Promise<void>; uploadTarget(key, contentType, maxBytes): Promise<UploadTarget>; downloadUrl(key): Promise<string | null> }`
  - `class LocalStore implements ObjectStore` (constructor `(root = process.env.LOCAL_STORE_DIR ?? ".data")`)
  - `class GcsStore implements ObjectStore` (constructor `(bucketName = process.env.GCS_BUCKET)`)
  - `getStore(): ObjectStore`
  - `RUN_ID_RE`, `newRunId(now?: Date, random?: () => number): string`
  - `addEvent(run, stage, type, detail, durationMs?): void`
  - `class Runs` with `audioKey(id)`, `create(file, model)`, `get(id)`, `save(run, opts?)`, `putJson(run, name, value, opts?)`, `getJson<T>(id, name)`, `getAudio(run)`, `list(limit?)`, `delete(id)`, `audioDownloadUrl(id)`
  - `type JsonName = "transcript.json" | "report.json" | "raw/deepgram.json" | "raw/claude.json"`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/runs/runs.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStore } from "@/lib/store/local";
import { addEvent, newRunId, RUN_ID_RE, Runs } from "@/lib/runs/runs";

let root: string;
let runs: Runs;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "runs-"));
  runs = new Runs(new LocalStore(root));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("newRunId", () => {
  it("is sortable by time and matches the id pattern", () => {
    const id = newRunId(new Date("2026-09-16T13:25:01.123Z"), () => 0);
    expect(id).toBe("20260916T132501Z-aaaaaa");
    expect(RUN_ID_RE.test(id)).toBe(true);
  });
});

describe("Runs", () => {
  it("creates a run with an upload target and persists run.json", async () => {
    const { run, upload } = await runs.create({ name: "meeting.mp3", sizeBytes: 2048, declaredType: "audio/mpeg" }, "claude-sonnet-5");
    expect(upload).toEqual({ url: `/api/runs/${run.id}/upload`, method: "PUT", headers: {} });
    const loaded = await runs.get(run.id);
    expect(loaded?.status).toBe("created");
    expect(loaded?.events[0]).toMatchObject({ stage: "upload", type: "started" });
    expect(loaded?.usage.gcsClassA).toBe(1);
  });

  it("appends events and stores JSON documents", async () => {
    const { run } = await runs.create({ name: "a.mp3", sizeBytes: 2048, declaredType: "" }, "claude-sonnet-5");
    addEvent(run, "file-check", "rejected", "contains_video", 12.4);
    await runs.putJson(run, "transcript.json", { hello: "world" });
    await runs.save(run);
    const loaded = await runs.get(run.id);
    expect(loaded?.events.at(-1)).toMatchObject({ stage: "file-check", type: "rejected", detail: "contains_video", durationMs: 12 });
    expect(await runs.getJson(run.id, "transcript.json")).toEqual({ hello: "world" });
    expect(loaded?.usage.storedBytes).toBe(JSON.stringify({ hello: "world" }).length);
  });

  it("lists newest first and deletes all objects of a run", async () => {
    const a = await runs.create({ name: "a.mp3", sizeBytes: 2048, declaredType: "" }, "claude-sonnet-5");
    await new Promise((r) => setTimeout(r, 1100));
    const b = await runs.create({ name: "b.mp3", sizeBytes: 2048, declaredType: "" }, "claude-sonnet-5");
    expect((await runs.list()).map((r) => r.file.name)).toEqual(["b.mp3", "a.mp3"]);
    expect(await runs.delete(a.run.id)).toBe(true);
    expect(await runs.get(a.run.id)).toBeNull();
    expect((await runs.list()).map((r) => r.id)).toEqual([b.run.id]);
  });

  it("rejects ids that could escape the runs prefix", async () => {
    expect(await runs.get("../../etc")).toBeNull();
    expect(await runs.delete("..")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/runs/runs.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the storage interface and drivers**

Create `lib/store/store.ts`:

```ts
import type { UploadTarget } from "@/lib/types";

export interface ObjectStore {
  put(key: string, data: Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Names of direct child "directories" under a prefix ending in "/". */
  listDirs(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget>;
  /** A URL the browser can GET, or null when the app must serve the bytes itself. */
  downloadUrl(key: string): Promise<string | null>;
}
```

Create `lib/store/local.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

function isNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}

export class LocalStore implements ObjectStore {
  constructor(private root: string = process.env.LOCAL_STORE_DIR ?? ".data") {}

  private file(key: string): string {
    return path.join(this.root, ...key.replace(/\/$/, "").split("/"));
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    await fs.mkdir(path.dirname(this.file(key)), { recursive: true });
    await fs.writeFile(this.file(key), data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.file(key)));
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async listDirs(prefix: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.file(prefix), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fs.rm(this.file(prefix), { recursive: true, force: true });
  }

  async uploadTarget(key: string): Promise<UploadTarget> {
    const id = key.split("/")[1];
    return { url: `/api/runs/${id}/upload`, method: "PUT", headers: {} };
  }

  async downloadUrl(): Promise<string | null> {
    return null;
  }
}
```

Create `lib/store/gcs.ts`:

```ts
import { Storage, type Bucket } from "@google-cloud/storage";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

const URL_TTL_MS = 15 * 60 * 1000;

export class GcsStore implements ObjectStore {
  private bucket: Bucket;

  constructor(bucketName: string | undefined = process.env.GCS_BUCKET) {
    if (!bucketName) throw new Error("GCS_BUCKET is not set");
    this.bucket = new Storage().bucket(bucketName);
  }

  async put(key: string, data: Uint8Array | string, contentType: string): Promise<void> {
    await this.bucket.file(key).save(typeof data === "string" ? data : Buffer.from(data), { contentType, resumable: false });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const [buf] = await this.bucket.file(key).download();
      return new Uint8Array(buf);
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }

  async listDirs(prefix: string): Promise<string[]> {
    const [, , response] = await this.bucket.getFiles({ prefix, delimiter: "/", autoPaginate: false, maxResults: 1000 });
    const prefixes = (response as { prefixes?: string[] } | undefined)?.prefixes ?? [];
    return prefixes.map((p) => p.slice(prefix.length).replace(/\/$/, ""));
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.bucket.deleteFiles({ prefix });
  }

  async uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget> {
    const range = `0,${maxBytes}`;
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + URL_TTL_MS,
      contentType,
      extensionHeaders: { "x-goog-content-length-range": range },
    });
    return { url, method: "PUT", headers: { "Content-Type": contentType, "x-goog-content-length-range": range } };
  }

  async downloadUrl(key: string): Promise<string | null> {
    const [url] = await this.bucket.file(key).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + URL_TTL_MS });
    return url;
  }
}
```

Create `lib/store/index.ts`:

```ts
import { GcsStore } from "@/lib/store/gcs";
import { LocalStore } from "@/lib/store/local";
import type { ObjectStore } from "@/lib/store/store";

let cached: ObjectStore | null = null;

export function getStore(): ObjectStore {
  if (!cached) cached = process.env.STORE_DRIVER === "gcs" ? new GcsStore() : new LocalStore();
  return cached;
}
```

- [ ] **Step 4: Write the run log**

Create `lib/runs/runs.ts`:

```ts
import { LIMITS } from "@/lib/limits";
import { emptyUsage } from "@/lib/metrics";
import { getStore } from "@/lib/store";
import type { ObjectStore } from "@/lib/store/store";
import type { Run, RunEvent, Stage, UploadTarget } from "@/lib/types";

export const RUN_ID_RE = /^\d{8}T\d{6}Z-[a-z0-9]{6}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newRunId(now: Date = new Date(), random: () => number = Math.random): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = Array.from({ length: 6 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  return `${ts}-${suffix}`;
}

export function addEvent(run: Run, stage: Stage, type: RunEvent["type"], detail: string, durationMs?: number): void {
  run.events.push({
    at: new Date().toISOString(),
    stage,
    type,
    detail,
    ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}),
  });
}

export type JsonName = "transcript.json" | "report.json" | "raw/deepgram.json" | "raw/claude.json";
type WriteOpts = { counted?: boolean };

const decode = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

export class Runs {
  constructor(private store: ObjectStore = getStore()) {}

  audioKey(id: string): string {
    return `runs/${id}/audio`;
  }

  async create(file: { name: string; sizeBytes: number; declaredType: string }, model: string): Promise<{ run: Run; upload: UploadTarget }> {
    const t0 = Date.now();
    const run: Run = {
      id: newRunId(),
      createdAt: new Date().toISOString(),
      file: { ...file, detectedFormat: null, mime: null, durationSec: null, hasVideo: null },
      status: "created",
      failedStage: null,
      rejection: null,
      reportStatus: null,
      events: [],
      stageMs: {},
      usage: emptyUsage(model),
      timeToResultMs: null,
      cost: null,
    };
    addEvent(run, "upload", "started", `Upload URL issued for ${file.name} (${file.sizeBytes} bytes)`);
    const upload = await this.store.uploadTarget(this.audioKey(run.id), "application/octet-stream", LIMITS.maxBytes);
    run.usage.cloudRunRequests += 1;
    run.usage.cloudRunSeconds += (Date.now() - t0) / 1000;
    await this.save(run);
    return { run, upload };
  }

  async get(id: string): Promise<Run | null> {
    if (!RUN_ID_RE.test(id)) return null;
    const bytes = await this.store.get(`runs/${id}/run.json`);
    if (!bytes) return null;
    const run = decode(bytes) as Run;
    run.usage.gcsClassB += 1;
    return run;
  }

  async save(run: Run, opts: WriteOpts = {}): Promise<void> {
    if (opts.counted !== false) run.usage.gcsClassA += 1;
    await this.store.put(`runs/${run.id}/run.json`, JSON.stringify(run, null, 2), "application/json");
  }

  async putJson(run: Run, name: JsonName, value: unknown, opts: WriteOpts = {}): Promise<void> {
    const body = JSON.stringify(value);
    if (opts.counted !== false) {
      run.usage.gcsClassA += 1;
      run.usage.storedBytes += Buffer.byteLength(body);
    }
    await this.store.put(`runs/${run.id}/${name}`, body, "application/json");
  }

  async getJson<T>(id: string, name: JsonName): Promise<T | null> {
    if (!RUN_ID_RE.test(id)) return null;
    const bytes = await this.store.get(`runs/${id}/${name}`);
    return bytes ? (decode(bytes) as T) : null;
  }

  async getAudio(run: Run): Promise<Uint8Array | null> {
    run.usage.gcsClassB += 1;
    return this.store.get(this.audioKey(run.id));
  }

  async list(limit = 50): Promise<Run[]> {
    const ids = (await this.store.listDirs("runs/"))
      .filter((id) => RUN_ID_RE.test(id))
      .sort()
      .reverse()
      .slice(0, limit);
    const loaded = await Promise.all(ids.map((id) => this.store.get(`runs/${id}/run.json`)));
    return loaded.filter((b): b is Uint8Array => b != null).map((b) => decode(b) as Run);
  }

  async delete(id: string): Promise<boolean> {
    if (!RUN_ID_RE.test(id)) return false;
    await this.store.deletePrefix(`runs/${id}/`);
    return true;
  }

  audioDownloadUrl(id: string): Promise<string | null> {
    return this.store.downloadUrl(this.audioKey(id));
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/lib/runs/runs.test.ts && npm run typecheck`
Expected: PASS. (`GcsStore` is exercised by the deploy smoke test in Task 14.)

- [ ] **Step 6: Commit**

```bash
git add lib/store lib/runs/runs.ts tests/lib/runs/runs.test.ts
git commit -m "feat: storage drivers (local, Cloud Storage) and persisted run log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Pipeline, stage orchestration and API routes

**Files:**
- Create: `lib/pipeline.ts`, `lib/runs/stages.ts`
- Create: `app/api/health/route.ts`, `app/api/runs/route.ts`, `app/api/runs/[id]/route.ts`, `app/api/runs/[id]/upload/route.ts`, `app/api/runs/[id]/transcribe/route.ts`, `app/api/runs/[id]/extract/route.ts`, `app/api/runs/[id]/audio/route.ts`
- Test: `tests/lib/runs/stages.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–8.
- Produces:
  - `class StageError extends Error { stage: Stage; attempts: ClaudeAttempt[] }`
  - `type OnEvent = (stage: Stage, type: RunEvent["type"], detail: string, ms?: number) => void`
  - `type TranscribeOutcome = { kind: "rejected"; check: FileCheckFail; ms } | { kind: "declined"; check: FileCheckOk; transcript; raw; reasons: string[]; ms } | { kind: "transcribed"; check: FileCheckOk; transcript; raw; ms }` where `ms: Partial<Record<Stage, number>>`
  - `runTranscribe(bytes, onEvent?): Promise<TranscribeOutcome>`
  - `runExtract(transcript, onEvent?, client?): Promise<{ report: Report; attempts: ClaudeAttempt[]; ms: Partial<Record<Stage, number>> }>`
  - `declinedReport(reasons: string[]): Report`
  - `processAudio(bytes): Promise<{ report: Report; transcript: Transcript | null; stageMs; usage: Usage }>` (eval; no storage)
  - `stageTranscribe(runs: Runs, run: Run): Promise<Run>`
  - `stageExtract(runs: Runs, run: Run): Promise<{ run: Run; report: Report | null }>`
  - `class ConflictError extends Error`
  - HTTP: `POST /api/runs` `{fileName, sizeBytes, declaredType}` → `{runId, upload}`; `GET /api/runs` → `{runs}`; `GET /api/runs/:id[?raw=1]` → `{run, report, transcript, raw?}`; `DELETE /api/runs/:id` → `{ok}`; `PUT /api/runs/:id/upload` (local); `POST /api/runs/:id/transcribe` → `{run}`; `POST /api/runs/:id/extract` → `{run, report}`; `GET /api/runs/:id/audio` → bytes or 302; `GET /api/health` → `{ok, store}`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/runs/stages.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([
  [0, "Hi, I'm Anna, the project manager for this launch."],
  [1, "Hi, I'm Mark, the developer on the team."],
  [1, "I'll write the API docs by Wednesday."],
]);

vi.mock("@/lib/stt/deepgram", () => ({
  transcribeBytes: vi.fn(async () => ({ transcript, raw: { mocked: true } })),
}));

const extraction: Extraction = {
  speakers: [
    { speaker: 0, name: "Anna", intro_utterance_id: "u1" },
    { speaker: 1, name: "Mark", intro_utterance_id: "u2" },
  ],
  no_commitments_discussed: false,
  items: [
    {
      kind: "task",
      summary: "Write API docs",
      final_status: "active",
      owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u3", quote: "I'll write the API docs" } },
      deadline: { status: "agreed", wording: "by Wednesday", evidence: { utterance_id: "u3", quote: "I'll write the API docs by Wednesday" }, resolved_date: null, anchor_utterance_id: null },
      events: [{ type: "accepted", utterance_id: "u3", quote: "I'll write the API docs by Wednesday" }],
    },
  ],
};

vi.mock("@/lib/extract/claude", () => ({
  EXTRACT_MODEL: "claude-sonnet-5",
  ExtractionError: class extends Error {},
  extractCommitments: vi.fn(async () => ({
    extraction,
    attempts: [{ ok: true, stopReason: "end_turn", inputTokens: 1200, outputTokens: 400, raw: {} }],
  })),
}));

const { LocalStore } = await import("@/lib/store/local");
const { Runs } = await import("@/lib/runs/runs");
const { stageExtract, stageTranscribe } = await import("@/lib/runs/stages");

let root: string;
let runs: InstanceType<typeof Runs>;
let store: InstanceType<typeof LocalStore>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stages-"));
  store = new LocalStore(root);
  runs = new Runs(store);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function uploaded(fixture: string) {
  const bytes = new Uint8Array(readFileSync(path.join("testset", "invalid", fixture)));
  const { run } = await runs.create({ name: fixture, sizeBytes: bytes.byteLength, declaredType: "audio/mpeg" }, "claude-sonnet-5");
  await store.put(runs.audioKey(run.id), bytes, "application/octet-stream");
  return run;
}

describe("stages", () => {
  it("rejects a renamed video without calling Deepgram and keeps it in history", async () => {
    const run = await uploaded("video-renamed.mp3");
    const after = await stageTranscribe(runs, run);
    expect(after.status).toBe("rejected");
    expect(after.rejection?.code).toBe("contains_video");
    expect(after.cost?.recognition).toBe(0);
    const { transcribeBytes } = await import("@/lib/stt/deepgram");
    expect(transcribeBytes).not.toHaveBeenCalled();
    expect((await runs.list())[0].status).toBe("rejected");
  });

  it("runs transcribe then extract and stores transcript, report and metrics", async () => {
    const run = await uploaded("wav-renamed.mp3");
    const transcribed = await stageTranscribe(runs, run);
    expect(transcribed.status).toBe("transcribed");
    const { run: done, report } = await stageExtract(runs, transcribed);
    expect(done.status).toBe("done");
    expect(done.reportStatus).toBe("ok");
    expect(report?.items[0].owner.name).toBe("Mark");
    expect(report?.metrics?.usage.claudeInputTokens).toBe(1200);
    expect(report?.metrics?.cost.total).toBeGreaterThan(0);
    expect(done.events.map((e) => `${e.stage}:${e.type}`)).toEqual([
      "upload:started", "upload:finished", "file-check:started", "file-check:finished",
      "transcribe:started", "transcribe:finished", "precheck:finished",
      "extract:started", "extract:finished", "verify:finished",
    ]);
    expect(await runs.getJson(done.id, "report.json")).toMatchObject({ status: "ok" });
    const again = await stageExtract(runs, done);
    expect(again.report?.status).toBe("ok");
  });

  it("marks a run failed when the upload never arrived", async () => {
    const { run } = await runs.create({ name: "x.mp3", sizeBytes: 5000, declaredType: "" }, "claude-sonnet-5");
    const after = await stageTranscribe(runs, run);
    expect(after).toMatchObject({ status: "failed", failedStage: "upload" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/runs/stages.test.ts`
Expected: FAIL — cannot resolve `@/lib/runs/stages`.

- [ ] **Step 3: Write the pipeline**

Create `lib/pipeline.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { EXTRACT_MODEL, ExtractionError, extractCommitments, type ClaudeAttempt } from "@/lib/extract/claude";
import { checkAudioFile, type FileCheckFail, type FileCheckOk } from "@/lib/gate/file-check";
import { precheck } from "@/lib/gate/precheck";
import { emptyUsage } from "@/lib/metrics";
import { transcribeBytes, type DeepgramResponse } from "@/lib/stt/deepgram";
import type { Report, RunEvent, Stage, Transcript, Usage } from "@/lib/types";
import { verify } from "@/lib/verify/verify";

export type StageMs = Partial<Record<Stage, number>>;
export type OnEvent = (stage: Stage, type: RunEvent["type"], detail: string, ms?: number) => void;
const noop: OnEvent = () => {};

export class StageError extends Error {
  constructor(public stage: Stage, message: string, public attempts: ClaudeAttempt[] = []) {
    super(message);
    this.name = "StageError";
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type TranscribeOutcome =
  | { kind: "rejected"; check: FileCheckFail; ms: StageMs }
  | { kind: "declined"; check: FileCheckOk; transcript: Transcript; raw: DeepgramResponse; reasons: string[]; ms: StageMs }
  | { kind: "transcribed"; check: FileCheckOk; transcript: Transcript; raw: DeepgramResponse; ms: StageMs };

export function declinedReport(reasons: string[]): Report {
  return { status: "declined", declineReasons: reasons, clarifications: [], speakers: [], items: [], dropped: [], metrics: null };
}

export async function runTranscribe(bytes: Uint8Array, onEvent: OnEvent = noop): Promise<TranscribeOutcome> {
  const ms: StageMs = {};
  onEvent("file-check", "started", `${bytes.byteLength} bytes`);
  let t = performance.now();
  const check = await checkAudioFile(bytes);
  ms["file-check"] = performance.now() - t;
  if (!check.ok) {
    onEvent("file-check", "rejected", `${check.code}: ${check.message}`, ms["file-check"]);
    return { kind: "rejected", check, ms };
  }
  onEvent("file-check", "finished", `${check.detectedFormat}, ${check.durationSec?.toFixed(1) ?? "unknown"} s, audio only`, ms["file-check"]);

  onEvent("transcribe", "started", "Deepgram nova-3");
  t = performance.now();
  let transcript: Transcript;
  let raw: DeepgramResponse;
  try {
    ({ transcript, raw } = await transcribeBytes(bytes, check.mime));
  } catch (e) {
    throw new StageError("transcribe", errMsg(e));
  }
  ms.transcribe = performance.now() - t;
  onEvent("transcribe", "finished", `${transcript.utterances.length} utterances, ${transcript.durationSec.toFixed(1)} s`, ms.transcribe);

  t = performance.now();
  const reasons = precheck(transcript);
  ms.precheck = performance.now() - t;
  if (reasons.length) {
    onEvent("precheck", "rejected", reasons.join(" "), ms.precheck);
    return { kind: "declined", check, transcript, raw, reasons, ms };
  }
  onEvent("precheck", "finished", "2 speakers, enough speech", ms.precheck);
  return { kind: "transcribed", check, transcript, raw, ms };
}

export async function runExtract(
  transcript: Transcript,
  onEvent: OnEvent = noop,
  client?: Anthropic,
): Promise<{ report: Report; attempts: ClaudeAttempt[]; ms: StageMs }> {
  const ms: StageMs = {};
  onEvent("extract", "started", `Model ${EXTRACT_MODEL}`);
  let t = performance.now();
  let result: Awaited<ReturnType<typeof extractCommitments>>;
  try {
    result = await extractCommitments(transcript, client);
  } catch (e) {
    const attempts = e instanceof ExtractionError ? e.attempts : [];
    attempts.forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.stopReason}`));
    throw new StageError("extract", errMsg(e), attempts);
  }
  result.attempts
    .filter((a) => !a.ok)
    .forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.stopReason}`));
  ms.extract = performance.now() - t;
  onEvent("extract", "finished", `${result.extraction.items.length} items proposed by the model`, ms.extract);

  t = performance.now();
  const report = verify(transcript, result.extraction);
  ms.verify = performance.now() - t;
  onEvent("verify", "finished", `${report.items.length} items kept, ${report.dropped.length} dropped; status ${report.status}`, ms.verify);
  return { report, attempts: result.attempts, ms };
}

function addAttempts(usage: Usage, attempts: ClaudeAttempt[]) {
  for (const a of attempts) {
    usage.claudeInputTokens += a.inputTokens;
    usage.claudeOutputTokens += a.outputTokens;
    usage.claudeAttempts += 1;
  }
}

/** Eval path: same processing as the app, no storage; usage covers API calls only. */
export async function processAudio(bytes: Uint8Array): Promise<{ report: Report; transcript: Transcript | null; stageMs: StageMs; usage: Usage }> {
  const usage: Usage = { ...emptyUsage(EXTRACT_MODEL), retentionDays: 0, vcpu: 0, memoryGib: 0 };
  const tr = await runTranscribe(bytes);
  if (tr.kind === "rejected") return { report: declinedReport([tr.check.message]), transcript: null, stageMs: tr.ms, usage };
  usage.audioSeconds = tr.transcript.durationSec;
  if (tr.kind === "declined") return { report: declinedReport(tr.reasons), transcript: tr.transcript, stageMs: tr.ms, usage };
  try {
    const ex = await runExtract(tr.transcript);
    addAttempts(usage, ex.attempts);
    return { report: ex.report, transcript: tr.transcript, stageMs: { ...tr.ms, ...ex.ms }, usage };
  } catch (e) {
    if (e instanceof StageError) addAttempts(usage, e.attempts);
    throw e;
  }
}

export { addAttempts };
```

- [ ] **Step 4: Write stage orchestration**

Create `lib/runs/stages.ts`:

```ts
import { computeCost } from "@/lib/metrics";
import { addAttempts, declinedReport, runExtract, runTranscribe, StageError, type OnEvent } from "@/lib/pipeline";
import { addEvent, type Runs } from "@/lib/runs/runs";
import type { Metrics, Report, Run, Transcript } from "@/lib/types";

export class ConflictError extends Error {}

function accountRequest(run: Run, startedAt: number) {
  run.usage.cloudRunRequests += 1;
  run.usage.cloudRunSeconds += (Date.now() - startedAt) / 1000;
}

/** Final accounting. `pendingWrites` are the uncounted report.json/run.json writes that follow. */
function finalizeRun(run: Run, startedAt: number, pendingWrites: number): Metrics {
  accountRequest(run, startedAt);
  run.usage.gcsClassA += pendingWrites;
  run.timeToResultMs = Date.now() - Date.parse(run.createdAt);
  run.cost = computeCost(run.usage);
  return { stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost };
}

const logTo = (run: Run): OnEvent => (stage, type, detail, ms) => addEvent(run, stage, type, detail, ms);

export async function stageTranscribe(runs: Runs, run: Run): Promise<Run> {
  const allowed = run.status === "created" || (run.status === "failed" && (run.failedStage === "upload" || run.failedStage === "transcribe"));
  if (!allowed) return run;
  const startedAt = Date.now();

  const bytes = await runs.getAudio(run);
  if (!bytes) {
    addEvent(run, "upload", "failed", "Audio file not found in storage; the upload did not complete");
    run.status = "failed";
    run.failedStage = "upload";
    accountRequest(run, startedAt);
    await runs.save(run);
    return run;
  }
  if (!run.events.some((e) => e.stage === "upload" && e.type === "finished")) {
    run.usage.gcsClassA += 1; // the browser's PUT
    run.usage.storedBytes += bytes.byteLength;
    run.usage.egressBytes += bytes.byteLength; // assumption: the recording is played back once
    addEvent(run, "upload", "finished", `Received ${bytes.byteLength} bytes`);
  }

  run.status = "transcribing";
  run.failedStage = null;
  try {
    const outcome = await runTranscribe(bytes, logTo(run));
    Object.assign(run.stageMs, outcome.ms);
    run.file.detectedFormat = outcome.check.detectedFormat;
    run.file.mime = outcome.check.mime;
    run.file.durationSec = outcome.check.durationSec;
    run.file.hasVideo = outcome.check.hasVideo;

    if (outcome.kind === "rejected") {
      run.status = "rejected";
      run.rejection = { code: outcome.check.code, message: outcome.check.message };
      finalizeRun(run, startedAt, 1);
      await runs.save(run, { counted: false });
      return run;
    }

    run.usage.audioSeconds = outcome.transcript.durationSec;
    await runs.putJson(run, "transcript.json", outcome.transcript);
    await runs.putJson(run, "raw/deepgram.json", outcome.raw);

    if (outcome.kind === "declined") {
      run.status = "done";
      run.reportStatus = "declined";
      const metrics = finalizeRun(run, startedAt, 2);
      await runs.putJson(run, "report.json", { ...declinedReport(outcome.reasons), metrics }, { counted: false });
      await runs.save(run, { counted: false });
      return run;
    }

    run.status = "transcribed";
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "transcribe";
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
  }
  accountRequest(run, startedAt);
  await runs.save(run);
  return run;
}

export async function stageExtract(runs: Runs, run: Run): Promise<{ run: Run; report: Report | null }> {
  if (run.status === "done") return { run, report: await runs.getJson<Report>(run.id, "report.json") };
  const allowed = run.status === "transcribed" || (run.status === "failed" && (run.failedStage === "extract" || run.failedStage === "verify"));
  if (!allowed) throw new ConflictError(`Run is "${run.status}"; transcribe it first`);
  const startedAt = Date.now();

  const transcript = await runs.getJson<Transcript>(run.id, "transcript.json");
  run.usage.gcsClassB += 1;
  if (!transcript) throw new ConflictError("Transcript not found for this run");

  run.status = "extracting";
  run.failedStage = null;
  try {
    const out = await runExtract(transcript, logTo(run));
    addAttempts(run.usage, out.attempts);
    Object.assign(run.stageMs, out.ms);
    await runs.putJson(run, "raw/claude.json", out.attempts.map((a) => a.raw));
    run.status = "done";
    run.reportStatus = out.report.status;
    const metrics = finalizeRun(run, startedAt, 2);
    const report: Report = { ...out.report, metrics };
    await runs.putJson(run, "report.json", report, { counted: false });
    await runs.save(run, { counted: false });
    return { run, report };
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "extract";
    if (e instanceof StageError && e.attempts.length) {
      addAttempts(run.usage, e.attempts);
      await runs.putJson(run, "raw/claude.json", e.attempts.map((a) => a.raw ?? { error: a.error }));
    }
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
    accountRequest(run, startedAt);
    await runs.save(run);
    return { run, report: null };
  }
}
```

Note: in the rejected branch the run still has status `transcribing` set before `runTranscribe`; it is overwritten with `rejected` before saving.

- [ ] **Step 5: Run stage tests**

Run: `npx vitest run tests/lib/runs/stages.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Write the API routes**

Create `app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, store: process.env.STORE_DRIVER ?? "local" });
}
```

Create `app/api/runs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { EXTRACT_MODEL } from "@/lib/extract/claude";
import { checkSize } from "@/lib/gate/classify";
import { rejectionMessage } from "@/lib/limits";
import { Runs } from "@/lib/runs/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { fileName?: unknown; sizeBytes?: unknown; declaredType?: unknown } | null;
  if (!body || typeof body.fileName !== "string" || typeof body.sizeBytes !== "number") {
    return NextResponse.json({ error: "fileName and sizeBytes are required" }, { status: 400 });
  }
  const code = checkSize(body.sizeBytes);
  if (code) return NextResponse.json({ error: rejectionMessage(code), code }, { status: 400 });
  const { run, upload } = await new Runs().create(
    {
      name: body.fileName.slice(0, 200),
      sizeBytes: body.sizeBytes,
      declaredType: typeof body.declaredType === "string" ? body.declaredType.slice(0, 100) : "",
    },
    EXTRACT_MODEL,
  );
  return NextResponse.json({ runId: run.id, upload });
}

export async function GET() {
  return NextResponse.json({ runs: await new Runs().list(50) });
}
```

Create `app/api/runs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Runs } from "@/lib/runs/runs";
import type { Report, Transcript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const [report, transcript] = await Promise.all([
    runs.getJson<Report>(id, "report.json"),
    runs.getJson<Transcript>(id, "transcript.json"),
  ]);
  const wantRaw = new URL(req.url).searchParams.get("raw") === "1";
  const raw = wantRaw
    ? { deepgram: await runs.getJson(id, "raw/deepgram.json"), claude: await runs.getJson(id, "raw/claude.json") }
    : undefined;
  return NextResponse.json({ run, report, transcript, raw });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await new Runs().delete(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
```

Create `app/api/runs/[id]/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/limits";
import { Runs } from "@/lib/runs/runs";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.STORE_DRIVER === "gcs") return NextResponse.json({ error: "Not available" }, { status: 404 });
  const { id } = await params;
  const runs = new Runs();
  if (!(await runs.get(id))) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > LIMITS.maxBytes) return NextResponse.json({ error: "File too large" }, { status: 413 });
  await getStore().put(runs.audioKey(id), bytes, "application/octet-stream");
  return NextResponse.json({ ok: true });
}
```

Create `app/api/runs/[id]/transcribe/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Runs } from "@/lib/runs/runs";
import { stageTranscribe } from "@/lib/runs/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run: await stageTranscribe(runs, run) });
}
```

Create `app/api/runs/[id]/extract/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Runs } from "@/lib/runs/runs";
import { ConflictError, stageExtract } from "@/lib/runs/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    return NextResponse.json(await stageExtract(runs, run));
  } catch (e) {
    if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
```

Create `app/api/runs/[id]/audio/route.ts`:

```ts
import { NextResponse } from "next/server";
import { toArrayBuffer } from "@/lib/bytes";
import { Runs } from "@/lib/runs/runs";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = new Runs();
  const run = await runs.get(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const url = await runs.audioDownloadUrl(id);
  if (url) return NextResponse.redirect(url, 302);
  const bytes = await getStore().get(runs.audioKey(id));
  if (!bytes) return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  return new NextResponse(toArrayBuffer(bytes), {
    headers: { "Content-Type": run.file.mime ?? "application/octet-stream", "Content-Length": String(bytes.byteLength) },
  });
}
```

- [ ] **Step 7: Manual API check with the local driver (requires both API keys in `.env.local`)**

Run `npm run dev` in one terminal, then in another:

```bash
ID=$(curl -s -X POST localhost:3000/api/runs -H 'Content-Type: application/json' -d '{"fileName":"video-renamed.mp3","sizeBytes":60000,"declaredType":"audio/mpeg"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).runId')
curl -s -X PUT --data-binary @testset/invalid/video-renamed.mp3 localhost:3000/api/runs/$ID/upload
curl -s -X POST localhost:3000/api/runs/$ID/transcribe | node -pe 'JSON.parse(require("fs").readFileSync(0)).run.rejection'
curl -s localhost:3000/api/runs | node -pe 'JSON.parse(require("fs").readFileSync(0)).runs.length'
```

Expected: rejection `{ code: 'contains_video', … }`; list length ≥ 1; `.data/runs/<id>/run.json` exists.

- [ ] **Step 8: Run all tests, typecheck, lint, build and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

```bash
git add lib/pipeline.ts lib/runs/stages.ts app/api tests/lib/runs/stages.test.ts
git commit -m "feat: staged processing pipeline with persisted runs and HTTP API

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: Main page — upload, progress, report with playable evidence

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (replace scaffold content); delete `app/page.module.css` if scaffolded
- Create: `app/components/api.ts`, `app/components/clientFileCheck.ts`, `app/components/useSegmentPlayer.ts`, `app/components/EvidenceLine.tsx`, `app/components/ReportView.tsx`, `app/components/MetricsView.tsx`, `app/components/TranscriptView.tsx`, `app/components/Uploader.tsx`

**Interfaces:**
- Consumes: types (Task 1), `checkSize`/`checkContainer`/`checkDuration` (Task 3), `LIMITS`/`rejectionMessage` (Task 1), format helpers (Task 1), HTTP API (Task 9).
- Produces (used by Task 11):
  - `api<T>(url: string, init?: RequestInit): Promise<T>` (throws `Error(body.error ?? status)`)
  - `useSegmentPlayer(): { audioRef: React.RefObject<HTMLAudioElement | null>; playSegment(start: number, end: number): void }`
  - `<EvidenceLine ev onPlay label? />`, `<ReportView report onPlay />`, `<MetricsView metrics />` (`metrics: { stageMs; timeToResultMs; usage; cost: CostBreakdown | null }`), `<TranscriptView transcript onPlay />`
  - `type RunDetail = { run: Run; report: Report | null; transcript: Transcript | null; raw?: { deepgram: unknown; claude: unknown } }`

UI is verified manually in the browser (Step 6); logic that can break silently lives in the tested `lib/` modules.

- [ ] **Step 1: Layout and styles**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Commitments from recordings",
  description: "Final tasks, owners, deadlines and open questions with timestamped evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Commitments</Link>
          <nav>
            <Link href="/">New upload</Link>
            <Link href="/history">History</Link>
          </nav>
        </header>
        <p className="notice">Uploads are visible to everyone who opens this demo and are deleted after 30 days.</p>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

Replace `app/globals.css`:

```css
:root {
  --bg: #f7f7f5; --fg: #1d1d1b; --muted: #6b6b66; --line: #deded8; --card: #ffffff;
  --accent: #2458d6; --ok: #1f7a3f; --warn: #9a6200; --warn-bg: #fff4dc; --bad: #b3261e; --bad-bg: #fde8e6;
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
main { max-width: 920px; margin: 0 auto; padding: 16px 16px 64px; }
a { color: var(--accent); }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--card); }
.topbar nav { display: flex; gap: 16px; }
.brand { font-weight: 700; text-decoration: none; color: var(--fg); }
.notice { margin: 0; padding: 6px 16px; font-size: 13px; color: var(--muted); background: #efefea; text-align: center; }
h1 { font-size: 24px; margin: 16px 0 8px; } h2 { font-size: 20px; margin: 24px 0 8px; } h3 { font-size: 16px; margin: 20px 0 8px; }
.muted { color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 8px 0; }
.drop { border: 2px dashed var(--line); border-radius: 10px; padding: 28px; text-align: center; background: var(--card); }
.drop.over { border-color: var(--accent); }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: .5; cursor: default; }
.play { padding: 1px 8px; font-variant-numeric: tabular-nums; margin-right: 6px; }
.evidence { margin: 4px 0; }
.speaker { font-weight: 600; }
.tag { display: inline-block; font-size: 12px; padding: 0 6px; margin-right: 6px; border-radius: 4px; background: #eceff8; color: #33415c; }
.flag { display: inline-block; font-size: 12px; padding: 1px 6px; margin: 2px 6px 2px 0; border-radius: 4px; background: var(--warn-bg); color: var(--warn); }
.banner { border-radius: 8px; padding: 12px 14px; margin: 8px 0; }
.banner.warn { background: var(--warn-bg); color: var(--warn); }
.banner.bad { background: var(--bad-bg); color: var(--bad); }
.banner.ok { background: #e6f4ea; color: var(--ok); }
.steps { list-style: none; padding: 0; } .steps li { padding: 2px 0; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.scroll { overflow-x: auto; }
details { margin: 8px 0; } summary { cursor: pointer; font-weight: 600; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
audio { width: 100%; margin: 8px 0; }
pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: #f0f0ec; padding: 8px; border-radius: 6px; max-height: 400px; overflow: auto; }
```

If `app/page.module.css` exists, delete it.

- [ ] **Step 2: Client helpers**

Create `app/components/api.ts`:

```ts
import type { Report, Run, Transcript } from "@/lib/types";

export type RunDetail = {
  run: Run;
  report: Report | null;
  transcript: Transcript | null;
  raw?: { deepgram: unknown; claude: unknown };
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
```

Create `app/components/clientFileCheck.ts`:

```ts
import { fileTypeFromBlob } from "file-type";
import { checkContainer, checkDuration, checkSize } from "@/lib/gate/classify";
import { LIMITS, rejectionMessage, type RejectionCode } from "@/lib/limits";

export type ClientCheck =
  | { ok: true; format: string; durationSec: number | null }
  | { ok: false; code: RejectionCode; message: string };

const fail = (code: RejectionCode, detail?: string): ClientCheck => ({ ok: false, code, message: rejectionMessage(code, detail) });

function probeMedia(url: string): Promise<{ duration: number | null; hasVideo: boolean } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (r: { duration: number | null; hasVideo: boolean } | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done(null), 8000);
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : null, hasVideo: v.videoWidth > 0 });
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** Fast browser-side feedback. The server repeats every check on the stored bytes. */
export async function clientFileCheck(file: File, objectUrl: string): Promise<ClientCheck> {
  const sizeCode = checkSize(file.size);
  if (sizeCode) return fail(sizeCode);
  const ft = await fileTypeFromBlob(file);
  const container = checkContainer(ft);
  if (container.code || !ft) return fail(container.code ?? "not_audio", container.detail);
  const probe = await probeMedia(objectUrl);
  if (!probe) return fail("unreadable");
  if (probe.hasVideo) return fail("contains_video", ft.ext.toUpperCase());
  const durationCode = checkDuration(probe.duration, LIMITS.maxDurationSec);
  if (durationCode) return fail(durationCode, `${probe.duration?.toFixed(1)} s`);
  return { ok: true, format: ft.ext, durationSec: probe.duration };
}
```

Create `app/components/useSegmentPlayer.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";

export const SEGMENT_PADDING_SEC = 0.3;

export function useSegmentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (stopAt.current != null && audio.currentTime >= stopAt.current) {
        audio.pause();
        stopAt.current = null;
      }
    };
    const onSeekByUser = () => {
      if (audio.paused) stopAt.current = null;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", onSeekByUser);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", onSeekByUser);
    };
  });

  const playSegment = useCallback((start: number, end: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, start - SEGMENT_PADDING_SEC);
    stopAt.current = end + SEGMENT_PADDING_SEC;
    void audio.play();
  }, []);

  return { audioRef, playSegment };
}
```

- [ ] **Step 3: Evidence, report, metrics and transcript components**

Create `app/components/EvidenceLine.tsx`:

```tsx
import { formatTime } from "@/lib/format";
import type { Evidence } from "@/lib/types";

export type OnPlay = (start: number, end: number) => void;

export function EvidenceLine({ ev, onPlay, label }: { ev: Evidence; onPlay: OnPlay; label?: string }) {
  return (
    <div className="evidence">
      <button type="button" className="play" onClick={() => onPlay(ev.start, ev.end)} title="Play this segment">
        ▶ {formatTime(ev.start)}
      </button>
      {label ? <span className="tag">{label}</span> : null}
      <span className="speaker">{ev.speakerName ?? `Speaker ${ev.speaker}`}:</span> “{ev.quote}”
    </div>
  );
}
```

Create `app/components/ReportView.tsx`:

```tsx
import { EvidenceLine, type OnPlay } from "@/app/components/EvidenceLine";
import type { Flag, Report, VerifiedItem } from "@/lib/types";

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

function TaskCard({ item, onPlay }: { item: VerifiedItem; onPlay: OnPlay }) {
  const showFields = item.finalStatus === "active" || item.owner.status === "disputed" || item.deadline.status === "disputed";
  return (
    <div className="card">
      <strong>{item.summary}</strong>
      {showFields ? (
        <>
          <div>
            Owner: {item.owner.name ?? <span className="muted">—</span>}
            {item.owner.evidence ? <EvidenceLine ev={item.owner.evidence} onPlay={onPlay} label="owner" /> : null}
          </div>
          <div>
            Deadline: {item.deadline.wording ? `“${item.deadline.wording}”` : <span className="muted">—</span>}
            {item.deadline.resolvedDate ? ` (${item.deadline.resolvedDate})` : null}
            {item.deadline.evidence ? <EvidenceLine ev={item.deadline.evidence} onPlay={onPlay} label="deadline" /> : null}
          </div>
        </>
      ) : null}
      <div>{item.flags.map((f) => <span key={f} className="flag">⚠ {FLAG_TEXT[f]}</span>)}</div>
      <details>
        <summary>Evidence timeline ({item.events.length})</summary>
        {item.events.map((ev, i) => <EvidenceLine key={i} ev={ev} onPlay={onPlay} label={EVENT_LABEL[ev.type] ?? ev.type} />)}
      </details>
    </div>
  );
}

function StatusBanner({ report }: { report: Report }) {
  if (report.status === "declined") {
    return (
      <div className="banner bad">
        <strong>Can’t produce a reliable commitments list.</strong>
        <ul>{report.declineReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    );
  }
  if (report.status === "needs_clarification") {
    return <div className="banner warn"><strong>No commitment can be concluded from this recording.</strong> The points below must be clarified.</div>;
  }
  if (report.status === "no_commitments") {
    return <div className="banner warn"><strong>No tasks, decisions or open questions were discussed.</strong></div>;
  }
  return null;
}

export function ReportView({ report, onPlay }: { report: Report; onPlay: OnPlay }) {
  const by = (status: VerifiedItem["finalStatus"]) => report.items.filter((i) => i.kind === "task" && i.finalStatus === status);
  const active = by("active");
  const cancelled = by("cancelled");
  const notAccepted = by("not_accepted");
  return (
    <section>
      <h2>Final commitments</h2>
      <StatusBanner report={report} />
      {report.speakers.length > 0 ? (
        <>
          <h3>Speakers</h3>
          {report.speakers.map((s) =>
            s.intro ? (
              <EvidenceLine key={s.speaker} ev={s.intro} onPlay={onPlay} label={s.name ?? undefined} />
            ) : (
              <div key={s.speaker} className="muted">Speaker {s.speaker}: not identified</div>
            ),
          )}
        </>
      ) : null}
      {report.status === "ok" ? (
        <>
          <h3>Active tasks ({active.length})</h3>
          {active.length ? active.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />) : <p className="muted">No active tasks.</p>}
        </>
      ) : null}
      {report.clarifications.length > 0 ? (
        <>
          <h3>Needs clarification / open questions ({report.clarifications.length})</h3>
          {report.clarifications.map((c, i) => (
            <div key={i} className="card">
              <div><span className="tag">{c.about}</span><strong>{c.question}</strong></div>
              <EvidenceLine ev={c.evidence} onPlay={onPlay} />
            </div>
          ))}
        </>
      ) : null}
      {cancelled.length > 0 ? (
        <details>
          <summary>Cancelled ({cancelled.length})</summary>
          {cancelled.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />)}
        </details>
      ) : null}
      {notAccepted.length > 0 ? (
        <details>
          <summary>Proposals not accepted ({notAccepted.length}) — not commitments</summary>
          {notAccepted.map((it, i) => <TaskCard key={i} item={it} onPlay={onPlay} />)}
        </details>
      ) : null}
      {report.dropped.length > 0 ? (
        <details>
          <summary>Dropped by verifier ({report.dropped.length})</summary>
          <ul>{report.dropped.map((d, i) => <li key={i}><strong>{d.summary}</strong> — {d.reason}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
```

Create `app/components/MetricsView.tsx`:

```tsx
import { formatMs, formatUsd } from "@/lib/format";
import type { CostBreakdown, Stage, Usage } from "@/lib/types";

export type MetricsLike = {
  stageMs: Partial<Record<Stage, number>>;
  timeToResultMs: number | null;
  usage: Usage;
  cost: CostBreakdown | null;
};

const STAGES: Stage[] = ["file-check", "transcribe", "precheck", "extract", "verify"];

export function MetricsView({ metrics }: { metrics: MetricsLike }) {
  const { stageMs, timeToResultMs, usage, cost } = metrics;
  return (
    <details open>
      <summary>Speed and cost</summary>
      <div className="scroll">
        <table>
          <tbody>
            <tr><th>Time to result</th><td>{formatMs(timeToResultMs)} (upload + all stages)</td></tr>
            {STAGES.map((s) => <tr key={s}><th>{s}</th><td>{formatMs(stageMs[s])}</td></tr>)}
            <tr><th>Audio</th><td>{(usage.audioSeconds / 60).toFixed(2)} min</td></tr>
            <tr><th>Claude</th><td>{usage.claudeModel}: {usage.claudeInputTokens} in / {usage.claudeOutputTokens} out, {usage.claudeAttempts} attempt(s)</td></tr>
            {cost ? (
              <>
                <tr><th>Recognition</th><td>{formatUsd(cost.recognition)}</td></tr>
                <tr><th>Reasoning</th><td>{formatUsd(cost.reasoning)}</td></tr>
                <tr><th>Speech output</th><td>{formatUsd(cost.speech)} (the product does not synthesize speech)</td></tr>
                <tr><th>Storage 30 days + operations</th><td>{formatUsd(cost.storage + cost.storageOps)}</td></tr>
                <tr><th>Egress (one playback)</th><td>{formatUsd(cost.egress)}</td></tr>
                <tr><th>Cloud Run compute</th><td>{formatUsd(cost.compute)}</td></tr>
                <tr><th>Total per operation</th><td><strong>{formatUsd(cost.total)}</strong></td></tr>
                <tr><th>Per audio minute</th><td><strong>{formatUsd(cost.perAudioMinute)}</strong></td></tr>
              </>
            ) : (
              <tr><th>Cost</th><td className="muted">Not computed (run did not finish)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
```

Create `app/components/TranscriptView.tsx`:

```tsx
import type { OnPlay } from "@/app/components/EvidenceLine";
import { formatTime } from "@/lib/format";
import type { Transcript } from "@/lib/types";

export function TranscriptView({ transcript, onPlay, names }: { transcript: Transcript; onPlay: OnPlay; names?: Map<number, string> }) {
  return (
    <details>
      <summary>Transcript ({transcript.utterances.length} utterances)</summary>
      {transcript.utterances.map((u) => (
        <div key={u.id} className="evidence">
          <button type="button" className="play" onClick={() => onPlay(u.start, u.end)}>▶ {formatTime(u.start)}</button>
          <span className="speaker">{names?.get(u.speaker) ?? `Speaker ${u.speaker}`}:</span> {u.text}
        </div>
      ))}
    </details>
  );
}
```

- [ ] **Step 4: Uploader**

Create `app/components/Uploader.tsx`:

```tsx
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
```

Replace `app/page.tsx`:

```tsx
import { Uploader } from "@/app/components/Uploader";

export default function Home() {
  return <Uploader />;
}
```

- [ ] **Step 5: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: success.

- [ ] **Step 6: Manual browser check with the local driver**

Run `npm run dev` (with `.env.local` containing both keys and `STORE_DRIVER=local`) and open http://localhost:3000:
1. Choose `testset/invalid/video-renamed.mp3` → red banner "This file contains video (detected: MP4 with a video track)…", button disabled.
2. Choose `testset/invalid/text-renamed.mp3` → "This is not an audio file…".
3. Choose `testset/invalid/too-long.mp3` → "longer than 3 minutes (200.0 s)".
4. Choose `testset/invalid/wav-renamed.mp3` → accepted (WAV, 5.0 s); Extract → server declines at precheck ("Only N words…"), transcript and metrics shown.
Record each result (pass/fail + message) for DELIVERY.md.

- [ ] **Step 7: Commit**

```bash
git add app
git commit -m "feat: upload page with client checks, staged progress and playable report

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: History pages

**Files:**
- Create: `app/components/EventLog.tsx`, `app/history/page.tsx`, `app/history/[id]/page.tsx`

**Interfaces:**
- Consumes: `api`, `RunDetail`, `ReportView`, `MetricsView`, `TranscriptView`, `useSegmentPlayer` (Task 10); HTTP API (Task 9).
- Produces: `/history` list and `/history/[id]` run page.

- [ ] **Step 1: Event log component**

Create `app/components/EventLog.tsx`:

```tsx
import { formatMs } from "@/lib/format";
import type { RunEvent } from "@/lib/types";

export function EventLog({ events }: { events: RunEvent[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Time (UTC)</th><th>Stage</th><th>Event</th><th>Duration</th><th>Details</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td>{e.at.slice(11, 19)}</td>
              <td>{e.stage}</td>
              <td className={e.type === "failed" || e.type === "rejected" ? "flag" : undefined}>{e.type}</td>
              <td>{e.durationMs != null ? formatMs(e.durationMs) : ""}</td>
              <td>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: History list**

Create `app/history/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/app/components/api";
import { formatMs, formatUsd } from "@/lib/format";
import type { Run } from "@/lib/types";

function runBadge(run: Run): string {
  if (run.status === "done") return (run.reportStatus ?? "done").replace("_", " ");
  return run.status;
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ runs: Run[] }>("/api/runs").then((r) => setRuns(r.runs)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>History</h1>
      <p className="muted">Every upload and what happened to it. Newest first, last 50 runs.</p>
      {error ? <div className="banner bad">{error}</div> : null}
      {runs === null && !error ? <p className="muted">Loading…</p> : null}
      {runs?.length === 0 ? <p className="muted">No uploads yet.</p> : null}
      {runs && runs.length > 0 ? (
        <div className="scroll">
          <table>
            <thead><tr><th>Date (UTC)</th><th>File</th><th>Duration</th><th>Status</th><th>Time to result</th><th>Cost</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/history/${r.id}`}>{r.createdAt.replace("T", " ").slice(0, 19)}</Link></td>
                  <td>{r.file.name}</td>
                  <td>{r.file.durationSec != null ? `${r.file.durationSec.toFixed(1)} s` : "—"}</td>
                  <td>{runBadge(r)}</td>
                  <td>{formatMs(r.timeToResultMs)}</td>
                  <td>{formatUsd(r.cost?.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Run page**

Create `app/history/[id]/page.tsx`:

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type RunDetail } from "@/app/components/api";
import { EventLog } from "@/app/components/EventLog";
import { MetricsView } from "@/app/components/MetricsView";
import { ReportView } from "@/app/components/ReportView";
import { TranscriptView } from "@/app/components/TranscriptView";
import { useSegmentPlayer } from "@/app/components/useSegmentPlayer";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { audioRef, playSegment } = useSegmentPlayer();

  useEffect(() => {
    api<RunDetail>(`/api/runs/${id}?raw=1`).then(setDetail).catch((e: Error) => setError(e.message));
    let url: string | null = null;
    fetch(`/api/runs/${id}/audio`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) {
          url = URL.createObjectURL(b);
          setAudioUrl(url);
        }
      })
      .catch(() => setAudioUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  async function remove() {
    if (!confirm("Delete this run and its audio for everyone?")) return;
    await api(`/api/runs/${id}`, { method: "DELETE" });
    router.push("/history");
  }

  if (error) return <div className="banner bad">{error}</div>;
  if (!detail) return <p className="muted">Loading…</p>;
  const { run, report, transcript, raw } = detail;
  const names = new Map((report?.speakers ?? []).filter((s) => s.name).map((s) => [s.speaker, s.name as string]));

  return (
    <div>
      <h1>{run.file.name}</h1>
      <p className="muted">
        {run.createdAt.replace("T", " ").slice(0, 19)} UTC · {(run.file.sizeBytes / 1024 / 1024).toFixed(2)} MB · declared “{run.file.declaredType || "none"}”, detected {run.file.detectedFormat ?? "—"} · {run.file.durationSec?.toFixed(1) ?? "—"} s · status {run.status}
      </p>
      {audioUrl ? <audio ref={audioRef} src={audioUrl} controls preload="metadata" /> : <p className="muted">Audio not available.</p>}
      {run.rejection ? <div className="banner bad"><strong>Rejected ({run.rejection.code}):</strong> {run.rejection.message}</div> : null}

      <h2>What happened</h2>
      <EventLog events={run.events} />

      {report ? <ReportView report={report} onPlay={playSegment} /> : null}
      {transcript ? <TranscriptView transcript={transcript} onPlay={playSegment} names={names} /> : null}
      <MetricsView metrics={{ stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost }} />
      {raw ? (
        <details>
          <summary>Raw API responses</summary>
          <h3>Deepgram</h3><pre>{JSON.stringify(raw.deepgram, null, 2)}</pre>
          <h3>Claude</h3><pre>{JSON.stringify(raw.claude, null, 2)}</pre>
        </details>
      ) : null}
      <p><button type="button" onClick={() => void remove()}>Delete run</button></p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: success.

- [ ] **Step 5: Manual check**

With `npm run dev`, open http://localhost:3000/history: runs from Task 10 are listed newest first with status badges; opening the rejected run shows the event log with `file-check rejected: contains_video …`, the audio player, and "Delete run" removes it.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat: shared history list and run page with event log and playback

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 12: Test set — scripts, reviewed expectations, synthesized audio

**Files:**
- Create: `testset/01-normal/script.json`, `testset/02-changed/script.json`, `testset/03-clarify/script.json`
- Create: `testset/01-normal/expected.json`, `testset/02-changed/expected.json`, `testset/03-clarify/expected.json`
- Create: `scripts/synthesize.ts`
- Create (generated): `testset/*/audio.mp3`, `testset/*/offsets.json`
- Modify: `docs/superpowers/specs/2026-09-16-commitments-extractor-design.md` (§7 expectation format, per "Refinements" at the top of this plan)

**Interfaces:**
- Consumes: `PRICING.deepgram.aura2Per1kChars` (Task 7).
- Produces: `script.json` = `{ speaker: string; voice: string; text: string }[]` (line N = index N−1); `offsets.json` = `{ line: number; speaker: string; start: number; end: number }[]`; `expected.json` in the format used by `scripts/eval-lib.ts` (Task 13).

**Order matters (spec §7 independence):** scripts and expectations are drafted, then the user reviews and approves them, then they are committed, and only then is any audio synthesized or extraction run.

- [ ] **Step 1: Write the scripts**

Create `testset/01-normal/script.json`:

```json
[
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Hi, I'm Anna, the project manager. Let's go through the launch plan." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Hi Anna, Mark here. I'm the developer on the team." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "First, we could also redo the landing page while we're at it." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Maybe later. Let's not add that now." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Fine. Next, the API documentation is still missing." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "I'll write the API docs by Wednesday." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Great, thanks. The client demo is on Thursday." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Actually, can we move the demo to Friday? The staging server won't be ready by Thursday." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Okay, the client demo is on Friday then." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "About the customer survey I mentioned last week. I was going to send it out." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Do we still need it? The client already gave us feedback." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "You're right. Let's drop the survey." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Someone needs to book the room for the demo." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Yes, someone should book the room before next Tuesday." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "One more thing. Has the budget for the extra servers been approved?" },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "I don't know yet. Finance hasn't answered, so that's still open." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Okay. So the docs from me by Wednesday, and the demo on Friday." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Right. Thanks, Mark." }
]
```

Create `testset/02-changed/script.json`: identical to `01-normal/script.json` except line 12 (index 11), which becomes:

```json
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Let's keep the survey anyway. I'll send it out myself." },
```

Create `testset/03-clarify/script.json`:

```json
[
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Hi, I'm Anna, the project manager." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "And I'm Mark, the developer." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "We need to talk about the client report." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Mark, can you take the client report this time?" },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "I'm not sure I can. My week is full. Maybe you could do it?" },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "I'm not sure either. Let's see who has time." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "And when is it due? Thursday or Friday?" },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "I don't know yet. Let's decide later." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "We should probably update the roadmap too." },
  { "speaker": "Anna", "voice": "aura-2-thalia-en", "text": "Maybe. Let's talk about it another time." },
  { "speaker": "Mark", "voice": "aura-2-apollo-en", "text": "Okay, let's pick this up next week." }
]
```

- [ ] **Step 2: Draft the expectations from the scripts only**

Create `testset/01-normal/expected.json`:

```json
{
  "status": "ok",
  "items": [
    { "anchor": ["landing page"], "kind": "task", "final_status": "not_accepted", "flags": [], "evidence_line": 3 },
    {
      "anchor": ["API docs", "API documentation"], "kind": "task", "final_status": "active",
      "owner": "Mark", "owner_line": 6,
      "deadline_contains": "Wednesday", "deadline_line": 6,
      "flags": ["date_context_missing"], "evidence_line": [6, 17]
    },
    {
      "anchor": ["client demo", "demo to Friday", "demo on Friday"], "kind": "task", "final_status": "active",
      "owner": null,
      "deadline_contains": "Friday", "deadline_line": [8, 9],
      "flags": ["owner_missing", "date_context_missing"], "evidence_line": [8, 9]
    },
    { "anchor": ["customer survey", "the survey"], "kind": "task", "final_status": "cancelled", "flags": [], "evidence_line": 12 },
    {
      "anchor": ["book the room"], "kind": "task", "final_status": "active",
      "owner": null,
      "deadline_contains": "next Tuesday", "deadline_line": 14,
      "flags": ["owner_missing", "date_context_missing"], "evidence_line": [13, 14]
    },
    { "anchor": ["budget"], "kind": "open_question", "final_status": "open", "flags": [], "evidence_line": [15, 16] }
  ],
  "must_not": [
    { "anchor": ["landing page"], "final_status": "active" },
    { "anchor": ["customer survey", "the survey"], "final_status": "active" },
    { "anchor": ["book the room"], "has_owner": true },
    { "anchor": ["client demo", "demo to Friday", "demo on Friday"], "deadline_contains": "Thursday" },
    { "anchor": ["client demo", "demo to Friday", "demo on Friday"], "has_owner": true }
  ],
  "clarifications": [{ "about": "question", "lines": [15, 16] }]
}
```

Create `testset/02-changed/expected.json`: copy `01-normal/expected.json`, then replace the survey item and the survey `must_not` entry:

```json
    {
      "anchor": ["customer survey", "the survey"], "kind": "task", "final_status": "active",
      "owner": "Anna", "owner_line": [10, 12],
      "deadline_contains": null,
      "flags": ["deadline_missing"], "evidence_line": 12
    },
```

```json
    { "anchor": ["customer survey", "the survey"], "final_status": "cancelled" },
```

Create `testset/03-clarify/expected.json`:

```json
{
  "status": "needs_clarification",
  "items": [],
  "must_not": [
    { "final_status": "active" },
    { "has_owner": true },
    { "has_deadline": true }
  ],
  "clarifications": [
    { "about": "owner", "lines": [4, 5, 6] },
    { "about": "deadline", "lines": [7, 8] }
  ]
}
```

- [ ] **Step 3: STOP — user review of scripts and expectations**

Show the user the three scripts and three expectation files (a compact table per case: item, expected status/owner/deadline/flags, line). Ask them to confirm or correct each expectation. Apply their corrections verbatim. Record every correction (before → after, with the user's reason) in `testset/REVIEW.md`:

```markdown
# Expected-list review

Drafted by Claude from `script.json` only on <date>; reviewed by the user before any extraction run.

| Case | Item | Draft | Reviewer decision | Reason |
|---|---|---|---|---|
```

(one row per changed or confirmed-with-comment expectation; if the user confirms everything unchanged, write a single row stating that).

Do not continue until the user has approved.

- [ ] **Step 4: Update the spec's expectation format and commit the approved expectations**

In the spec §7 "Expectation format", replace the JSON example and the paragraph after it with the `01-normal` item for API docs and the rules from the "Refinements" section at the top of this plan (anchor alternatives, line arrays, `deadline_contains`, `has_deadline`, `clarifications`, extra-active precision). Add `about` to the `clarifications` entry in the spec's `Report` type.

```bash
git add testset/01-normal/script.json testset/02-changed/script.json testset/03-clarify/script.json testset/*/expected.json testset/REVIEW.md docs/superpowers/specs/2026-09-16-commitments-extractor-design.md
git commit -m "test: expected commitments approved by reviewer before any extraction run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Write the synthesizer**

Create `scripts/synthesize.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRICING } from "@/lib/pricing";

type Line = { speaker: string; voice: string; text: string };

const SAMPLE_RATE = 24000;
const GAP_SEC = 0.4;
const cases = process.argv.slice(2).length ? process.argv.slice(2) : ["01-normal", "02-changed", "03-clarify"];
const key = process.env.DEEPGRAM_API_KEY;
if (!key) throw new Error("DEEPGRAM_API_KEY is not set (put it in .env.local)");

const posix = (p: string) => path.resolve(p).replace(/\\/g, "/");
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

function duration(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

async function speak(text: string, voice: string): Promise<Buffer> {
  const url = `https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&container=wav&sample_rate=${SAMPLE_RATE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Aura-2 ${res.status} for voice ${voice}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

let totalChars = 0;
for (const name of cases) {
  const dir = path.join("testset", name);
  const work = path.join(dir, ".work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const lines = JSON.parse(await readFile(path.join(dir, "script.json"), "utf8")) as Line[];

  const silence = path.join(work, "silence.wav");
  ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`, "-t", String(GAP_SEC), "-c:a", "pcm_s16le", silence]);

  const list: string[] = [];
  const offsets: { line: number; speaker: string; start: number; end: number }[] = [];
  let t = 0;
  let chars = 0;
  for (const [i, line] of lines.entries()) {
    const rawFile = path.join(work, `line${String(i + 1).padStart(2, "0")}.wav`);
    await writeFile(rawFile, await speak(line.text, line.voice));
    chars += line.text.length;
    const norm = rawFile.replace(/\.wav$/, "-n.wav");
    ffmpeg(["-i", rawFile, "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", norm]);
    const d = duration(norm);
    offsets.push({ line: i + 1, speaker: line.speaker, start: round3(t), end: round3(t + d) });
    list.push(`file '${posix(norm)}'`, `file '${posix(silence)}'`);
    t += d + GAP_SEC;
  }
  const listFile = path.join(work, "list.txt");
  await writeFile(listFile, list.join("\n"));
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-b:a", "96k", path.join(dir, "audio.mp3")]);
  await writeFile(path.join(dir, "offsets.json"), JSON.stringify(offsets, null, 2) + "\n");
  await rm(work, { recursive: true, force: true });
  totalChars += chars;
  console.log(`${name}: ${lines.length} lines, ${t.toFixed(1)} s, ${chars} chars`);
}
console.log(`Aura-2 one-time synthesis cost: $${((totalChars / 1000) * PRICING.deepgram.aura2Per1kChars).toFixed(4)} for ${totalChars} chars`);
```

- [ ] **Step 6: Synthesize and listen**

Run: `npm run synth`
Expected: three lines like `01-normal: 18 lines, 7x.x s, …` and the total Aura-2 cost. If Deepgram returns 400 for a voice name, open https://developers.deepgram.com/docs/tts-models, pick one female and one male English Aura-2 voice, update `voice` in all three scripts (voices are not part of the approved expectations), and rerun.

Listen to each `audio.mp3` once. Confirm the two voices are clearly different and every line is spoken as written. Note the synthesis cost for DELIVERY.md.

- [ ] **Step 7: Commit**

```bash
git add scripts/synthesize.ts testset/*/audio.mp3 testset/*/offsets.json testset/*/script.json
git commit -m "test: synthesize two-voice test recordings with line offsets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Evaluation harness and measured results

**Files:**
- Create: `scripts/eval-lib.ts`, `scripts/eval.ts`
- Create (generated): `eval/results/<timestamp>.json`, `eval/results/<timestamp>.md`
- Test: `tests/scripts/eval-lib.test.ts`

**Interfaces:**
- Consumes: `Report`, `VerifiedItem`, `Evidence`, `Transcript`, `Flag`, `ReportStatus` (Task 1); `fuzzyContainsPhrase`, `containsPhrase`, `normalize` (Task 2); `processAudio` (Task 9); `computeCost` (Task 7).
- Produces:
  - types `Expected`, `ExpectedItem`, `MustNot`, `ExpectedClarification`, `LineOffset`, `Check`, `CaseScore`
  - `scoreCase(expected: Expected, report: Report, transcript: Transcript | null, offsets: LineOffset[]): CaseScore`
  - CLI `npm run eval -- --runs=3`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/eval-lib.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scoreCase, type Expected, type LineOffset } from "@/scripts/eval-lib";
import type { Evidence, Report, VerifiedItem } from "@/lib/types";

const offsets: LineOffset[] = [
  { line: 1, speaker: "Anna", start: 0, end: 2 },
  { line: 2, speaker: "Mark", start: 2.4, end: 5 },
  { line: 3, speaker: "Anna", start: 5.4, end: 8 },
];

const ev = (quote: string, start: number, type: Evidence["type"] = "accepted"): Evidence => ({
  type, quote, utteranceId: "u1", speaker: 1, speakerName: "Mark", start, end: start + 1,
});

const docs: VerifiedItem = {
  kind: "task",
  summary: "Write documentation",
  finalStatus: "active",
  owner: { status: "agreed", name: "Mark", evidence: ev("I'll write the API docs", 2.5, "owner") },
  deadline: { status: "agreed", wording: "by Wednesday", resolvedDate: null, evidence: ev("by Wednesday", 3, "deadline") },
  flags: ["date_context_missing"],
  events: [ev("I'll write the API docs by Wednesday.", 2.5)],
};

const landing: VerifiedItem = {
  ...docs,
  summary: "Landing page",
  finalStatus: "active",
  owner: { status: "none", name: null, evidence: null },
  deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
  flags: ["owner_missing", "deadline_missing"],
  events: [ev("we could redo the landing page", 5.5, "accepted")],
};

const report = (items: VerifiedItem[]): Report => ({
  status: "ok", declineReasons: [], clarifications: [], speakers: [], items, dropped: [], metrics: null,
});

const expected: Expected = {
  status: "ok",
  items: [
    { anchor: ["API docs"], kind: "task", final_status: "active", owner: "Mark", owner_line: 2, deadline_contains: "Wednesday", deadline_line: 2, flags: ["date_context_missing"], evidence_line: 2 },
  ],
  must_not: [{ anchor: "landing page", final_status: "active" }],
  clarifications: [],
};

describe("scoreCase", () => {
  it("passes every field check for a correct item", () => {
    const s = scoreCase(expected, report([docs]), null, offsets);
    expect(s.found).toBe(1);
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
    expect(s.mustNotViolations).toEqual([]);
    expect(s.statusMatch).toBe(true);
  });

  it("reports must-not violations and extra active items", () => {
    const s = scoreCase(expected, report([docs, landing]), null, offsets);
    expect(s.mustNotViolations).toHaveLength(1);
    expect(s.extraActive).toEqual(["Landing page"]);
  });

  it("fails field checks and timestamp checks precisely", () => {
    const wrong: VerifiedItem = { ...docs, owner: { ...docs.owner, name: "Anna", evidence: ev("I'll write the API docs", 7.5, "owner") } };
    const s = scoreCase(expected, report([wrong]), null, offsets);
    const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(["API docs: owner", "API docs: owner evidence line"]);
  });

  it("labels a missing item as an STT miss when the anchor is not in the transcript", () => {
    const transcript = { durationSec: 8, speakerStats: [], utterances: [{ id: "u1", speaker: 1, start: 0, end: 1, text: "I'll write the API dogs", words: [] }] };
    const s1 = scoreCase(expected, report([]), transcript, offsets);
    expect(s1.sttMisses).toEqual([]);
    const other = { ...transcript, utterances: [{ ...transcript.utterances[0], text: "something else entirely" }] };
    const s2 = scoreCase(expected, report([]), other, offsets);
    expect(s2.sttMisses).toEqual(["API docs"]);
  });

  it("checks clarifications by kind and timestamp", () => {
    const withClar: Report = {
      ...report([]),
      status: "needs_clarification",
      clarifications: [{ about: "owner", itemSummary: "Report", question: 'Who owns "Report"?', evidence: ev("maybe you could", 5.6) }],
    };
    const exp: Expected = { status: "needs_clarification", items: [], must_not: [{ has_owner: true }], clarifications: [{ about: "owner", lines: [3] }, { about: "deadline", lines: [3] }] };
    const s = scoreCase(exp, withClar, null, offsets);
    expect(s.checks.map((c) => [c.name, c.pass])).toEqual([
      ["clarification owner @ lines 3", true],
      ["clarification deadline @ lines 3", false],
    ]);
  });
});
```

Add `"@/scripts/*"` resolution: the `@` alias maps to the repo root, so `@/scripts/eval-lib` already resolves; no config change.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/eval-lib.test.ts`
Expected: FAIL — cannot resolve `@/scripts/eval-lib`.

- [ ] **Step 3: Write the scoring library**

Create `scripts/eval-lib.ts`:

```ts
import type { Evidence, FinalStatus, Flag, Report, ReportStatus, Transcript, VerifiedItem } from "@/lib/types";
import { containsPhrase, fuzzyContainsPhrase, normalize } from "@/lib/verify/text";

type OneOrMany<T> = T | T[];

export type LineOffset = { line: number; speaker: string; start: number; end: number };

export type ExpectedItem = {
  anchor: OneOrMany<string>;
  kind: VerifiedItem["kind"];
  final_status: FinalStatus;
  owner?: string | null;
  owner_line?: OneOrMany<number>;
  deadline_contains?: string | null;
  deadline_line?: OneOrMany<number>;
  flags?: Flag[];
  evidence_line?: OneOrMany<number>;
};

export type MustNot = {
  anchor?: OneOrMany<string>;
  final_status?: FinalStatus;
  has_owner?: boolean;
  has_deadline?: boolean;
  deadline_contains?: string;
};

export type ExpectedClarification = { about: "owner" | "deadline" | "question"; lines: number[] };

export type Expected = {
  status: ReportStatus;
  items: ExpectedItem[];
  must_not: MustNot[];
  clarifications: ExpectedClarification[];
};

export type Check = { name: string; pass: boolean; detail: string };

export type CaseScore = {
  statusMatch: boolean;
  status: ReportStatus;
  expectedItems: number;
  found: number;
  checks: Check[];
  mustNotViolations: string[];
  extraActive: string[];
  extraOther: string[];
  sttMisses: string[];
};

const arr = <T>(x: OneOrMany<T> | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function quotes(it: VerifiedItem): Evidence[] {
  return [...it.events, ...(it.owner.evidence ? [it.owner.evidence] : []), ...(it.deadline.evidence ? [it.deadline.evidence] : [])];
}

function anchorMatches(it: VerifiedItem, anchors: string[]): boolean {
  return anchors.some((a) => quotes(it).some((q) => fuzzyContainsPhrase(q.quote, a)));
}

function inLines(ev: Evidence | null, lines: number[], offsets: LineOffset[], tolSec = 1): boolean {
  if (!ev) return false;
  return lines.some((l) => {
    const o = offsets.find((x) => x.line === l);
    return !!o && ev.start >= o.start - tolSec && ev.start <= o.end + tolSec;
  });
}

const show = (ev: Evidence | null) => (ev ? `${ev.start.toFixed(1)} s “${ev.quote}”` : "no evidence");

export function scoreCase(expected: Expected, report: Report, transcript: Transcript | null, offsets: LineOffset[]): CaseScore {
  const used = new Set<VerifiedItem>();
  const checks: Check[] = [];
  const sttMisses: string[] = [];
  const fullText = transcript?.utterances.map((u) => u.text).join(" ") ?? "";
  let found = 0;

  for (const exp of expected.items) {
    const anchors = arr(exp.anchor);
    const label = anchors[0];
    const item = report.items.find((it) => !used.has(it) && anchorMatches(it, anchors));
    if (!item) {
      checks.push({ name: `${label}: found`, pass: false, detail: "no item has a quote containing the anchor" });
      if (transcript && !anchors.some((a) => fuzzyContainsPhrase(fullText, a))) sttMisses.push(label);
      continue;
    }
    used.add(item);
    found++;
    checks.push({ name: `${label}: found`, pass: true, detail: item.summary });
    checks.push({ name: `${label}: kind`, pass: item.kind === exp.kind, detail: `got ${item.kind}, expected ${exp.kind}` });
    checks.push({ name: `${label}: final_status`, pass: item.finalStatus === exp.final_status, detail: `got ${item.finalStatus}, expected ${exp.final_status}` });
    if (exp.owner !== undefined) {
      const pass = exp.owner === null ? item.owner.name === null : item.owner.name !== null && normalize(item.owner.name) === normalize(exp.owner);
      checks.push({ name: `${label}: owner`, pass, detail: `got ${item.owner.name ?? "null"}, expected ${exp.owner ?? "null"}` });
    }
    if (exp.owner_line !== undefined) {
      checks.push({ name: `${label}: owner evidence line`, pass: inLines(item.owner.evidence, arr(exp.owner_line), offsets), detail: show(item.owner.evidence) });
    }
    if (exp.deadline_contains !== undefined) {
      const pass = exp.deadline_contains === null
        ? item.deadline.wording === null
        : item.deadline.wording !== null && containsPhrase(item.deadline.wording, exp.deadline_contains);
      checks.push({ name: `${label}: deadline`, pass, detail: `got ${item.deadline.wording ?? "null"}, expected ${exp.deadline_contains ?? "null"}` });
    }
    if (exp.deadline_line !== undefined) {
      checks.push({ name: `${label}: deadline evidence line`, pass: inLines(item.deadline.evidence, arr(exp.deadline_line), offsets), detail: show(item.deadline.evidence) });
    }
    if (exp.flags !== undefined) {
      const got = [...item.flags].sort().join(",");
      const want = [...exp.flags].sort().join(",");
      checks.push({ name: `${label}: flags`, pass: got === want, detail: `got [${got}], expected [${want}]` });
    }
    if (exp.evidence_line !== undefined) {
      checks.push({
        name: `${label}: evidence timestamp`,
        pass: item.events.some((e) => inLines(e, arr(exp.evidence_line), offsets)),
        detail: item.events.map((e) => e.start.toFixed(1)).join(", "),
      });
    }
  }

  for (const c of expected.clarifications) {
    const pass = report.clarifications.some((x) => x.about === c.about && inLines(x.evidence, c.lines, offsets));
    checks.push({
      name: `clarification ${c.about} @ lines ${c.lines.join("/")}`,
      pass,
      detail: report.clarifications.map((x) => `${x.about}@${x.evidence.start.toFixed(1)}`).join(", ") || "none",
    });
  }

  const mustNotViolations: string[] = [];
  for (const m of expected.must_not) {
    const anchors = arr(m.anchor);
    const candidates = anchors.length ? report.items.filter((it) => anchorMatches(it, anchors)) : report.items;
    for (const it of candidates) {
      const conds: boolean[] = [];
      if (m.final_status) conds.push(it.finalStatus === m.final_status);
      if (m.has_owner !== undefined) conds.push((it.owner.name !== null) === m.has_owner);
      if (m.has_deadline !== undefined) conds.push((it.deadline.wording !== null) === m.has_deadline);
      if (m.deadline_contains) conds.push(it.deadline.wording !== null && containsPhrase(it.deadline.wording, m.deadline_contains));
      if (conds.length && conds.every(Boolean)) mustNotViolations.push(`${JSON.stringify(m)} violated by "${it.summary}"`);
    }
  }

  const extras = report.items.filter((it) => !used.has(it));
  return {
    statusMatch: report.status === expected.status,
    status: report.status,
    expectedItems: expected.items.length,
    found,
    checks,
    mustNotViolations,
    extraActive: extras.filter((i) => i.finalStatus === "active").map((i) => i.summary),
    extraOther: extras.filter((i) => i.finalStatus !== "active").map((i) => `${i.finalStatus}: ${i.summary}`),
    sttMisses,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/eval-lib.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Write the eval runner**

Create `scripts/eval.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeCost } from "@/lib/metrics";
import { processAudio } from "@/lib/pipeline";
import type { CostBreakdown, Usage } from "@/lib/types";
import { scoreCase, type CaseScore, type Expected, type LineOffset } from "@/scripts/eval-lib";

const CASES = ["01-normal", "02-changed", "03-clarify"];
const runsPerCase = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);

type RunResult = {
  case: string;
  run: number;
  totalMs: number;
  stageMs: Record<string, number>;
  usage: Usage;
  cost: CostBreakdown;
  score: CaseScore | null;
  error?: string;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const results: RunResult[] = [];
for (const name of CASES) {
  const dir = path.join("testset", name);
  const expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf8")) as Expected;
  const offsets = JSON.parse(await readFile(path.join(dir, "offsets.json"), "utf8")) as LineOffset[];
  const bytes = new Uint8Array(await readFile(path.join(dir, "audio.mp3")));
  for (let i = 1; i <= runsPerCase; i++) {
    const t0 = performance.now();
    try {
      const r = await processAudio(bytes);
      const totalMs = performance.now() - t0;
      const score = scoreCase(expected, r.report, r.transcript, offsets);
      results.push({ case: name, run: i, totalMs, stageMs: r.stageMs as Record<string, number>, usage: r.usage, cost: computeCost(r.usage), score });
      const failed = score.checks.filter((c) => !c.pass).length;
      console.log(`${name} #${i}: status ${score.status}${score.statusMatch ? "" : " (MISMATCH)"}, found ${score.found}/${score.expectedItems}, failed checks ${failed}, must_not violations ${score.mustNotViolations.length}, ${(totalMs / 1000).toFixed(1)} s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${name} #${i}: ERROR ${msg}`);
      results.push({ case: name, run: i, totalMs: performance.now() - t0, stageMs: {}, usage: {} as Usage, cost: {} as CostBreakdown, score: null, error: msg });
    }
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
await mkdir(path.join("eval", "results"), { recursive: true });
await writeFile(path.join("eval", "results", `${stamp}.json`), JSON.stringify(results, null, 2));

const lines: string[] = [
  `# Eval ${stamp}`,
  "",
  `Runs per case: ${runsPerCase}. Model: ${results.find((r) => r.usage.claudeModel)?.usage.claudeModel ?? "?"}. API costs only (recognition + reasoning); infrastructure costs come from deployed runs.`,
  "",
  "| Case | Status match | Items found | Field checks passed | must_not violations | Extra active items | STT misses | Median / max time | Median cost per op | Median cost per audio min |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const name of CASES) {
  const rs = results.filter((r) => r.case === name);
  const ok = rs.filter((r) => r.score);
  const sum = (f: (r: RunResult) => number) => ok.reduce((s, r) => s + f(r), 0);
  const checks = ok.flatMap((r) => r.score!.checks);
  lines.push(
    `| ${name} | ${ok.filter((r) => r.score!.statusMatch).length}/${rs.length} | ${sum((r) => r.score!.found)}/${sum((r) => r.score!.expectedItems)} | ${checks.filter((c) => c.pass).length}/${checks.length} | ${sum((r) => r.score!.mustNotViolations.length)} | ${sum((r) => r.score!.extraActive.length)} | ${sum((r) => r.score!.sttMisses.length)} | ${(median(rs.map((r) => r.totalMs)) / 1000).toFixed(1)} s / ${(Math.max(...rs.map((r) => r.totalMs)) / 1000).toFixed(1)} s | $${median(ok.map((r) => r.cost.total)).toFixed(4)} | $${median(ok.map((r) => r.cost.perAudioMinute ?? 0)).toFixed(4)} |`,
  );
}
lines.push("", "## Stage timings (median ms)", "", "| Case | file-check | transcribe | precheck | extract | verify |", "|---|---|---|---|---|---|");
for (const name of CASES) {
  const ok = results.filter((r) => r.case === name && r.score);
  const m = (s: string) => Math.round(median(ok.map((r) => r.stageMs[s]).filter((x) => x != null)));
  lines.push(`| ${name} | ${m("file-check")} | ${m("transcribe")} | ${m("precheck")} | ${m("extract")} | ${m("verify")} |`);
}
lines.push("", "## Failures by run", "");
for (const r of results) {
  if (r.error) {
    lines.push(`- **${r.case} #${r.run}**: error — ${r.error}`);
    continue;
  }
  const s = r.score!;
  const problems = [
    ...(s.statusMatch ? [] : [`status ${s.status}`]),
    ...s.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`),
    ...s.mustNotViolations,
    ...s.extraActive.map((x) => `extra active item: ${x}`),
    ...s.sttMisses.map((x) => `STT miss: ${x}`),
  ];
  lines.push(`- **${r.case} #${r.run}**: ${problems.length ? problems.join("; ") : "all checks passed"}${s.extraOther.length ? ` (other extras: ${s.extraOther.join("; ")})` : ""}`);
}
await writeFile(path.join("eval", "results", `${stamp}.md`), lines.join("\n") + "\n");
console.log(`\nWrote eval/results/${stamp}.md`);
```

- [ ] **Step 6: Run the eval**

Run: `npm run eval -- --runs=3`
Expected: 9 runs complete; `eval/results/<stamp>.md` written. Do not edit expectations or prompts to make numbers pass before recording this first run: it is the honest baseline for DELIVERY.md. If a failure reveals a genuine product bug (not an expectation disagreement), fix it in a separate commit, rerun, and keep both result files.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval-lib.ts scripts/eval.ts tests/scripts eval/results
git commit -m "test: deterministic eval harness and first measured results

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 14: Container, GCP infrastructure, CI/CD and deployed smoke test

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `infra/config.sh`, `infra/setup.sh`, `infra/cors.json`, `infra/lifecycle.json`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/smoke.sh`

**Interfaces:**
- Consumes: `/api/health`, `POST /api/runs`, `DELETE /api/runs/:id` (Task 9); env `STORE_DRIVER`, `GCS_BUCKET`, `EXTRACT_MODEL`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`.
- Produces: GitHub repository variables `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`, `GCS_BUCKET`, `AR_REPO`, `CLOUD_RUN_SERVICE`; a public Cloud Run URL.

**Needs from the user before Step 4:** GCP project id with billing enabled, `gcloud auth login` done, the GitHub `owner/repo` name (empty repository), `gh auth login` done, and both API keys exported in the shell for `setup.sh`.

- [ ] **Step 1: Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
```

Create `.dockerignore`:

```
node_modules
.next
.data
.env*
.git
testset
eval
docs
tests
```

Run: `docker build -t commitments:local . && docker run --rm -p 8080:8080 -e STORE_DRIVER=local commitments:local` then `curl -s localhost:8080/api/health`
Expected: `{"ok":true,"store":"local"}`. (If Docker is not installed locally, skip the run; the GitHub Actions build in Step 7 is the check.)

- [ ] **Step 2: Infrastructure configuration**

Create `infra/config.sh`:

```bash
#!/usr/bin/env bash
# Shared settings for infra scripts. Override any value via environment variables.
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project id}"
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO to owner/name}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-commitments}"
AR_REPO="${AR_REPO:-commitments}"
BUCKET="${BUCKET:-${PROJECT_ID}-commitments-runs}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-commitments-runtime}"
DEPLOY_SA_NAME="${DEPLOY_SA_NAME:-commitments-deployer}"
WIF_POOL="${WIF_POOL:-github}"
WIF_PROVIDER="${WIF_PROVIDER:-github-oidc}"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

Create `infra/cors.json` (the signed URL is the authorization; CORS only lets the browser send the PUT/GET):

```json
[
  {
    "origin": ["*"],
    "method": ["PUT", "GET"],
    "responseHeader": ["Content-Type", "x-goog-content-length-range"],
    "maxAgeSeconds": 3600
  }
]
```

Create `infra/lifecycle.json`:

```json
{ "rule": [{ "action": { "type": "Delete" }, "condition": { "age": 30 } }] }
```

- [ ] **Step 3: Idempotent setup script**

Create `infra/setup.sh`:

```bash
#!/usr/bin/env bash
# One-time GCP setup. Safe to re-run. Requires: gcloud (authenticated), DEEPGRAM_API_KEY, ANTHROPIC_API_KEY.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh
: "${DEEPGRAM_API_KEY:?export DEEPGRAM_API_KEY}"
: "${ANTHROPIC_API_KEY:?export ANTHROPIC_API_KEY}"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "== Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com iam.googleapis.com sts.googleapis.com storage.googleapis.com

echo "== Artifact Registry"
gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION"

echo "== Bucket"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
gcloud storage buckets update "gs://$BUCKET" --cors-file=cors.json --lifecycle-file=lifecycle.json

echo "== Service accounts"
for SA in "$RUNTIME_SA_NAME" "$DEPLOY_SA_NAME"; do
  gcloud iam service-accounts describe "${SA}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$SA"
done

echo "== Runtime permissions"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectAdmin >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:$RUNTIME_SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null

echo "== Secrets"
upsert_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf %s "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf %s "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor >/dev/null
}
upsert_secret deepgram-api-key "$DEEPGRAM_API_KEY"
upsert_secret anthropic-api-key "$ANTHROPIC_API_KEY"

echo "== Deployer permissions"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role=roles/run.admin --condition=None >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser >/dev/null

echo "== Workload Identity Federation (GitHub → deployer)"
gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$WIF_POOL" --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" --location=global --workload-identity-pool="$WIF_POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" --location=global --workload-identity-pool="$WIF_POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

WIF_PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
cat <<EOF

Done. Set these GitHub repository variables (Settings → Secrets and variables → Actions → Variables),
or run the gh commands below:

gh variable set GCP_PROJECT_ID --body "$PROJECT_ID" --repo "$GITHUB_REPO"
gh variable set GCP_REGION --body "$REGION" --repo "$GITHUB_REPO"
gh variable set GCP_WIF_PROVIDER --body "$WIF_PROVIDER_NAME" --repo "$GITHUB_REPO"
gh variable set GCP_DEPLOY_SA --body "$DEPLOY_SA" --repo "$GITHUB_REPO"
gh variable set GCP_RUNTIME_SA --body "$RUNTIME_SA" --repo "$GITHUB_REPO"
gh variable set GCS_BUCKET --body "$BUCKET" --repo "$GITHUB_REPO"
gh variable set AR_REPO --body "$AR_REPO" --repo "$GITHUB_REPO"
gh variable set CLOUD_RUN_SERVICE --body "$SERVICE" --repo "$GITHUB_REPO"
EOF
```

- [ ] **Step 4: Run the setup (with the user)**

Ask the user for `PROJECT_ID` and `GITHUB_REPO` and confirm they want these GCP resources created in that project (this creates billable resources and IAM bindings). Then run:

```bash
export PROJECT_ID=<id> GITHUB_REPO=<owner/name>
set -a; source .env.local; set +a
bash infra/setup.sh
```

Expected: ends with the list of `gh variable set` commands. Run them (after `gh auth login`).

- [ ] **Step 5: Smoke test script**

Create `scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
# Verifies a deployed service: health, signed upload URL generation (IAM signing), shared history, deletion.
set -euo pipefail
URL="${1:?usage: scripts/smoke.sh https://service-url}"
curl -fsS "$URL/api/health" | grep -q '"store":"gcs"'
CREATED="$(curl -fsS -X POST "$URL/api/runs" -H 'Content-Type: application/json' -d '{"fileName":"smoke.mp3","sizeBytes":4096,"declaredType":"audio/mpeg"}')"
echo "$CREATED" | grep -q '"url":"https://storage.googleapis.com/'
ID="$(echo "$CREATED" | sed -E 's/.*"runId":"([^"]+)".*/\1/')"
curl -fsS "$URL/api/runs" | grep -q "$ID"
curl -fsS -X DELETE "$URL/api/runs/$ID" | grep -q '"ok":true'
echo "Smoke test passed for $URL"
```

- [ ] **Step 6: GitHub Actions workflows**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

Create `.github/workflows/deploy.yml`:

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
concurrency:
  group: deploy
  cancel-in-progress: false
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
  deploy:
    needs: checks
    runs-on: ubuntu-latest
    env:
      IMAGE: ${{ vars.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/${{ vars.AR_REPO }}/app:${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker "${{ vars.GCP_REGION }}-docker.pkg.dev" --quiet
      - name: Build and push image
        run: |
          docker build -t "$IMAGE" .
          docker push "$IMAGE"
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy "${{ vars.CLOUD_RUN_SERVICE }}" \
            --project "${{ vars.GCP_PROJECT_ID }}" --region "${{ vars.GCP_REGION }}" \
            --image "$IMAGE" --service-account "${{ vars.GCP_RUNTIME_SA }}" \
            --allow-unauthenticated --min-instances 0 --max-instances 2 \
            --cpu 1 --memory 1Gi --timeout 120 \
            --set-env-vars "STORE_DRIVER=gcs,GCS_BUCKET=${{ vars.GCS_BUCKET }},EXTRACT_MODEL=claude-sonnet-5" \
            --set-secrets "DEEPGRAM_API_KEY=deepgram-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest"
      - name: Smoke test
        run: |
          URL="$(gcloud run services describe "${{ vars.CLOUD_RUN_SERVICE }}" --project "${{ vars.GCP_PROJECT_ID }}" --region "${{ vars.GCP_REGION }}" --format='value(status.url)')"
          echo "Service URL: $URL" >> "$GITHUB_STEP_SUMMARY"
          bash scripts/smoke.sh "$URL"
```

- [ ] **Step 7: Push and deploy**

Ask the user to confirm the push to their GitHub repository (outward-facing action). Then:

```bash
git add Dockerfile .dockerignore infra .github scripts/smoke.sh
git commit -m "ci: Docker image, GCP setup script, GitHub Actions deploy to Cloud Run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
gh run watch --exit-status
```

Expected: `checks` and `deploy` jobs succeed; the summary shows the service URL; the smoke test prints "Smoke test passed". If the smoke test fails on the signed URL, check that `roles/iam.serviceAccountTokenCreator` is bound on the runtime account to itself (Step 3) and that `iamcredentials.googleapis.com` is enabled.

- [ ] **Step 8: End-to-end on the deployed demo**

In a browser at the service URL, upload in this order: `testset/01-normal/audio.mp3`, `testset/02-changed/audio.mp3`, `testset/03-clarify/audio.mp3`, `testset/invalid/video-renamed.mp3`. For each, record: report status, time to result (from the metrics panel), cost per operation and per audio minute, and whether ▶ plays the right segment for at least two quotes. Confirm all four runs appear in `/history` with their event logs. Record the numbers for DELIVERY.md.

---

### Task 15: README and delivery notes

**Files:**
- Create: `README.md` (replace scaffold), `DELIVERY.md`

**Interfaces:**
- Consumes: results from Tasks 3, 5, 10, 12, 13, 14 (numbers and observations recorded during those tasks), `testset/REVIEW.md`, latest `eval/results/*.md`.

- [ ] **Step 1: Write README.md**

Replace `README.md` with:

````markdown
# Recorded conversation → final commitments

Upload a recorded project discussion (English, two speakers who introduce themselves, ≤ 3 minutes). The app returns the final agreed tasks, owners, deadlines and unresolved questions — each with a timestamped quote you can play — and keeps a shared history of every upload and what happened to it.

Demo: <Cloud Run URL> · Walkthrough video: <link>

## How it works

1. The browser checks the file (size, real format by content, video track, duration) and uploads it straight to Cloud Storage with a signed URL.
2. `POST /api/runs/:id/transcribe` repeats the file checks on the stored bytes, transcribes with Deepgram Nova-3 (diarization, word timings) and declines out-of-scope input (not 2 speakers, too little speech, too long).
3. `POST /api/runs/:id/extract` asks Claude (structured output) for speakers, items and an event timeline with verbatim quotes.
4. A deterministic verifier keeps only what the transcript supports: every quote must exist, timestamps come from Deepgram words, owners and deadlines need their own supporting quote, relative dates are flagged, disputed points become clarifications.
5. Everything is stored under `runs/<id>/` (audio, event log, transcript, report, raw API responses) and shown in History.

## Run locally

Requirements: Node 22, npm, ffmpeg (only for regenerating test audio/fixtures).

```bash
npm ci
cp .env.example .env.local   # fill DEEPGRAM_API_KEY and ANTHROPIC_API_KEY; STORE_DRIVER=local
npm run dev                  # http://localhost:3000 — runs are stored in .data/
npm test                     # unit tests, no network
npm run fixtures             # regenerate testset/invalid (ffmpeg)
npm run synth                # regenerate test recordings (Deepgram Aura-2 + ffmpeg)
npm run eval -- --runs=3     # score the three test recordings → eval/results/
```

## Deploy (GitHub → Cloud Run)

```bash
export PROJECT_ID=<gcp-project> GITHUB_REPO=<owner/repo>
set -a; source .env.local; set +a
bash infra/setup.sh          # APIs, bucket (CORS, 30-day lifecycle), Artifact Registry, service accounts, secrets, WIF
# run the printed `gh variable set …` commands
git push origin main         # .github/workflows/deploy.yml: tests → image → Cloud Run → smoke test
```

## Test set

`testset/01-normal`, `02-changed` (one agreement changed), `03-clarify` (nothing settled → needs clarification): `script.json` (source), `audio.mp3`, `offsets.json` (line timings), `expected.json` (approved before any run, see `testset/REVIEW.md`). `testset/invalid/` holds files that must be rejected (renamed video, text, too long/short, empty).

## Reused components vs own work

Reused: Next.js, React, Anthropic TypeScript SDK (structured outputs helper), zod, Deepgram REST API (Nova-3, Aura-2), `file-type`, `music-metadata`, `@google-cloud/storage`, Vitest, tsx, ffmpeg, Google GitHub Actions (`auth`, `setup-gcloud`).
Own: extraction prompt and schema, verifier, file validation rules, pipeline/run log/accounting, storage drivers, UI, eval harness, test scripts and expectations, infrastructure scripts and workflows.
````

- [ ] **Step 2: Write DELIVERY.md from recorded measurements**

Create `DELIVERY.md` with these sections, filled only with numbers and observations actually measured in Tasks 5, 10, 12, 13, 14 (write "not measured" where a number is missing — never estimate a measured quantity):

````markdown
# Delivery notes

## Links
Demo · Repository · Video (≤ 3 min)

## Sample inputs and expected vs actual
Per case (01-normal, 02-changed, 03-clarify): what the recording contains, the approved expectation (link `testset/*/expected.json`), and the actual result table from `eval/results/<stamp>.md` (status match, items found, field checks, must_not violations, extra active items, STT misses). Plus the file-rejection table: fixture → expected code → server result (vitest) → browser result (manual check in Task 10).

## What failed
Every failing check from the eval "Failures by run" section and any manual check that failed, with the cause if known (STT vs extraction vs verifier) and whether it was fixed.

## Speed
Eval (local machine → APIs): median and max time per case and per stage.
Deployed demo: time to result for the three recordings (upload + all stages), from Task 14 Step 8.

## Cost per operation and per audio minute
Table per case from deployed runs: recognition, reasoning, speech (0 — no speech output), storage 30 days, storage operations, egress (one playback), Cloud Run compute, total, per audio minute.
Pricing assumptions: copy `lib/pricing.ts` values with sources and the check date; list-price basis (free tiers and credits not deducted); region europe-west1; 1 vCPU / 1 GiB; one playback per upload; run.json size not included in storage bytes.
Retries: number of Claude attempts observed and their share of cost.
Separate — hosting (fixed): Artifact Registry image storage, Secret Manager secret versions, idle Cloud Run = 0 (min instances 0).
Separate — CI: GitHub Actions minutes per deploy (from the workflow run).
Separate — one-time test preparation: Aura-2 synthesis cost printed by `npm run synth`.

## Time spent
Per task, actual hours.

## AI tools and models
- Claude Code with Claude Opus 5 (`claude-opus-5`) — design, plan, implementation.
- Claude Sonnet 5 (`claude-sonnet-5`) — extraction in the product.
- Deepgram Nova-3 — speech recognition in the product.
- Deepgram Aura-2 — synthesis of test recordings only.

## How AI output was checked (example)
The expected commitments lists were drafted by Claude from the scripts and reviewed by the user before any extraction run; corrections are in `testset/REVIEW.md` (quote one concrete correction here). In the product, every model claim passes the deterministic verifier; one concrete dropped/flagged item from a real run, with the reason shown in "Dropped by verifier".

## Unfinished / known limitations
List anything not done, plus: browser playback of some formats (e.g. Ogg in Safari) can be rejected by the client check although the server would accept it; relative dates are never resolved without an in-recording anchor (no meeting-date input by design); shared history has no access control (by brief: no accounts).

## What I would improve next
Two-pass extraction if eval shows final-state errors; a live-recorded (non-TTS) test case; optional meeting date input to resolve relative dates; per-user history.
````

- [ ] **Step 3: Final verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. Check that README commands match `package.json` scripts and that DELIVERY.md contains no unmeasured numbers.

- [ ] **Step 4: Commit and push**

Ask the user before pushing.

```bash
git add README.md DELIVERY.md
git commit -m "docs: setup instructions and delivery notes with measured results

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: Video script for the user**

Give the user a ≤ 3-minute walkthrough outline: (1) 0:00–0:20 problem and scope; (2) 0:20–1:20 upload `01-normal`, show final list, play owner/deadline quotes, show cancelled and not-accepted sections, flags; (3) 1:20–1:50 upload `03-clarify` → needs clarification with quotes; (4) 1:50–2:10 upload renamed video → rejected; (5) 2:10–2:40 History run page: event log, metrics, cost per audio minute; (6) 2:40–3:00 eval table and what failed.
