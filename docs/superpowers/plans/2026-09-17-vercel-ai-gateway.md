# Vercel Hosting and AI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the commitments extractor from the planned Cloud Run + Cloud Storage + direct Anthropic setup to Vercel (Fluid compute, private Blob, Cron) with the reasoning model called through Vercel AI Gateway, then produce the eval baseline, the deployed demo and the delivery notes.

**Architecture:** The storage interface gets a `BlobStore` driver (presigned PUT/GET, `useCache: false` reads) replacing `GcsStore`; a daily Vercel Cron deletes runs older than 30 days. `lib/extract/claude.ts` becomes `lib/extract/llm.ts`, calling `generateText` + `Output.object` from AI SDK 7 with a Gateway model id, recording tokens, Gateway-reported cost and the serving provider per attempt. Cost accounting switches from Cloud Run/GCS to Vercel Functions (Active CPU, provisioned memory, invocations), Blob and CDN prices for iad1.

**Tech Stack:** Next.js 16, TypeScript, `ai@^7.0.105` (AI Gateway provider built in), `@vercel/blob@^2.8.0`, zod 4, Deepgram REST, Vitest 5, tsx, GitHub Actions (checks only), Vercel Git integration.

**Spec:** `docs/superpowers/specs/2026-09-17-vercel-ai-gateway-design.md` (amends `docs/superpowers/specs/2026-09-16-commitments-extractor-design.md`). Supersedes Task 13 Step 6 onward and Tasks 14–15 of `docs/superpowers/plans/2026-09-16-commitments-extractor.md`.

## Prerequisites (ask the user before the task that needs them)

- `AI_GATEWAY_API_KEY` in `.env.local` (Task 5). `DEEPGRAM_API_KEY` is already set.
- An empty GitHub repository and a Vercel account (Task 6). The user performs the dashboard steps and confirms every push.

## Global Constraints

- Node 22; npm; TypeScript strict; import alias `@/*` → repository root.
- Model id comes from env `EXTRACT_MODEL`, default `anthropic/claude-sonnet-5` (an AI Gateway id). Other model ids appear only in `lib/pricing.ts` and tests.
- AI SDK calls use `maxRetries: 0`; retries live in `extractCommitments` so every paid call is an attempt.
- AI SDK 7 option names: `instructions` (not `system`), `maxOutputTokens`, `output: Output.object({ schema })`.
- Region `iad1` for functions and the Blob store. Blob store access mode: private.
- Storage layout: `runs/<id>/{audio,run.json,transcript.json,report.json,raw/deepgram.json,raw/llm.json}`.
- Retention: 30 days, enforced by `GET /api/cron/cleanup` (schedule `0 3 * * *`, `Authorization: Bearer $CRON_SECRET`).
- Prices (checked 2026-09-17, iad1): Active CPU $0.128/h; memory $0.0106/GB-h; invocations $0.60/M; function memory 2 GB; Blob storage $0.023/GB-month; simple ops $0.40/M; advanced ops $5.00/M; Blob data transfer $0.05/GB; edge requests $2.00/M; Fast Origin Transfer $0.06/GB; LLM fallback Sonnet 5 $2/$10 per MTok, Opus 5 $5/$25.
- Shared-history notice text stays verbatim: "Uploads are visible to everyone who opens this demo and are deleted after 30 days."
- Eval scripts never write to the shared history.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `process.cpuUsage()` has ~15 ms resolution on Windows: tests inject CPU readings instead of asserting a measured value is positive.

## File Map

```
lib/extract/llm.ts               (new, replaces claude.ts) AI Gateway structured-output call, attempts, cost
lib/store/blob.ts                (new, replaces gcs.ts) private Vercel Blob driver
lib/runs/cleanup.ts              (new) expired run selection and deletion
lib/runs/meter.ts                (new) per-invocation wall/CPU accounting
app/api/cron/cleanup/route.ts    (new) cron endpoint
scripts/smoke.mts                (new) deployment smoke test
vercel.json                      (new) region + cron
.github/workflows/ci.yml         (new) PR checks
lib/types.ts, lib/pricing.ts, lib/metrics.ts, lib/pipeline.ts, lib/runs/runs.ts, lib/runs/stages.ts,
lib/store/index.ts, lib/store/local.ts, app/api/runs/route.ts, app/api/runs/[id]/route.ts,
app/api/runs/[id]/upload/route.ts, app/components/api.ts, app/components/MetricsView.tsx,
app/history/[id]/page.tsx, scripts/eval.mts, next.config.ts, .env.example, package.json   (modified)
tests/lib/extract/llm.test.ts, tests/lib/store/blob.test.ts, tests/lib/runs/cleanup.test.ts,
tests/lib/runs/meter.test.ts     (new)
tests/lib/metrics.test.ts, tests/lib/runs/runs.test.ts, tests/lib/runs/stages.test.ts   (modified)
README.md, DELIVERY.md, eval/results/*   (Tasks 5 and 7)
```

---

### Task 1: Extraction through AI Gateway

**Files:**
- Create: `lib/extract/llm.ts`, `tests/lib/extract/llm.test.ts`
- Delete: `lib/extract/claude.ts`, `tests/lib/extract/claude.test.ts`
- Modify: `package.json`, `lib/types.ts`, `lib/pricing.ts`, `lib/metrics.ts`, `lib/pipeline.ts`, `lib/runs/runs.ts`, `lib/runs/stages.ts`, `app/api/runs/route.ts`, `app/api/runs/[id]/route.ts`, `app/components/api.ts`, `app/components/MetricsView.tsx`, `app/history/[id]/page.tsx`, `scripts/eval.mts`, `.env.example`, `tests/lib/metrics.test.ts`, `tests/lib/runs/runs.test.ts`, `tests/lib/runs/stages.test.ts`

**Interfaces:**
- Consumes: `renderTranscript`, `SYSTEM_PROMPT` (`lib/extract/prompt.ts`); `ExtractionSchema`, `Extraction` (`lib/extract/schema.ts`).
- Produces:
  - `type LlmCostSource = "gateway" | "estimated" | "unknown"` in `lib/types.ts`.
  - `Usage` fields `llmModel: string; llmResolvedModel: string | null; llmInputTokens: number; llmOutputTokens: number; llmAttempts: number; llmCostUsd: number; llmCostSource: LlmCostSource` (replacing `claude*`).
  - `lib/extract/llm.ts`: `EXTRACT_MODEL: string`; `type LlmAttempt = { ok; finishReason: string | null; inputTokens; outputTokens; costUsd: number; costSource: LlmCostSource; model: string; generationId: string | null; error?: string; raw: unknown }`; `type Generate = (request: GenerateRequest) => Promise<GenerateResult>`; `class ExtractionError { attempts: LlmAttempt[] }`; `extractCommitments(transcript, generate?) => Promise<{ extraction; attempts: LlmAttempt[] }>`; `estimateCost(model, inputTokens, outputTokens) => { costUsd; costSource }`.
  - `PRICING.llmFallback.models: Record<string, { inputPerMTok; outputPerMTok }>` keyed by Gateway id.
  - `runExtract(transcript, onEvent?, generate?: Generate)`; `JsonName` includes `"raw/llm.json"` (not `"raw/claude.json"`); `GET /api/runs/:id?raw=1` returns `raw: { deepgram, llm }`.

- [ ] **Step 1: Swap the SDK dependency**

Run:
```bash
npm uninstall @anthropic-ai/sdk
npm install ai@^7.0.105
```
Expected: `package.json` dependencies contain `"ai": "^7.0.105"` and no `@anthropic-ai/sdk`.

- [ ] **Step 2: Write the failing test**

Delete `tests/lib/extract/claude.test.ts` and create `tests/lib/extract/llm.test.ts`:

```ts
import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { estimateCost, ExtractionError, extractCommitments, type Generate, type GenerateResult } from "@/lib/extract/llm";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]]);
const extraction: Extraction = { speakers: [], no_commitments_discussed: true, items: [] };

function fakeGenerate(responses: (GenerateResult | Error)[]) {
  const generate = vi.fn<Generate>();
  for (const r of responses) {
    if (r instanceof Error) generate.mockRejectedValueOnce(r);
    else generate.mockResolvedValueOnce(r);
  }
  return generate;
}

const ok: GenerateResult = {
  output: extraction,
  finishReason: "stop",
  usage: { inputTokens: 1000, outputTokens: 200 },
  providerMetadata: {
    gateway: {
      cost: "0.004",
      generationId: "gen_1",
      routing: { finalProvider: "anthropic", resolvedProviderApiModelId: "claude-sonnet-5" },
    },
  },
  response: { modelId: "anthropic/claude-sonnet-5" },
};

const noGatewayMetadata: GenerateResult = { ...ok, providerMetadata: undefined };

function noObject(inputTokens: number, outputTokens: number, finishReason: "length" | "stop") {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text: '{"speakers": [',
    response: { id: "r1", timestamp: new Date(0), modelId: "anthropic/claude-sonnet-5" },
    usage: { inputTokens, outputTokens } as LanguageModelUsage,
    finishReason,
  });
}

describe("extractCommitments", () => {
  it("returns the extraction with Gateway-reported cost and the resolved provider", async () => {
    const generate = fakeGenerate([ok]);
    const result = await extractCommitments(transcript, generate);
    expect(result.extraction).toEqual(extraction);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      ok: true,
      finishReason: "stop",
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.004,
      costSource: "gateway",
      model: "anthropic/claude-sonnet-5",
      generationId: "gen_1",
    });
    const request = generate.mock.calls[0][0];
    expect(request.model).toBe("anthropic/claude-sonnet-5");
    expect(request.prompt).toContain("[u1] Speaker 0");
    expect(request.maxRetries).toBe(0);
    expect(request.output).toBeDefined();
  });

  it("estimates cost from tokens when the Gateway reports none", async () => {
    const result = await extractCommitments(transcript, fakeGenerate([noGatewayMetadata]));
    expect(result.attempts[0].costSource).toBe("estimated");
    expect(result.attempts[0].costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 9);
    expect(result.attempts[0].model).toBe("anthropic/claude-sonnet-5");
  });

  it("retries once when the output is truncated, counting both attempts' tokens", async () => {
    const result = await extractCommitments(transcript, fakeGenerate([noObject(1000, 16000, "length"), ok]));
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0]).toMatchObject({ inputTokens: 1000, outputTokens: 16000, finishReason: "length", costSource: "estimated" });
    expect(result.attempts[0].costUsd).toBeCloseTo((1000 * 2 + 16000 * 10) / 1e6, 9);
  });

  it("throws ExtractionError with attempts after two failures, preserving real token usage", async () => {
    const err = await extractCommitments(transcript, fakeGenerate([noObject(1200, 50, "stop"), new Error("network down")])).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    const attempts = (err as ExtractionError).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ ok: false, inputTokens: 1200, outputTokens: 50 });
    expect(attempts[0].error).toContain("No valid structured output");
    expect(attempts[1]).toMatchObject({ ok: false, inputTokens: 0, costUsd: 0 });
    expect(attempts[1].error).toContain("network down");
  });

  it("stops immediately on a non-retryable status, keeping the attempt", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const generate = fakeGenerate([authError]);
    const err = await extractCommitments(transcript, generate).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).attempts).toHaveLength(1);
    expect((err as ExtractionError).attempts[0].error).toContain("Unauthorized");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries a rate-limited request", async () => {
    const rateLimited = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    const result = await extractCommitments(transcript, fakeGenerate([rateLimited, ok]));
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
  });
});

describe("estimateCost", () => {
  it("marks models missing from the price table as unknown", () => {
    expect(estimateCost("someone/unpriced-model", 1000, 1000)).toEqual({ costUsd: 0, costSource: "unknown" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/lib/extract/llm.test.ts`
Expected: FAIL — cannot resolve `@/lib/extract/llm`.

- [ ] **Step 4: Add the cost-source type and LLM usage fields**

In `lib/types.ts` replace:

```ts
export type Usage = {
  audioSeconds: number;
  claudeModel: string;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeAttempts: number;
```

with:

```ts
/** Where an LLM cost figure came from, from most to least reliable. */
export type LlmCostSource = "gateway" | "estimated" | "unknown";

export type Usage = {
  audioSeconds: number;
  /** Requested AI Gateway model id. */
  llmModel: string;
  /** Provider/model that served the successful attempt, as reported by AI Gateway. */
  llmResolvedModel: string | null;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmAttempts: number;
  llmCostUsd: number;
  /** Least reliable source across all attempts. */
  llmCostSource: LlmCostSource;
```

In `lib/pricing.ts` replace the whole `anthropic: { … },` block with:

```ts
  llmFallback: {
    models: {
      "anthropic/claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "anthropic/claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
    } as Record<string, { inputPerMTok: number; outputPerMTok: number }>,
    source: "https://vercel.com/ai-gateway/models",
    note: "Used only when AI Gateway reports no cost for a generation. AI Gateway adds no markup to provider list prices.",
  },
```

In `lib/metrics.ts`, in `emptyUsage` replace the four `claude*` lines with:

```ts
    llmModel: model,
    llmResolvedModel: null,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmAttempts: 0,
    llmCostUsd: 0,
    llmCostSource: "gateway",
```

and in `computeCost` replace:

```ts
  const model = p.anthropic.models[u.claudeModel];
  if (!model) throw new Error(`No pricing for model ${u.claudeModel}`);
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  const reasoning = (u.claudeInputTokens * model.inputPerMTok + u.claudeOutputTokens * model.outputPerMTok) / 1e6;
```

with:

```ts
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  // Summed per attempt in lib/extract/llm.ts: Gateway-reported where available, list-price estimate otherwise.
  const reasoning = u.llmCostUsd;
```

- [ ] **Step 5: Write the implementation**

Delete `lib/extract/claude.ts` and create `lib/extract/llm.ts`:

```ts
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { ExtractionSchema, type Extraction } from "@/lib/extract/schema";
import { PRICING } from "@/lib/pricing";
import type { LlmCostSource, Transcript } from "@/lib/types";

/** An AI Gateway model id, e.g. "anthropic/claude-sonnet-5" or "openai/gpt-6-astra". */
export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "anthropic/claude-sonnet-5";
const MAX_ATTEMPTS = 2;
const NON_RETRYABLE_STATUS = [400, 401, 403, 404];

const extractionOutput = Output.object({ schema: ExtractionSchema });

export type LlmAttempt = {
  ok: boolean;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costSource: LlmCostSource;
  /** Provider and model that served the request as reported by AI Gateway; the requested id otherwise. */
  model: string;
  generationId: string | null;
  error?: string;
  raw: unknown;
};

export type GenerateRequest = {
  model: string;
  instructions: string;
  prompt: string;
  output: typeof extractionOutput;
  maxOutputTokens: number;
  maxRetries: number;
};

export type GenerateResult = {
  output: Extraction;
  finishReason: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
  providerMetadata: Record<string, unknown> | undefined;
  response: { modelId: string };
};

export type Generate = (request: GenerateRequest) => Promise<GenerateResult>;

const defaultGenerate: Generate = (request) => generateText(request);

export class ExtractionError extends Error {
  constructor(message: string, public attempts: LlmAttempt[]) {
    super(message);
    this.name = "ExtractionError";
  }
}

type GatewayMetadata = {
  cost?: string;
  generationId?: string;
  routing?: { finalProvider?: string; resolvedProviderApiModelId?: string };
};

/** List-price estimate for when AI Gateway reports no cost; "unknown" when the model is not in the table. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): { costUsd: number; costSource: LlmCostSource } {
  const price = PRICING.llmFallback.models[model];
  if (!price) return { costUsd: 0, costSource: "unknown" };
  return { costUsd: (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1e6, costSource: "estimated" };
}

function statusOf(e: unknown): number | undefined {
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function extractCommitments(
  transcript: Transcript,
  generate: Generate = defaultGenerate,
): Promise<{ extraction: Extraction; attempts: LlmAttempt[] }> {
  const attempts: LlmAttempt[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await generate({
        model: EXTRACT_MODEL,
        instructions: SYSTEM_PROMPT,
        prompt: renderTranscript(transcript),
        output: extractionOutput,
        maxOutputTokens: 16000,
        // Retries happen in this loop so that every paid call is recorded as an attempt.
        maxRetries: 0,
      });
      const inputTokens = res.usage.inputTokens ?? 0;
      const outputTokens = res.usage.outputTokens ?? 0;
      const gateway = (res.providerMetadata?.gateway ?? {}) as GatewayMetadata;
      const reported = gateway.cost != null ? Number(gateway.cost) : NaN;
      const routing = gateway.routing;
      attempts.push({
        ok: true,
        finishReason: res.finishReason,
        inputTokens,
        outputTokens,
        ...(Number.isFinite(reported)
          ? { costUsd: reported, costSource: "gateway" as const }
          : estimateCost(EXTRACT_MODEL, inputTokens, outputTokens)),
        model: routing?.finalProvider && routing.resolvedProviderApiModelId
          ? `${routing.finalProvider}/${routing.resolvedProviderApiModelId}`
          : res.response.modelId,
        generationId: gateway.generationId ?? null,
        raw: { output: res.output, finishReason: res.finishReason, usage: res.usage, providerMetadata: res.providerMetadata },
      });
      return { extraction: res.output, attempts };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        // Truncated or schema-invalid output still burned real tokens; the error carries no Gateway cost.
        const inputTokens = e.usage?.inputTokens ?? 0;
        const outputTokens = e.usage?.outputTokens ?? 0;
        attempts.push({
          ok: false,
          finishReason: e.finishReason ?? null,
          inputTokens,
          outputTokens,
          ...estimateCost(EXTRACT_MODEL, inputTokens, outputTokens),
          model: e.response?.modelId ?? EXTRACT_MODEL,
          generationId: null,
          error: `No valid structured output (finish reason: ${e.finishReason ?? "unknown"}): ${e.message}`,
          raw: { text: e.text ?? null, finishReason: e.finishReason ?? null, usage: e.usage ?? null },
        });
        continue;
      }
      // No response: nothing was billed.
      attempts.push({
        ok: false,
        finishReason: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        costSource: "gateway",
        model: EXTRACT_MODEL,
        generationId: null,
        error: errMsg(e),
        raw: null,
      });
      // Authentication, permission, unknown-model and request-shape errors will not fix themselves on retry.
      const status = statusOf(e);
      if (status != null && NON_RETRYABLE_STATUS.includes(status)) {
        throw new ExtractionError(`Extraction failed: ${errMsg(e)}`, attempts);
      }
    }
  }
  throw new ExtractionError(`Extraction failed after ${attempts.length} attempts`, attempts);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/lib/extract/llm.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Rewire the pipeline**

In `lib/pipeline.ts`:

Replace the first two import lines:
```ts
import type Anthropic from "@anthropic-ai/sdk";
import { EXTRACT_MODEL, ExtractionError, extractCommitments, type ClaudeAttempt } from "@/lib/extract/claude";
```
with:
```ts
import { EXTRACT_MODEL, ExtractionError, extractCommitments, type Generate, type LlmAttempt } from "@/lib/extract/llm";
```

Replace `import type { Report, RunEvent, Stage, Transcript, Usage } from "@/lib/types";` with `import type { LlmCostSource, Report, RunEvent, Stage, Transcript, Usage } from "@/lib/types";`.

Replace `public attempts: ClaudeAttempt[] = []` with `public attempts: LlmAttempt[] = []`.

Replace:
```ts
  client?: Anthropic,
): Promise<{ report: Report; attempts: ClaudeAttempt[]; ms: StageMs }> {
```
with:
```ts
  generate?: Generate,
): Promise<{ report: Report; attempts: LlmAttempt[]; ms: StageMs }> {
```

Replace `result = await extractCommitments(transcript, client);` with `result = await extractCommitments(transcript, generate);`.

Replace both occurrences of `a.error ?? a.stopReason` with `a.error ?? a.finishReason`.

Replace:
```ts
  onEvent("extract", "finished", `${result.extraction.items.length} items proposed by the model`, ms.extract);
```
with:
```ts
  const served = result.attempts[result.attempts.length - 1].model;
  onEvent("extract", "finished", `${result.extraction.items.length} items proposed by ${served}`, ms.extract);
```

Replace the `addAttempts` function with:
```ts
const COST_SOURCE_RANK: Record<LlmCostSource, number> = { gateway: 0, estimated: 1, unknown: 2 };

function addAttempts(usage: Usage, attempts: LlmAttempt[]) {
  for (const a of attempts) {
    usage.llmInputTokens += a.inputTokens;
    usage.llmOutputTokens += a.outputTokens;
    usage.llmAttempts += 1;
    usage.llmCostUsd += a.costUsd;
    if (COST_SOURCE_RANK[a.costSource] > COST_SOURCE_RANK[usage.llmCostSource]) usage.llmCostSource = a.costSource;
    if (a.ok) usage.llmResolvedModel = a.model;
  }
}
```

In `lib/runs/runs.ts` replace `"raw/deepgram.json" | "raw/claude.json"` with `"raw/deepgram.json" | "raw/llm.json"`.

In `lib/runs/stages.ts`:
- `before the paid Claude call` → `before the paid LLM call`
- both `runs.putJson(run, "raw/claude.json", …)` → `runs.putJson(run, "raw/llm.json", …)`
- `Could not store the raw Claude response` → `Could not store the raw LLM response`

In `app/api/runs/route.ts` replace `"@/lib/extract/claude"` with `"@/lib/extract/llm"`.

In `app/api/runs/[id]/route.ts` replace:
```ts
{ deepgram: await runs.getJson(id, "raw/deepgram.json"), claude: await runs.getJson(id, "raw/claude.json") }
```
with:
```ts
{ deepgram: await runs.getJson(id, "raw/deepgram.json"), llm: await runs.getJson(id, "raw/llm.json") }
```

In `app/components/api.ts` replace `raw?: { deepgram: unknown; claude: unknown };` with `raw?: { deepgram: unknown; llm: unknown };`.

In `app/history/[id]/page.tsx` replace `<h3>Claude</h3><pre>{JSON.stringify(raw.claude, null, 2)}</pre>` with `<h3>LLM (AI Gateway)</h3><pre>{JSON.stringify(raw.llm, null, 2)}</pre>`.

- [ ] **Step 8: Show the served model and cost source in the metrics panel**

In `app/components/MetricsView.tsx`:

Replace `import type { CostBreakdown, Stage, Usage } from "@/lib/types";` with `import type { CostBreakdown, LlmCostSource, Stage, Usage } from "@/lib/types";`.

Insert before `const STAGES`:
```tsx
const COST_SOURCE_NOTE: Record<LlmCostSource, string> = {
  gateway: "reported by AI Gateway",
  estimated: "partly estimated from tokens at list price",
  unknown: "incomplete: model missing from the price table",
};

```

Replace the Claude row:
```tsx
            <tr>
              <th scope="row">Claude</th>
              <td className="num">{usage.claudeInputTokens} in, {usage.claudeOutputTokens} out</td>
              <td className="muted">{usage.claudeModel}, {usage.claudeAttempts} attempt(s)</td>
            </tr>
```
with:
```tsx
            <tr>
              <th scope="row">LLM</th>
              <td className="num">{usage.llmInputTokens} in, {usage.llmOutputTokens} out</td>
              <td className="muted">{usage.llmResolvedModel ?? usage.llmModel} via AI Gateway, {usage.llmAttempts} attempt(s)</td>
            </tr>
```

Replace:
```tsx
<tr><th scope="row">Reasoning</th><td className="num">{formatUsd(cost.reasoning)}</td><td /></tr>
```
with:
```tsx
<tr><th scope="row">Reasoning</th><td className="num">{formatUsd(cost.reasoning)}</td><td className="muted">{COST_SOURCE_NOTE[usage.llmCostSource]}</td></tr>
```

- [ ] **Step 9: Let the eval pick a model**

In `scripts/eval.mts` replace:
```ts
import { computeCost } from "@/lib/metrics";
import { processAudio } from "@/lib/pipeline";
import type { CostBreakdown, Usage } from "@/lib/types";
import { scoreCase, type CaseScore, type Expected, type LineOffset } from "@/scripts/eval-lib";

const CASES = ["01-normal", "02-changed", "03-clarify"];
const runsPerCase = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);
```
with:
```ts
import { computeCost } from "@/lib/metrics";
import type { CostBreakdown, Usage } from "@/lib/types";
import { scoreCase, type CaseScore, type Expected, type LineOffset } from "@/scripts/eval-lib";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CASES = ["01-normal", "02-changed", "03-clarify"];
const runsPerCase = Number(arg("runs") ?? 3);
// EXTRACT_MODEL is read when lib/extract/llm.ts loads, so the override must precede the pipeline import.
const modelOverride = arg("model");
if (modelOverride) process.env.EXTRACT_MODEL = modelOverride;
const { processAudio } = await import("@/lib/pipeline");
```

Insert before `const stamp = new Date()`:
```ts
function modelLine(): string {
  const used = results.filter((r) => r.usage.llmModel);
  if (!used.length) return "?";
  const served = [...new Set(used.map((r) => r.usage.llmResolvedModel).filter(Boolean))].join(", ") || "none succeeded";
  const sources = [...new Set(used.map((r) => r.usage.llmCostSource))].join(", ");
  return `${used[0].usage.llmModel} via AI Gateway (served by ${served}; LLM cost source: ${sources})`;
}

```

Replace:
```ts
  `Runs per case: ${runsPerCase}. Model: ${results.find((r) => r.usage.claudeModel)?.usage.claudeModel ?? "?"}. API costs only (recognition + reasoning); infrastructure costs come from deployed runs.`,
```
with:
```ts
  `Runs per case: ${runsPerCase}. Model: ${modelLine()}. API costs only (recognition + reasoning); infrastructure costs come from deployed runs.`,
```

In `.env.example` replace:
```
ANTHROPIC_API_KEY=
EXTRACT_MODEL=claude-sonnet-5
```
with:
```
# Vercel AI Gateway key for local runs and `npm run eval`; deployments on Vercel authenticate with OIDC instead.
AI_GATEWAY_API_KEY=
# Any AI Gateway model id, e.g. anthropic/claude-sonnet-5
EXTRACT_MODEL=anthropic/claude-sonnet-5
```

- [ ] **Step 10: Update the existing tests**

`tests/lib/runs/runs.test.ts`: replace every `"claude-sonnet-5")` with `"anthropic/claude-sonnet-5")`.

`tests/lib/metrics.test.ts`:
- Replace every `emptyUsage("claude-sonnet-5")` with `emptyUsage("anthropic/claude-sonnet-5")`.
- Replace the first test's header and usage line:
  ```ts
    it("prices recognition and reasoning per audio minute", () => {
      const u = { ...emptyUsage("anthropic/claude-sonnet-5"), audioSeconds: 120, claudeInputTokens: 10_000, claudeOutputTokens: 3_000, vcpu: 0, memoryGib: 0 };
  ```
  with:
  ```ts
    it("prices recognition and takes reasoning cost from the recorded LLM cost", () => {
      const u = { ...emptyUsage("anthropic/claude-sonnet-5"), audioSeconds: 120, llmInputTokens: 10_000, llmOutputTokens: 3_000, llmCostUsd: 0.05, vcpu: 0, memoryGib: 0 };
  ```
- Delete the `it("fails loudly for an unpriced model", …)` test.

`tests/lib/runs/stages.test.ts`:
- Add `import type { LlmAttempt } from "@/lib/extract/llm";` above `import type { Extraction } from "@/lib/extract/schema";`.
- Replace `vi.mock("@/lib/extract/claude", () => ({` / `  EXTRACT_MODEL: "claude-sonnet-5",` with `vi.mock("@/lib/extract/llm", () => ({` / `  EXTRACT_MODEL: "anthropic/claude-sonnet-5",`.
- Replace the mocked success attempt with:
  ```ts
    attempts: [{ ok: true, finishReason: "stop", inputTokens: 1200, outputTokens: 400, costUsd: 0.0064, costSource: "gateway", model: "anthropic/claude-sonnet-5", generationId: "gen_1", raw: {} }],
  ```
- Replace `await import("@/lib/extract/claude")` with `await import("@/lib/extract/llm")`.
- Replace every `"claude-sonnet-5")` with `"anthropic/claude-sonnet-5")`.
- Replace `expect(report?.metrics?.usage.claudeInputTokens).toBe(1200);` with:
  ```ts
      expect(report?.metrics?.usage.llmInputTokens).toBe(1200);
      expect(report?.metrics?.usage.llmResolvedModel).toBe("anthropic/claude-sonnet-5");
      expect(report?.metrics?.cost.reasoning).toBeCloseTo(0.0064, 9);
  ```
- Rename the test `"counts every Claude attempt, even failed ones, when extraction fails"` to `"counts every LLM attempt, even failed ones, when extraction fails"` and replace its `const attempts = [ … ];` with:
  ```ts
      const attempts: LlmAttempt[] = [
        { ok: false, finishReason: "length", inputTokens: 1000, outputTokens: 16000, costUsd: 0.162, costSource: "estimated", model: "anthropic/claude-sonnet-5", generationId: null, error: "truncated", raw: { truncated: true } },
        { ok: false, finishReason: null, inputTokens: 0, outputTokens: 0, costUsd: 0, costSource: "gateway", model: "anthropic/claude-sonnet-5", generationId: null, error: "network error", raw: null },
      ];
  ```
- In the same test replace the three `failed.usage.claude*` expectations with:
  ```ts
      expect(failed.usage.llmInputTokens).toBe(1000);
      expect(failed.usage.llmOutputTokens).toBe(16000);
      expect(failed.usage.llmAttempts).toBe(2);
      expect(failed.usage.llmCostUsd).toBeCloseTo(0.162, 9);
      expect(failed.usage.llmCostSource).toBe("estimated");
      expect(failed.usage.llmResolvedModel).toBeNull();
  ```
  and `runs.getJson(failed.id, "raw/claude.json")` with `runs.getJson(failed.id, "raw/llm.json")`.

- [ ] **Step 11: Verify the whole project**

Run: `npm run typecheck && npm run lint && npm test && grep -rn "anthropic-ai\|claudeInput\|claudeModel\|claudeAttempts\|ClaudeAttempt\|raw/claude\|extract/claude\|raw.claude" lib app scripts tests --include=*.ts --include=*.tsx --include=*.mts`
Expected: typecheck, lint and all tests pass; grep prints nothing.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: extract through Vercel AI Gateway with the AI SDK

Model is an AI Gateway id from EXTRACT_MODEL; every attempt records tokens,
Gateway-reported cost (list-price estimate as fallback) and the serving provider.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Private Vercel Blob storage driver

**Files:**
- Create: `lib/store/blob.ts`, `tests/lib/store/blob.test.ts`
- Delete: `lib/store/gcs.ts`
- Modify: `package.json`, `lib/store/index.ts`, `lib/store/local.ts`, `app/api/runs/[id]/upload/route.ts`, `next.config.ts`, `.env.example`

**Interfaces:**
- Consumes: `ObjectStore` (`lib/store/store.ts`), `UploadTarget` (`lib/types.ts`).
- Produces: `class BlobStore implements ObjectStore`; `getStore()` returns `BlobStore` when `STORE_DRIVER=blob`, `LocalStore` otherwise.

- [ ] **Step 1: Swap the storage dependency**

Run:
```bash
npm uninstall @google-cloud/storage
npm install @vercel/blob@^2.8.0
```
Expected: `@vercel/blob` in dependencies, no `@google-cloud/storage`.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/store/blob.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(async () => undefined),
  issueSignedToken: vi.fn(async () => ({ delegationToken: "d", clientSigningToken: "c", validUntil: 0 })),
  presignUrl: vi.fn(async () => ({ presignedUrl: "https://blob.example/signed" })),
}));

const blob = await import("@vercel/blob");
const { BlobStore } = await import("@/lib/store/blob");

const store = new BlobStore();

beforeEach(() => vi.clearAllMocks());

describe("BlobStore", () => {
  it("writes private, overwritable objects at the exact key", async () => {
    await store.put("runs/x/run.json", "{}", "application/json");
    expect(blob.put).toHaveBeenCalledWith("runs/x/run.json", "{}", {
      access: "private",
      contentType: "application/json",
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  });

  it("reads bypassing the CDN cache and returns null when missing", async () => {
    vi.mocked(blob.get).mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response(new Uint8Array([1, 2, 3])).body!,
    } as Awaited<ReturnType<typeof blob.get>>);
    expect(await store.get("runs/x/audio")).toEqual(new Uint8Array([1, 2, 3]));
    expect(blob.get).toHaveBeenCalledWith("runs/x/audio", { access: "private", useCache: false });

    vi.mocked(blob.get).mockResolvedValueOnce(null);
    expect(await store.get("runs/missing/audio")).toBeNull();
  });

  it("lists folder names across pages", async () => {
    vi.mocked(blob.list)
      .mockResolvedValueOnce({ blobs: [], folders: ["runs/a/", "runs/b/"], hasMore: true, cursor: "c1" } as never)
      .mockResolvedValueOnce({ blobs: [], folders: ["runs/c/"], hasMore: false } as never);
    expect(await store.listDirs("runs/")).toEqual(["a", "b", "c"]);
    expect(blob.list).toHaveBeenNthCalledWith(1, { prefix: "runs/", mode: "folded", cursor: undefined, limit: 1000 });
    expect(blob.list).toHaveBeenNthCalledWith(2, { prefix: "runs/", mode: "folded", cursor: "c1", limit: 1000 });
  });

  it("deletes every object under a prefix, page by page", async () => {
    vi.mocked(blob.list)
      .mockResolvedValueOnce({ blobs: [{ url: "u1" }, { url: "u2" }], hasMore: true, cursor: "c1" } as never)
      .mockResolvedValueOnce({ blobs: [{ url: "u3" }], hasMore: false } as never);
    await store.deletePrefix("runs/x/");
    expect(blob.del).toHaveBeenNthCalledWith(1, ["u1", "u2"]);
    expect(blob.del).toHaveBeenNthCalledWith(2, ["u3"]);
  });

  it("issues a size-capped presigned PUT for uploads", async () => {
    const target = await store.uploadTarget("runs/x/audio", "application/octet-stream", 35 * 1024 * 1024);
    expect(target).toEqual({ url: "https://blob.example/signed", method: "PUT", headers: { "Content-Type": "application/octet-stream" } });
    expect(blob.issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "runs/x/audio", operations: ["put"], maximumSizeInBytes: 35 * 1024 * 1024 }),
    );
    expect(blob.presignUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: "put", pathname: "runs/x/audio", access: "private", maximumSizeInBytes: 35 * 1024 * 1024, allowOverwrite: true }),
    );
  });

  it("issues a presigned GET for playback that expires within 15 minutes", async () => {
    const before = Date.now();
    expect(await store.downloadUrl("runs/x/audio")).toBe("https://blob.example/signed");
    const options = vi.mocked(blob.presignUrl).mock.calls[0][1] as { operation: string; validUntil: number };
    expect(options.operation).toBe("get");
    expect(options.validUntil).toBeGreaterThan(before);
    expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/lib/store/blob.test.ts`
Expected: FAIL — cannot resolve `@/lib/store/blob`.

- [ ] **Step 4: Write the implementation**

Create `lib/store/blob.ts`:

```ts
import { del, get, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import type { ObjectStore } from "@/lib/store/store";
import type { UploadTarget } from "@/lib/types";

const URL_TTL_MS = 15 * 60 * 1000;
const PAGE = 1000;

/** Private Vercel Blob store. Credentials come from OIDC + BLOB_STORE_ID on Vercel, BLOB_READ_WRITE_TOKEN elsewhere. */
export class BlobStore implements ObjectStore {
  async put(key: string, data: Uint8Array | string, contentType: string): Promise<void> {
    await put(key, typeof data === "string" ? data : Buffer.from(data), {
      access: "private",
      contentType,
      allowOverwrite: true,
      addRandomSuffix: false,
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    // run.json is overwritten after every stage; a CDN-cached read could return a version up to 60 s old.
    const res = await get(key, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  }

  async listDirs(prefix: string): Promise<string[]> {
    const dirs: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, mode: "folded", cursor, limit: PAGE });
      dirs.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return dirs;
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: PAGE });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  async uploadTarget(key: string, contentType: string, maxBytes: number): Promise<UploadTarget> {
    const validUntil = Date.now() + URL_TTL_MS;
    const token = await issueSignedToken({ pathname: key, operations: ["put"], maximumSizeInBytes: maxBytes, validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname: key,
      access: "private",
      maximumSizeInBytes: maxBytes,
      // The browser reuses this URL when it retries a failed upload.
      allowOverwrite: true,
      validUntil,
    });
    return { url: presignedUrl, method: "PUT", headers: { "Content-Type": contentType } };
  }

  async downloadUrl(key: string): Promise<string | null> {
    const validUntil = Date.now() + URL_TTL_MS;
    const token = await issueSignedToken({ pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil });
    return presignedUrl;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/store/blob.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Select the driver and remove GCS**

Delete `lib/store/gcs.ts`.

In `lib/store/index.ts` replace `import { GcsStore } from "@/lib/store/gcs";` with `import { BlobStore } from "@/lib/store/blob";` and `process.env.STORE_DRIVER === "gcs" ? new GcsStore() : new LocalStore()` with `process.env.STORE_DRIVER === "blob" ? new BlobStore() : new LocalStore()`.

In `app/api/runs/[id]/upload/route.ts` replace `if (process.env.STORE_DRIVER === "gcs")` with `if (process.env.STORE_DRIVER === "blob")`.

In `lib/store/local.ts` replace the comment `(GcsStore needs it)` with `(BlobStore needs it)`.

In `next.config.ts` replace:
```ts
const nextConfig: NextConfig = {
  output: "standalone",
};
```
with `const nextConfig: NextConfig = {};` (Vercel builds Next.js natively; standalone output was for the Docker image).

In `.env.example` replace:
```
# production only (Cloud Run sets these)
GCS_BUCKET=
```
with:
```
# STORE_DRIVER=blob outside Vercel only: read-write token of the private Blob store (or run `vercel env pull`)
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build && grep -rn "gcs\|GCS\|google-cloud" lib app scripts tests package.json next.config.ts .env.example`
Expected: all pass, build lists the routes; grep prints nothing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: private Vercel Blob storage driver with presigned upload and playback URLs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 30-day retention cron

**Files:**
- Create: `lib/runs/cleanup.ts`, `tests/lib/runs/cleanup.test.ts`, `app/api/cron/cleanup/route.ts`, `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `RUN_ID_RE` (`lib/runs/runs.ts`), `ObjectStore.listDirs`, `ObjectStore.deletePrefix`, `getStore()`.
- Produces: `RETENTION_DAYS = 30`; `runIdTime(id: string): number`; `expiredRunIds(ids: string[], now: Date, days?: number): string[]`; `deleteExpiredRuns(store: ObjectStore, now?: Date): Promise<string[]>`; `GET /api/cron/cleanup` → `{ deleted: string[] }` or 401.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/runs/cleanup.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteExpiredRuns, expiredRunIds, runIdTime } from "@/lib/runs/cleanup";
import { LocalStore } from "@/lib/store/local";

const now = new Date("2026-10-17T03:00:00Z");

describe("runIdTime", () => {
  it("reads the UTC timestamp from a run id", () => {
    expect(runIdTime("20260916T132501Z-ab12cd")).toBe(Date.parse("2026-09-16T13:25:01Z"));
  });
});

describe("expiredRunIds", () => {
  it("keeps runs up to exactly 30 days old and ignores foreign folder names", () => {
    const ids = [
      "20260917T030000Z-aaaaaa", // exactly 30 days
      "20260917T025959Z-bbbbbb", // 30 days and 1 second
      "20261001T000000Z-cccccc",
      "not-a-run",
    ];
    expect(expiredRunIds(ids, now)).toEqual(["20260917T025959Z-bbbbbb"]);
  });
});

describe("deleteExpiredRuns", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cleanup-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("deletes every object of expired runs and leaves recent ones", async () => {
    const store = new LocalStore(root);
    await store.put("runs/20260801T000000Z-old000/run.json", "{}", "application/json");
    await store.put("runs/20260801T000000Z-old000/audio", "x", "application/octet-stream");
    await store.put("runs/20261010T000000Z-new000/run.json", "{}", "application/json");

    expect(await deleteExpiredRuns(store, now)).toEqual(["20260801T000000Z-old000"]);
    expect(await store.listDirs("runs/")).toEqual(["20261010T000000Z-new000"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/runs/cleanup.test.ts`
Expected: FAIL — cannot resolve `@/lib/runs/cleanup`.

- [ ] **Step 3: Write the implementation**

Create `lib/runs/cleanup.ts`:

```ts
import { RUN_ID_RE } from "@/lib/runs/runs";
import type { ObjectStore } from "@/lib/store/store";

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Creation time encoded in a run id such as `20260916T132501Z-ab12cd`. */
export function runIdTime(id: string): number {
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/.exec(id)!.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export function expiredRunIds(ids: string[], now: Date, days = RETENTION_DAYS): string[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return ids.filter((id) => RUN_ID_RE.test(id) && runIdTime(id) < cutoff);
}

/** Vercel Blob has no lifecycle rules, so the daily cron deletes expired runs itself. */
export async function deleteExpiredRuns(store: ObjectStore, now: Date = new Date()): Promise<string[]> {
  const expired = expiredRunIds(await store.listDirs("runs/"), now);
  for (const id of expired) await store.deletePrefix(`runs/${id}/`);
  return expired;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/runs/cleanup.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the cron route and schedule**

Create `app/api/cron/cleanup/route.ts`:

```ts
import { NextResponse } from "next/server";
import { deleteExpiredRuns } from "@/lib/runs/cleanup";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called daily by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ deleted: await deleteExpiredRuns(getStore()) });
}
```

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["iad1"],
  "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]
}
```

Append to `.env.example`:
```
# production: Vercel Cron sends it as a bearer token to /api/cron/cleanup (any long random string)
CRON_SECRET=
```

- [ ] **Step 6: Check the route locally**

Run in one terminal: `npm run dev`. In another:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/cleanup
```
Expected: `401` (no `CRON_SECRET` set locally). Stop the dev server.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

```bash
git add -A
git commit -m "feat: daily Vercel Cron deletes runs older than 30 days

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Vercel cost accounting

**Files:**
- Create: `lib/runs/meter.ts`, `tests/lib/runs/meter.test.ts`
- Modify: `lib/types.ts`, `lib/pricing.ts`, `lib/metrics.ts`, `lib/runs/runs.ts`, `lib/runs/stages.ts`, `lib/pipeline.ts`, `app/components/MetricsView.tsx`, `tests/lib/metrics.test.ts`, `tests/lib/runs/runs.test.ts`

**Interfaces:**
- Consumes: `Usage` LLM fields and `PRICING.llmFallback` (Task 1).
- Produces:
  - `Usage` infrastructure fields `blobAdvancedOps; blobSimpleOps; storedBytes; retentionDays; blobTransferBytes; fnInvocations; fnWallSeconds; fnCpuSeconds; fnMemoryGb` (replacing `gcsClassA/B`, `egressBytes`, `cloudRunRequests/Seconds`, `vcpu`, `memoryGib`).
  - `PRICING.vercelFunctions`, `PRICING.vercelBlob`, `PRICING.vercelCdn` (replacing `cloudRun`, `gcs`).
  - `type Meter = { startedAt: number; cpu: NodeJS.CpuUsage }`; `startMeter(): Meter`; `chargeInvocation(usage, meter, now?, cpuSinceStart?)`.
  - `CostBreakdown` keeps its shape: `storage`, `storageOps`, `egress` (now Blob transfer), `compute` (now Vercel).

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/runs/meter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyUsage } from "@/lib/metrics";
import { chargeInvocation, startMeter } from "@/lib/runs/meter";

describe("chargeInvocation", () => {
  it("adds one invocation with wall time since the meter started and user + system CPU time", () => {
    const usage = emptyUsage("anthropic/claude-sonnet-5");
    const meter = { startedAt: 1_000, cpu: { user: 0, system: 0 } };

    chargeInvocation(usage, meter, 3_500, { user: 1_500_000, system: 500_000 });
    expect(usage).toMatchObject({ fnInvocations: 1, fnWallSeconds: 2.5, fnCpuSeconds: 2 });

    chargeInvocation(usage, meter, 2_000, { user: 250_000, system: 0 });
    expect(usage).toMatchObject({ fnInvocations: 2, fnWallSeconds: 3.5, fnCpuSeconds: 2.25 });
  });

  it("measures real process CPU time by default", () => {
    const usage = emptyUsage("anthropic/claude-sonnet-5");
    const meter = startMeter();
    chargeInvocation(usage, meter);
    expect(usage.fnCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(usage.fnWallSeconds).toBeGreaterThanOrEqual(0);
  });
});
```

Replace `tests/lib/metrics.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { computeCost, emptyUsage } from "@/lib/metrics";

const GB = 1024 ** 3;

describe("computeCost", () => {
  it("prices recognition and takes reasoning cost from the recorded LLM cost", () => {
    const u = { ...emptyUsage("anthropic/claude-sonnet-5"), audioSeconds: 120, llmInputTokens: 10_000, llmOutputTokens: 3_000, llmCostUsd: 0.05 };
    const c = computeCost(u);
    expect(c.recognition).toBeCloseTo(0.0086, 6);
    expect(c.reasoning).toBeCloseTo(0.05, 6);
    expect(c.speech).toBe(0);
    expect(c.total).toBeCloseTo(0.0586, 6);
    expect(c.perAudioMinute).toBeCloseTo(0.0293, 6);
  });

  it("prices Blob storage, operations, transfer and Vercel compute in iad1", () => {
    const u = {
      ...emptyUsage("anthropic/claude-sonnet-5"),
      audioSeconds: 60,
      blobAdvancedOps: 8,
      blobSimpleOps: 3,
      storedBytes: GB,
      blobTransferBytes: GB,
      fnInvocations: 3,
      fnWallSeconds: 3600,
      fnCpuSeconds: 1800,
    };
    const c = computeCost(u);
    expect(c.storage).toBeCloseTo(0.023, 9);
    expect(c.storageOps).toBeCloseTo((8 * 5 + 3 * (0.4 + 2)) / 1e6, 12);
    expect(c.egress).toBeCloseTo(0.05 + 0.06, 9);
    expect(c.compute).toBeCloseTo(0.5 * 0.128 + 1 * 2 * 0.0106 + (3 * 0.6) / 1e6, 9);
  });

  it("returns null per-minute cost when no audio was processed", () => {
    expect(computeCost(emptyUsage("anthropic/claude-sonnet-5")).perAudioMinute).toBeNull();
  });
});
```

In `tests/lib/runs/runs.test.ts` replace `expect(loaded?.usage.gcsClassA).toBe(1);` with:
```ts
    expect(loaded?.usage.blobAdvancedOps).toBe(1);
    expect(loaded?.usage.fnInvocations).toBe(1);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/runs/meter.test.ts tests/lib/metrics.test.ts tests/lib/runs/runs.test.ts`
Expected: FAIL — `@/lib/runs/meter` not found; metrics expectations differ (GCS/Cloud Run prices); `blobAdvancedOps` undefined.

- [ ] **Step 3: Replace the usage fields, prices and cost formula**

In `lib/types.ts` replace:
```ts
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
```
with:
```ts
  /** Blob put and list calls, including the browser's presigned PUT. */
  blobAdvancedOps: number;
  /** Blob reads, including the assumed playback's presigned GET. */
  blobSimpleOps: number;
  storedBytes: number;
  retentionDays: number;
  /** Bytes downloaded from Blob: the audio read for transcription plus one assumed playback. */
  blobTransferBytes: number;
  fnInvocations: number;
  /** Request durations; drive provisioned memory. */
  fnWallSeconds: number;
  /** Process CPU time during requests; drives Active CPU. */
  fnCpuSeconds: number;
  fnMemoryGb: number;
};
```

Replace `lib/pricing.ts` with:

```ts
/** List prices used for per-operation cost estimates. Free tiers and credits are ignored on purpose. */
export const PRICING = {
  checkedAt: "2026-09-17",
  deepgram: {
    nova3PerMinute: 0.0043,
    aura2Per1kChars: 0.03,
    source: "https://deepgram.com/pricing",
    note: "Pay-as-you-go, pre-recorded, English; speaker diarization and smart formatting included.",
  },
  llmFallback: {
    models: {
      "anthropic/claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "anthropic/claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
    } as Record<string, { inputPerMTok: number; outputPerMTok: number }>,
    source: "https://vercel.com/ai-gateway/models",
    note: "Used only when AI Gateway reports no cost for a generation. AI Gateway adds no markup to provider list prices.",
  },
  vercelFunctions: {
    activeCpuPerHour: 0.128,
    memoryGbHour: 0.0106,
    invocationsPerMillion: 0.6,
    memoryGb: 2,
    source: "https://vercel.com/docs/functions/usage-and-pricing",
    note: "Fluid compute in iad1, default 2 GB / 1 vCPU. Active CPU is not billed while waiting on I/O; provisioned memory is.",
  },
  vercelBlob: {
    storageGbMonth: 0.023,
    simpleOpsPerMillion: 0.4,
    advancedOpsPerMillion: 5,
    dataTransferPerGb: 0.05,
    source: "https://vercel.com/docs/pricing/regional-pricing/iad1",
    note: "Private store in iad1. put and list are advanced operations, reads are simple operations, del is free.",
  },
  vercelCdn: {
    edgeRequestsPerMillion: 2,
    fastOriginTransferPerGb: 0.06,
    source: "https://vercel.com/docs/pricing/regional-pricing/iad1",
    note: "Every blob read is an edge request; uncached reads also pay Fast Origin Transfer.",
  },
} as const;
```

Replace `lib/metrics.ts` with:

```ts
import { PRICING } from "@/lib/pricing";
import type { CostBreakdown, Usage } from "@/lib/types";

export function emptyUsage(model: string): Usage {
  return {
    audioSeconds: 0,
    llmModel: model,
    llmResolvedModel: null,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmAttempts: 0,
    llmCostUsd: 0,
    llmCostSource: "gateway",
    blobAdvancedOps: 0,
    blobSimpleOps: 0,
    storedBytes: 0,
    retentionDays: 30,
    blobTransferBytes: 0,
    fnInvocations: 0,
    fnWallSeconds: 0,
    fnCpuSeconds: 0,
    fnMemoryGb: PRICING.vercelFunctions.memoryGb,
  };
}

const GB = 1024 ** 3;

export function computeCost(u: Usage, p: typeof PRICING = PRICING): CostBreakdown {
  const { vercelFunctions: fn, vercelBlob: blob, vercelCdn: cdn } = p;
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  // Summed per attempt in lib/extract/llm.ts: Gateway-reported where available, list-price estimate otherwise.
  const reasoning = u.llmCostUsd;
  const storage = (u.storedBytes / GB) * blob.storageGbMonth * (u.retentionDays / 30);
  const storageOps =
    (u.blobAdvancedOps * blob.advancedOpsPerMillion + u.blobSimpleOps * (blob.simpleOpsPerMillion + cdn.edgeRequestsPerMillion)) / 1e6;
  // Reads bypass or miss the CDN cache (useCache: false, first playback), so Fast Origin Transfer applies too.
  const egress = (u.blobTransferBytes / GB) * (blob.dataTransferPerGb + cdn.fastOriginTransferPerGb);
  const compute =
    (u.fnCpuSeconds / 3600) * fn.activeCpuPerHour +
    (u.fnWallSeconds / 3600) * u.fnMemoryGb * fn.memoryGbHour +
    (u.fnInvocations / 1e6) * fn.invocationsPerMillion;
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

- [ ] **Step 4: Add the invocation meter**

Create `lib/runs/meter.ts`:

```ts
import type { Usage } from "@/lib/types";

export type Meter = { startedAt: number; cpu: NodeJS.CpuUsage };

export function startMeter(): Meter {
  return { startedAt: Date.now(), cpu: process.cpuUsage() };
}

/**
 * Charges one function invocation: wall time drives provisioned memory, process CPU time drives Active CPU.
 * The CPU figure includes other requests the same instance served meanwhile; demo traffic is sequential.
 */
export function chargeInvocation(
  usage: Usage,
  meter: Meter,
  now: number = Date.now(),
  cpuSinceStart: NodeJS.CpuUsage = process.cpuUsage(meter.cpu),
): void {
  usage.fnInvocations += 1;
  usage.fnWallSeconds += (now - meter.startedAt) / 1000;
  usage.fnCpuSeconds += (cpuSinceStart.user + cpuSinceStart.system) / 1e6;
}
```

- [ ] **Step 5: Account requests and Blob operations in runs and stages**

In `lib/runs/runs.ts`:
- Add `import { chargeInvocation, startMeter } from "@/lib/runs/meter";` after the `emptyUsage` import.
- In `create`, replace `const t0 = Date.now();` with `const meter = startMeter();` and replace
  ```ts
      run.usage.cloudRunRequests += 1;
      run.usage.cloudRunSeconds += (Date.now() - t0) / 1000;
  ```
  with `    chargeInvocation(run.usage, meter);`.
- In `get` and `getAudio`, replace `run.usage.gcsClassB += 1;` with `run.usage.blobSimpleOps += 1;`.
- In `save` and `putJson`, replace `run.usage.gcsClassA += 1;` with `run.usage.blobAdvancedOps += 1;`.

In `lib/runs/stages.ts`:
- Add `import { chargeInvocation, startMeter, type Meter } from "@/lib/runs/meter";` above the `lib/runs/runs` import.
- Replace:
  ```ts
  function accountRequest(run: Run, startedAt: number) {
    run.usage.cloudRunRequests += 1;
    run.usage.cloudRunSeconds += (Date.now() - startedAt) / 1000;
  ```
  with:
  ```ts
  function accountRequest(run: Run, meter: Meter) {
    chargeInvocation(run.usage, meter);
  ```
- Replace:
  ```ts
  function finalizeRun(run: Run, startedAt: number, pendingWrites: number): Metrics {
    accountRequest(run, startedAt);
    run.usage.gcsClassA += pendingWrites;
  ```
  with:
  ```ts
  function finalizeRun(run: Run, meter: Meter, pendingWrites: number): Metrics {
    accountRequest(run, meter);
    run.usage.blobAdvancedOps += pendingWrites;
  ```
- Replace both `const startedAt = Date.now();` with `const meter = startMeter();`, all five `accountRequest(run, startedAt)` with `accountRequest(run, meter)`, and all three `finalizeRun(run, startedAt,` with `finalizeRun(run, meter,`.
- Replace:
  ```ts
      run.usage.gcsClassA += 1; // the browser's PUT
      run.usage.storedBytes += bytes.byteLength;
      run.usage.egressBytes += bytes.byteLength; // assumption: the recording is played back once
  ```
  with:
  ```ts
      run.usage.blobAdvancedOps += 1; // the browser's presigned PUT
      run.usage.storedBytes += bytes.byteLength;
      // Downloaded twice: read above for transcription, and one assumed playback of the recording.
      run.usage.blobTransferBytes += 2 * bytes.byteLength;
      run.usage.blobSimpleOps += 1; // the assumed playback's presigned GET
  ```
- In `stageExtract` replace `run.usage.gcsClassB += 1;` with `run.usage.blobSimpleOps += 1;`.

In `lib/pipeline.ts` replace `{ ...emptyUsage(EXTRACT_MODEL), retentionDays: 0, vcpu: 0, memoryGib: 0 }` with `{ ...emptyUsage(EXTRACT_MODEL), retentionDays: 0, fnMemoryGb: 0 }`.

- [ ] **Step 6: Relabel the metrics panel**

In `app/components/MetricsView.tsx` replace:
```tsx
                <tr><th scope="row">Storage 30 days and operations</th><td className="num">{formatUsd(cost.storage + cost.storageOps)}</td><td /></tr>
                <tr><th scope="row">Egress</th><td className="num">{formatUsd(cost.egress)}</td><td className="muted">one playback</td></tr>
                <tr><th scope="row">Cloud Run compute</th><td className="num">{formatUsd(cost.compute)}</td><td /></tr>
```
with:
```tsx
                <tr><th scope="row">Blob storage 30 days and operations</th><td className="num">{formatUsd(cost.storage + cost.storageOps)}</td><td /></tr>
                <tr><th scope="row">Blob transfer</th><td className="num">{formatUsd(cost.egress)}</td><td className="muted">read for transcription and one playback</td></tr>
                <tr><th scope="row">Vercel compute</th><td className="num">{formatUsd(cost.compute)}</td><td className="muted">{usage.fnInvocations} invocations, {usage.fnCpuSeconds.toFixed(2)} s CPU, {usage.fnWallSeconds.toFixed(1)} s wall</td></tr>
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test && grep -rn "gcsClass\|cloudRun\|egressBytes\|vcpu\|memoryGib" lib app scripts tests --include=*.ts --include=*.tsx --include=*.mts`
Expected: all pass; grep prints nothing. Run `npm test` twice more; expected: no flaky failures.

- [ ] **Step 8: Check a local run end to end without paid calls**

Run `npm run dev` with `STORE_DRIVER=local`, upload `testset/invalid/video-renamed.mp3` in the browser. Expected: the run is rejected (`contains_video`) and the metrics panel shows "Vercel compute" with 2 invocations and "Blob storage 30 days and operations". Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: cost accounting for Vercel Functions, Blob and CDN in iad1

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Eval baseline through AI Gateway

**Prerequisite:** ask the user to put `AI_GATEWAY_API_KEY` into `.env.local` (Vercel dashboard → AI Gateway → API Keys). Do not proceed without it.

**Files:**
- Create: `eval/results/<stamp>.json`, `eval/results/<stamp>.md`

**Interfaces:**
- Consumes: `npm run eval` (`scripts/eval.mts`, Task 1 `--model` flag), `.env.local` keys.

- [ ] **Step 1: Ping the Gateway and confirm where cost is reported**

Run:
```bash
npx tsx --env-file=.env.local -e "import('ai').then(async ({ generateText }) => { const r = await generateText({ model: 'anthropic/claude-sonnet-5', prompt: 'Reply with OK', maxOutputTokens: 5, maxRetries: 0 }); console.log(r.text, JSON.stringify(r.providerMetadata?.gateway)); })"
```
Expected: `OK` followed by JSON containing `"cost":"<decimal>"`, `"generationId"` and `routing.finalProvider`. If it fails with 401/403, stop and tell the user the key is invalid or the team has no AI Gateway credits. If `cost` is absent, stop and report it: the spec's risk "Gateway response does not carry cost" has materialized and runs will show "estimated".

- [ ] **Step 2: Run the baseline**

Run: `npm run eval -- --runs=3`
Expected: 9 runs complete; `eval/results/<stamp>.md` is written and its header reads `anthropic/claude-sonnet-5 via AI Gateway (served by …; LLM cost source: gateway)`. Do not edit expectations or prompts before recording this run: it is the honest baseline for DELIVERY.md. If a failure reveals a genuine product bug (not an expectation disagreement), fix it in a separate commit with a regression test, rerun, and keep both result files.

- [ ] **Step 3: Commit**

```bash
git add eval/results
git commit -m "test: first measured eval baseline through AI Gateway

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: CI, Vercel deployment and smoke test

**Prerequisite:** ask the user for (a) the GitHub repository URL and confirmation to push, (b) confirmation they will do the Vercel dashboard steps below. Pushing and deploying are outward-facing: confirm before each.

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/smoke.mts`
- Modify: `package.json` (script `smoke`)

**Interfaces:**
- Consumes: `GET /api/health` → `{ ok, store }`; `POST /api/runs`; `GET /api/runs/:id/audio` (302); `GET /api/runs`; `DELETE /api/runs/:id`; `GET /api/cron/cleanup`.

- [ ] **Step 1: CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
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

- [ ] **Step 2: Smoke test script**

Create `scripts/smoke.mts`:

```ts
// Verifies a Vercel deployment without paid API calls: Blob driver, presigned PUT and GET, history, cron auth, deletion.
// Browser CORS for the presigned PUT is not covered here; check it with a real upload in the UI.
import { readFile } from "node:fs/promises";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) throw new Error("usage: npm run smoke -- https://<production-domain>");

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}

async function json<T>(res: Response): Promise<T> {
  check(res.ok, `${res.url} returned ${res.status}: ${await res.clone().text()}`);
  return (await res.json()) as T;
}

const health = await json<{ ok: boolean; store: string }>(await fetch(`${base}/api/health`));
check(health.store === "blob", `store driver is "${health.store}", expected "blob"`);

const audio = new Uint8Array(await readFile("testset/01-normal/audio.mp3"));
const created = await json<{ runId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
  await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: "smoke.mp3", sizeBytes: audio.byteLength, declaredType: "audio/mpeg" }),
  }),
);
check(created.upload.url.startsWith("https://"), `upload URL is not a presigned Blob URL: ${created.upload.url}`);

const put = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: audio });
check(put.ok, `presigned PUT returned ${put.status}: ${await put.text()}`);

const audioRoute = await fetch(`${base}/api/runs/${created.runId}/audio`, { redirect: "manual" });
check(audioRoute.status === 302, `audio route returned ${audioRoute.status}, expected a 302 to a presigned GET`);
const played = await fetch(audioRoute.headers.get("location")!);
check(played.ok, `presigned GET returned ${played.status}`);
check((await played.arrayBuffer()).byteLength === audio.byteLength, "downloaded audio size differs from the upload");

const history = await json<{ runs: { id: string }[] }>(await fetch(`${base}/api/runs`));
check(history.runs.some((r) => r.id === created.runId), "new run is missing from history");

const cron = await fetch(`${base}/api/cron/cleanup`);
check(cron.status === 401, `cron route without the secret returned ${cron.status}, expected 401`);

const deleted = await json<{ ok: boolean }>(await fetch(`${base}/api/runs/${created.runId}`, { method: "DELETE" }));
check(deleted.ok, "delete did not report ok");
const gone = await fetch(`${base}/api/runs/${created.runId}`);
check(gone.status === 404, `deleted run still returns ${gone.status}`);

console.log(`Smoke test passed for ${base}`);
```

In `package.json` scripts add `"smoke": "tsx scripts/smoke.mts"` after `"eval"`.

Run: `npm run typecheck && npm run lint && npx tsx scripts/smoke.mts`
Expected: typecheck and lint pass; the last command exits with `usage: npm run smoke -- https://<production-domain>`.

- [ ] **Step 3: Commit and push (after the user confirms)**

```bash
git add .github scripts/smoke.mts package.json
git commit -m "ci: PR checks workflow and Vercel deployment smoke test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git remote add origin <repository URL from the user>
git push -u origin main
git push -u origin feat/commitments-extractor
gh pr create --base main --head feat/commitments-extractor --title "Commitments extractor on Vercel with AI Gateway" --fill
gh run watch --exit-status
```
Expected: the PR's `ci` run (`checks`) succeeds. Do not merge yet: Vercel is connected in Step 4, and merging the PR there triggers the first production deployment.

- [ ] **Step 4: Vercel project setup (user performs, agent guides)**

Give the user these steps and wait for confirmation:
1. Vercel dashboard → Add New → Project → import the GitHub repository (framework preset: Next.js).
2. Storage → Create → Blob → access **Private**, region **Washington, D.C. (iad1)** → connect to the project for Production, Preview and Development (adds `BLOB_STORE_ID` and OIDC).
3. Settings → Environment Variables (Production and Preview): `STORE_DRIVER=blob`, `DEEPGRAM_API_KEY=<key>`, `EXTRACT_MODEL=anthropic/claude-sonnet-5`, `CRON_SECRET=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">`.
4. AI Gateway: make sure the team has AI Gateway enabled with credits; no key is needed on Vercel (OIDC).
5. Merge the PR (`gh pr merge --merge`, after the user confirms) → wait for the production deployment to be Ready; send the production domain.

- [ ] **Step 5: Run the smoke test against production**

Run: `npm run smoke -- https://<production-domain>`
Expected: `Smoke test passed for https://<production-domain>`. If the presigned PUT fails with 403, check that the Blob store is connected to the project (OIDC) and private. Use the production domain: preview deployments are behind Vercel Deployment Protection.

Run: `curl -s -H "Authorization: Bearer <CRON_SECRET>" https://<production-domain>/api/cron/cleanup`
Expected: `{"deleted":[]}`.

- [ ] **Step 6: End-to-end in the browser on the deployed demo**

At the production domain upload, in order: `testset/01-normal/audio.mp3`, `testset/02-changed/audio.mp3`, `testset/03-clarify/audio.mp3`, `testset/invalid/video-renamed.mp3`. For each record: report status, time to result, cost per operation and per audio minute (metrics panel), LLM cost source note, and whether ▶ plays the right segment for at least two quotes. The first upload also confirms browser CORS for the presigned PUT: if it fails in the browser but the smoke test passed, apply the spec fallback (`uploadPresigned` from `@vercel/blob/client` with a `handleUploadPresigned` route) as a separate task with the user's approval. Confirm all four runs appear in `/history` with event logs and play audio there. Record the numbers for DELIVERY.md.

---

### Task 7: README and delivery notes

**Files:**
- Modify: `README.md` (replace scaffold)
- Create: `DELIVERY.md`

**Interfaces:**
- Consumes: measurements from Task 5 (`eval/results/*.md`) and Task 6 Step 6, `testset/REVIEW.md`, `lib/pricing.ts`.

- [ ] **Step 1: Write README.md**

Replace `README.md` with:

````markdown
# Recorded conversation → final commitments

Upload a recorded project discussion (English, two speakers who introduce themselves, ≤ 3 minutes). The app returns the final agreed tasks, owners, deadlines and unresolved questions — each with a timestamped quote you can play — and keeps a shared history of every upload and what happened to it.

Demo: <Vercel production URL> · Walkthrough video: <link>

## How it works

1. The browser checks the file (size, real format by content, video track, duration) and uploads it straight to a private Vercel Blob store with a presigned URL.
2. `POST /api/runs/:id/transcribe` repeats the file checks on the stored bytes, transcribes with Deepgram Nova-3 (diarization, word timings) and declines out-of-scope input (not 2 speakers, too little speech, too long).
3. `POST /api/runs/:id/extract` asks the model selected by `EXTRACT_MODEL` (default Claude Sonnet 5) through Vercel AI Gateway for speakers, items and an event timeline with verbatim quotes, as structured output.
4. A deterministic verifier keeps only what the transcript supports: every quote must exist, timestamps come from Deepgram words, owners and deadlines need their own supporting quote, relative dates are flagged, disputed points become clarifications.
5. Everything is stored under `runs/<id>/` (audio, event log, transcript, report, raw API responses) and shown in History. A daily Vercel Cron deletes runs older than 30 days.

## Run locally

Requirements: Node 22, npm, ffmpeg (only for regenerating test audio/fixtures).

```bash
npm ci
cp .env.example .env.local   # fill DEEPGRAM_API_KEY and AI_GATEWAY_API_KEY; STORE_DRIVER=local
npm run dev                  # http://localhost:3000 — runs are stored in .data/
npm test                     # unit tests, no network
npm run fixtures             # regenerate testset/invalid (ffmpeg)
npm run synth                # regenerate test recordings (Deepgram Aura-2 + ffmpeg)
npm run eval -- --runs=3     # score the three test recordings → eval/results/
npm run eval -- --runs=3 --model=openai/gpt-6-astra   # same, with another AI Gateway model
```

## Deploy (GitHub → Vercel)

1. Import the repository in Vercel (Next.js preset).
2. Create a **private** Blob store in **iad1** and connect it to the project.
3. Environment variables: `STORE_DRIVER=blob`, `DEEPGRAM_API_KEY`, `EXTRACT_MODEL`, `CRON_SECRET`. AI Gateway authenticates with OIDC on Vercel.
4. Push to `main` → production deployment. Pull requests get preview deployments and the `ci` workflow (typecheck, lint, tests).
5. `npm run smoke -- https://<production-domain>` checks storage, presigned URLs, history, cron auth and deletion without paid API calls.

## Test set

`testset/01-normal`, `02-changed` (one agreement changed), `03-clarify` (nothing settled → needs clarification): `script.json` (source), `audio.mp3`, `offsets.json` (line timings), `expected.json` (approved before any run, see `testset/REVIEW.md`). `testset/invalid/` holds files that must be rejected (renamed video, text, too long/short, empty).

## Reused components vs own work

Reused: Next.js, React, AI SDK (`ai`, AI Gateway provider, structured output), Vercel AI Gateway, Vercel Blob SDK, Vercel Cron, zod, Deepgram REST API (Nova-3, Aura-2), `file-type`, `music-metadata`, Vitest, tsx, ffmpeg, GitHub Actions (`checkout`, `setup-node`).
Own: extraction prompt and schema, verifier, file validation rules, pipeline/run log/cost accounting, storage drivers, retention job, UI, eval harness, smoke test, test scripts and expectations.
````

- [ ] **Step 2: Write DELIVERY.md from recorded measurements**

Create `DELIVERY.md` with these sections, filled only with numbers and observations actually measured in Tasks 5 and 6 and earlier recorded work (write "not measured" where a number is missing — never estimate a measured quantity):

````markdown
# Delivery notes

## Links
Demo · Repository · Video (≤ 3 min)

## Sample inputs and expected vs actual
Per case (01-normal, 02-changed, 03-clarify): what the recording contains, the approved expectation (link `testset/*/expected.json`), and the actual result table from `eval/results/<stamp>.md` (status match, items found, field checks, must_not violations, extra active items, STT misses). Plus the file-rejection table: fixture → expected code → server result (vitest) → browser result (manual check).

## What failed
Every failing check from the eval "Failures by run" section and any manual check that failed, with the cause if known (STT vs extraction vs verifier) and whether it was fixed.

## Speed
Eval (local machine → APIs): median and max time per case and per stage.
Deployed demo: time to result for the three recordings (upload + all stages), from Task 6 Step 6.

## Cost per operation and per audio minute
Table per case from deployed runs: recognition, reasoning (LLM cost source: reported by AI Gateway / estimated), speech (0 — no speech output), Blob storage 30 days and operations, Blob transfer (transcription read and one playback), Vercel compute (invocations, CPU s, wall s), total, per audio minute.
Pricing assumptions: copy `lib/pricing.ts` values with sources and the check date; list-price basis (Hobby allowances and AI Gateway free credits not deducted); region iad1; function size 2 GB / 1 vCPU; Active CPU measured with `process.cpuUsage()` per request (sequential demo traffic); one playback per upload; LLM cost as reported by AI Gateway (no markup over provider list price).
Retries: number of LLM attempts observed and their share of cost.
Separate — hosting (fixed): Vercel plan fee (state the plan used), idle cost 0 on Fluid compute, one cron invocation per day.
Separate — CI: GitHub Actions minutes per run (from the workflow run).
Separate — one-time test preparation: Aura-2 synthesis cost printed by `npm run synth`.

## Time spent
Per task, actual hours.

## AI tools and models
- Claude Code with Claude Opus 5 (`claude-opus-5`) — design, plan, implementation.
- Claude Sonnet 5 (`anthropic/claude-sonnet-5` via Vercel AI Gateway) — extraction in the product; list any other model tried with `--model`.
- Deepgram Nova-3 — speech recognition in the product.
- Deepgram Aura-2 — synthesis of test recordings only.

## How AI output was checked (example)
The expected commitments lists were drafted by Claude from the scripts and reviewed by the user before any extraction run; corrections are in `testset/REVIEW.md` (quote one concrete correction here). In the product, every model claim passes the deterministic verifier; one concrete dropped/flagged item from a real run, with the reason shown in "Dropped by verifier".

## Unfinished / known limitations
List anything not done, plus: browser playback of some formats (e.g. Ogg in Safari) can be rejected by the client check although the server would accept it; relative dates are never resolved without an in-recording anchor (no meeting-date input by design); shared history has no access control (by brief: no accounts); Active CPU per operation is approximate under concurrent requests.

## What I would improve next
Two-pass extraction if eval shows final-state errors; a live-recorded (non-TTS) test case; optional meeting date input to resolve relative dates; per-user history; model comparison table across AI Gateway models.
````

- [ ] **Step 3: Final verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. Check that README commands match `package.json` scripts and that DELIVERY.md contains no unmeasured numbers.

- [ ] **Step 4: Commit and push (after the user confirms the push)**

```bash
git add README.md DELIVERY.md
git commit -m "docs: README and delivery notes with measured results

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```
