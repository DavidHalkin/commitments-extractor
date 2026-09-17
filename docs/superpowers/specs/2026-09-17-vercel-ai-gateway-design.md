# Vercel hosting and AI Gateway — design

Date: 2026-09-17. Amends `2026-09-16-commitments-extractor-design.md` (the "original spec"). Where the
two disagree, this document wins. Product behaviour, the extraction schema, the verifier, the test set
and the eval scoring are unchanged.

## 1. Why

- Hosting moves from Google Cloud Run to Vercel.
- The reasoning model is called through Vercel AI Gateway instead of the Anthropic API directly, so the
  model (and provider) is a configuration choice, not a code change.
- Deepgram stays a directly called service (`DEEPGRAM_API_KEY`).

The original Task 14 (container, GCP infrastructure, GitHub Actions deploy) had not started, so no
deployed infrastructure is thrown away.

## 2. Decisions

| Topic | Decision |
|---|---|
| Hosting | Vercel, Next.js on Fluid compute, region `iad1` for functions and the Blob store |
| Reasoning client | AI SDK 7 (`ai` package), `generateText` + `Output.object` with the existing zod `ExtractionSchema` |
| Model selection | `EXTRACT_MODEL` env var holding an AI Gateway model id; default `openai/gpt-5-mini` (free AI Gateway tier refuses Claude Sonnet 5; see `docs/decisions/2026-09-17-extraction-model.md`) |
| Gateway auth | OIDC on Vercel deployments; `AI_GATEWAY_API_KEY` locally and for `npm run eval` |
| Storage | One private Vercel Blob store (`iad1`); `STORE_DRIVER=blob` in production, `local` for development and tests |
| Browser upload | Presigned `PUT` URL (`issueSignedToken` + `presignUrl`), size capped at 35 MB by the URL |
| Playback | Presigned `GET` URL (15 minutes), same redirect route as before |
| Retention | Vercel Cron, daily, deletes runs older than 30 days (Blob has no lifecycle rules) |
| Deploy | Vercel Git integration: preview deployment per pull request, production from `main` |
| CI | GitHub Actions `ci.yml` only: `npm ci`, typecheck, lint, vitest |
| Removed | `@anthropic-ai/sdk`, `@google-cloud/storage`, `lib/store/gcs.ts`, `output: "standalone"`, planned Dockerfile / `infra/setup.sh` / WIF / `deploy.yml` |

## 3. Architecture and data flow

```
Browser                              Vercel Function (Next.js, iad1)          External
1. POST /api/runs {fileName,size} ─► run.json (status: created)
                                     issueSignedToken(put, runs/<id>/audio, max 35 MB)
                                     → presignUrl(put)
   ◄──────────────────────────────── {runId, upload: {url, method: PUT, headers}}
2. PUT file ───────────────────────────────────────────────────────────────► Vercel Blob (private)
3. POST /api/runs/:id/transcribe ──► get(audio) → server file check → bytes ► Deepgram
                                     transcript.json, raw/deepgram.json, precheck
4. POST /api/runs/:id/extract ─────► generateText(EXTRACT_MODEL) ───────────► AI Gateway → provider
                                     raw/llm.json, verify → report.json, status done
5. History: GET /api/runs/:id/audio → 302 to a presigned GET URL (15 min)
Daily 03:00 UTC: Vercel Cron → GET /api/cron/cleanup → delete runs/<id>/ older than 30 days
```

- Stage endpoints, idempotency by status, the run log and the UI flow are unchanged.
- `maxDuration = 120` stays on `/transcribe` and `/extract`.
- The client code already PUTs to whatever `upload` target the server returns, so it does not change.
- Risk: the browser `PUT` to a presigned Blob URL must pass CORS. The first smoke test checks it. Fallback:
  `uploadPresigned` from `@vercel/blob/client` with a `handleUploadPresigned` route.

### 3a. Storage driver `lib/store/blob.ts`

`BlobStore` implements the existing `ObjectStore` interface, so `Runs`, stages and routes do not change.

| Method | Implementation |
|---|---|
| `put` | `put(key, data, { access: "private", contentType, allowOverwrite: true, addRandomSuffix: false })` |
| `get` | `get(key, { access: "private", useCache: false })`; `null` when not found. `useCache: false` because `run.json` is overwritten after every stage and the CDN may serve a version up to 60 s old otherwise |
| `listDirs` | `list({ prefix, mode: "folded" })`, paginated by `cursor`; returns folder names without the prefix |
| `deletePrefix` | `list({ prefix })` paginated, `del(urls)` per page |
| `uploadTarget` | `issueSignedToken({ pathname: key, operations: ["put"], maximumSizeInBytes, validUntil: now + 15 min })`, then `presignUrl(token, { operation: "put", pathname: key, access: "private", maximumSizeInBytes, allowOverwrite: true, validUntil })` (the uploader reuses the URL when retrying a failed PUT); returns `{ url, method: "PUT", headers: { "Content-Type": contentType } }` |
| `downloadUrl` | `issueSignedToken({ pathname: key, operations: ["get"], validUntil: now + 15 min })`, then `presignUrl(..., { operation: "get", access: "private" })` |

- `getStore()` selects `BlobStore` for `STORE_DRIVER=blob`, `LocalStore` otherwise.
- The local `PUT /api/runs/:id/upload` route stays for the `local` driver and returns 404 for `blob`.
- Blob credentials: OIDC plus `BLOB_STORE_ID` on Vercel (added when the store is connected to the
  project); `BLOB_READ_WRITE_TOKEN` or `vercel env pull` locally.

### 3b. Retention cron

- `vercel.json`: `{ "regions": ["iad1"], "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }] }`.
- `GET /api/cron/cleanup` returns 401 unless `Authorization: Bearer ${CRON_SECRET}` matches.
- The run's creation time comes from its id (`20260916T132501Z-ab12cd`), so no run.json read is
  needed. Runs older than 30 days are removed with `deletePrefix("runs/<id>/")`. The response lists
  deleted ids.
- Pure selection logic (`expiredRunIds(ids, now, days)`) is unit-tested; the route is covered by the
  smoke test.

## 4. Extraction through AI Gateway

`lib/extract/claude.ts` is renamed `lib/extract/llm.ts`. Its contract is unchanged:
`extractCommitments(transcript, deps?)` returns `{ extraction, attempts }` or throws `ExtractionError`
carrying every attempt.

```ts
const res = await generate({
  model: EXTRACT_MODEL,
  instructions: SYSTEM_PROMPT,
  prompt: renderTranscript(transcript),
  output: Output.object({ schema: ExtractionSchema }),
  maxOutputTokens: 16000,
  maxRetries: 0,
});
```

- `generate` defaults to `generateText`; tests inject a `vi.fn()` with the same signature.
- **Retries** stay in our loop: at most 2 attempts. Retried: truncated output, invalid JSON, schema
  mismatch (`NoObjectGeneratedError`), network and 5xx/429 errors. Not retried: HTTP 400, 401, 403, 404.
  `maxRetries: 0` keeps the AI SDK from issuing unrecorded paid retries.
- **Attempt record** `LlmAttempt`: `ok`, `finishReason`, `inputTokens`, `outputTokens`,
  `costUsd: number`, `costSource: "gateway" | "estimated" | "unknown"`, `model` (the serving
  `routing.finalProvider/resolvedProviderApiModelId` reported by the Gateway, falling back to the
  response model id), `generationId`, `error`, `raw`. A failed parse still records usage from
  `NoObjectGeneratedError.usage`. An attempt with no response records 0 tokens and cost 0.
- **Cost** per attempt: `providerMetadata.gateway.cost`, a decimal string the Gateway returns with every
  generation (provider list price, no Gateway markup; confirmed in the AI Gateway docs and the
  `ai@7.0.105` types). When it is absent (for example `NoObjectGeneratedError`, which carries no
  provider metadata), cost = tokens × `PRICING.llmFallback` with `costSource: "estimated"`, or 0 with
  `"unknown"` when the model is not in that table. No separate `getGenerationInfo` call.
- The schema needs no change: every field is required and optional values are `.nullable()`, which
  both Anthropic and OpenAI strict structured output accept.
- Stored raw file `raw/claude.json` becomes `raw/llm.json`; the `?raw=1` API key becomes `llm`. There
  are no production runs to migrate.
- Events: `extract started` shows the requested model; `extract finished` shows the resolved model.

## 5. Speed and cost measurement

Replaces the infrastructure part of original spec §8. Recognition and speech are unchanged.

### 5a. Usage fields (`lib/types.ts`)

| Old | New |
|---|---|
| `claudeModel`, `claudeInputTokens`, `claudeOutputTokens`, `claudeAttempts` | `llmModel`, `llmInputTokens`, `llmOutputTokens`, `llmAttempts`, plus `llmResolvedModel` (string or null), `llmCostUsd`, `llmCostSource` (least reliable source across attempts) |
| `gcsClassA` | `blobAdvancedOps` (`put`, `list`) |
| `gcsClassB` | `blobSimpleOps` (`get`, presigned GET fetch) |
| `egressBytes` | `blobTransferBytes` (audio read for transcription plus one assumed playback) |
| `cloudRunRequests` | `fnInvocations` |
| `cloudRunSeconds` | `fnWallSeconds` (request duration, drives provisioned memory) |
| — | `fnCpuSeconds` (`process.cpuUsage()` delta over the request, user + system) |
| `vcpu`, `memoryGib` | `fnMemoryGb` (2, the Fluid default) |
| `storedBytes`, `retentionDays` | unchanged |

`fnCpuSeconds` is an approximation: with in-function concurrency the process counter includes other
requests served in the same window. For a demo with one request at a time it is accurate; the
assumption is stated in `DELIVERY.md`.

### 5b. Prices (`lib/pricing.ts`, checked 2026-09-17, region iad1)

| Item | Price | Source |
|---|---|---|
| Deepgram Nova-3 | $0.0043 / min | deepgram.com/pricing (unchanged) |
| LLM | as reported by AI Gateway; fallback table for `anthropic/claude-sonnet-5` ($2 / $10 per MTok) and `anthropic/claude-opus-5` ($5 / $25) | vercel.com/ai-gateway/models |
| Fluid Active CPU | $0.128 / hour | vercel.com/docs/functions/usage-and-pricing |
| Fluid Provisioned Memory | $0.0106 / GB-hour | same |
| Function invocations | $0.60 / million | same |
| Blob storage | $0.023 / GB-month | vercel.com/docs/pricing/regional-pricing/iad1 |
| Blob simple operations | $0.40 / million | same |
| Blob advanced operations | $5.00 / million | same |
| Blob data transfer | $0.05 / GB | same |
| Edge requests | $2.00 / million | same |
| Fast Origin Transfer | $0.06 / GB | same |

### 5c. Cost breakdown

- `recognition` = audio minutes × Nova-3.
- `reasoning` = sum of attempt costs (`llmCostUsd`); the UI notes `llmCostSource`.
- `speech` = 0 (the product does not synthesize speech).
- `storage` = stored GB × $0.023 × `retentionDays` / 30.
- `storageOps` = advanced ops × $5/M + simple ops × $0.40/M. `del` is free.
- `storageOps` includes one edge request ($2/M) per simple operation (every blob read is an edge request).
- `egress` = transfer bytes × (Blob data transfer + Fast Origin Transfer); reads use `useCache: false`
  or are a first playback, so they miss the CDN cache.
- `compute` = CPU seconds × $0.128/3600 + wall seconds × 2 GB × $0.0106/3600 + invocations × $0.60/M.
- Free allowances (Hobby quotas, Gateway free credits) are costed at list price.
- Hosting reported separately in `DELIVERY.md`: Vercel plan fee, idle cost (0 on Fluid), daily cron
  invocation (one function call per day, independent of operations). CI: GitHub Actions minutes.

### 5d. UI

`MetricsView` shows "LLM" with the resolved model and attempts, an "estimated" note when applicable,
and "Vercel compute" instead of "Cloud Run compute".

## 6. Evaluation

- `npm run eval -- --runs=3 [--model=<gateway model id>]`. `--model` overrides `EXTRACT_MODEL` for the run.
- Reads `AI_GATEWAY_API_KEY` and `DEEPGRAM_API_KEY` from `.env.local`.
- The results header names the requested and resolved model. Cost columns use Gateway-reported cost.
- The baseline run (original plan Task 13 step 6) uses `anthropic/claude-sonnet-5`. Comparing other
  models is optional and reported only if run.

## 7. Deploy, CI and setup

- `.github/workflows/ci.yml`: on pull request and push — `npm ci`, `npm run typecheck`, `npm run lint`,
  `npm test`.
- Vercel project setup (README):
  1. Import the GitHub repository in Vercel.
  2. Create a private Blob store in `iad1` and connect it to the project (adds `BLOB_STORE_ID` and OIDC).
  3. Environment variables: `STORE_DRIVER=blob`, `DEEPGRAM_API_KEY`, `EXTRACT_MODEL`, `CRON_SECRET`.
  4. Enable AI Gateway for the team (OIDC needs no key).
  5. Push to `main` → production deployment.
- Local: `.env.local` with `STORE_DRIVER=local`, `DEEPGRAM_API_KEY`, `AI_GATEWAY_API_KEY`, `EXTRACT_MODEL`.
- `.env.example` updated accordingly; `ANTHROPIC_API_KEY` and `GCS_BUCKET` removed.

### 7a. Smoke test after the first production deploy

1. Upload `testset/01-normal/audio.mp3` in the browser: presigned PUT succeeds (CORS), report renders.
2. Open the run from History: audio plays through the presigned GET redirect.
3. Delete the run: objects are gone from the store.
4. `GET /api/cron/cleanup` without the secret → 401; with it → 200 and an empty or correct deleted list.
5. The run's metrics show a Gateway cost (not estimated) and non-zero Vercel compute.

## 8. Testing

- `tests/lib/extract/llm.test.ts` (replaces `claude.test.ts`): success with Gateway cost and serving
  provider; estimated cost without Gateway metadata; truncated then success with both attempts' tokens;
  two failures preserve usage; 401 not retried; 429 retried; unpriced model gives `"unknown"`.
- `tests/lib/runs/meter.test.ts`: wall and CPU accounting with injected readings (Windows `cpuUsage`
  resolution is about 15 ms, so no assertion that a measured value is positive).
- `tests/lib/store/blob.test.ts`: `BlobStore` against a mocked `@vercel/blob` module — overwrite and
  `useCache: false` flags, folded listing with pagination, prefix delete across pages, presigned URL
  options (size cap, operation, expiry).
- `tests/lib/runs/cleanup.test.ts`: `expiredRunIds` boundaries (exactly 30 days, malformed ids ignored).
- `tests/lib/metrics.test.ts`: rewritten for the new usage fields and prices.
- Existing runs/stages tests: renamed fields only.

## 9. Changes to existing documents

- The original spec gets a note at the top pointing here; its Cloud Run/GCS text (§2, §3, §3a, §3b,
  §8, §9, §10) is kept as history of the earlier decision.
- A new implementation plan covers this migration; the original plan's Task 13 step 6 onward and
  Tasks 14–15 are superseded by it.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Presigned Blob PUT blocked by CORS in the browser | Smoke test step 1; fallback `uploadPresigned` + `handleUploadPresigned` |
| Stale `run.json` read from the CDN breaks stage idempotency | `get(..., { useCache: false })` for every store read |
| Gateway response does not carry cost | Token-price estimate flagged in the UI; the plan's first Gateway ping confirms `gateway.cost` before the eval |
| Another provider's structured output behaves differently | Schema already strict-mode compatible; eval with `--model` exposes it |
| Hobby plan is for non-commercial use | Demo only; plan choice and its fee are stated in `DELIVERY.md` |
| `process.cpuUsage()` over-counts under concurrent requests | Stated as an assumption; demo traffic is sequential |
