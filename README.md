# commitments-extractor

Upload a recorded project discussion, get back the commitments that survived it: the tasks, who owns
them, when they are due, and the questions nobody answered — each with the quote that proves it and a
button to hear that moment.

It is deliberately not a meeting summary. A proposal nobody accepted stays "not accepted", a cancelled
task stays cancelled, a deadline that was corrected shows only the correction, and an owner nobody
agreed on stays empty. When the recording settles nothing, the report says so instead of inventing
work.

Scope: one language (English), two speakers who introduce themselves, audio up to 3 minutes.

**[DELIVERY.md](DELIVERY.md)** is the submission summary: sample inputs with expected against actual
results, what failed, time spent, the exact models and one worked example of how their output was
checked, and the measured speed and cost.

**[docs/how-it-works.md](docs/how-it-works.md)** walks the whole thing end to end: the six stages of a
run, how the test recordings are made and what they cost, every rule that rejects an upload, what the
daily cron deletes, and what each package is for.

## What it uses and why

| Piece | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript | One deployable for the UI and the API routes; runs on Vercel with no extra infrastructure |
| Speech to text | Deepgram `nova-3` | Word-level timestamps and speaker labels in one call — both are load-bearing here: quotes need timings, owners need speakers |
| Reasoning | `openai/gpt-5-mini` through the Vercel AI Gateway | Schema-enforced JSON output, and the model is swappable with one env var. See `docs/decisions/2026-09-17-extraction-model.md` |
| Schema | zod + AI SDK structured output | The model's answer is parsed into a typed shape or rejected |
| Storage | Vercel Blob in production, the local filesystem in development | Same `ObjectStore` interface both ways, so nothing about the pipeline changes between them |
| Tests | Vitest | Pure units for the gate, the verifier and the scorer; no browser needed |

The model is never trusted on its own. Everything it returns goes through a deterministic verifier
(`lib/verify/`) that matches every quote against the transcript word by word, rejects hedged or
postponed "agreements", and drops any item it cannot support. See
`docs/decisions/2026-09-18-extraction-accuracy.md`.

## Running it

Requires Node 22+.

```bash
npm install
cp .env.example .env.local     # fill in the two keys below
npm run dev                    # http://localhost:3000
```

| Variable | Needed for | Notes |
|---|---|---|
| `DEEPGRAM_API_KEY` | always | Pay-as-you-go key from deepgram.com |
| `AI_GATEWAY_API_KEY` | local runs and `npm run eval` | Deployments on Vercel authenticate with OIDC instead |
| `EXTRACT_MODEL` | optional | Any AI Gateway model id; default `openai/gpt-5-mini` |
| `STORE_DRIVER` | optional | `local` (default, writes to `.data/runs/`) or `blob` |
| `BLOB_READ_WRITE_TOKEN` | `STORE_DRIVER=blob` outside Vercel | Or run `vercel env pull` |
| `APP_PASSWORD` | optional | A long access code. Set it and the whole app sits behind a login form; leave it unset and the app is open, as it is by default |
| `CRON_SECRET` | production | Bearer token Vercel Cron sends to `/api/cron/cleanup` |

### Access code

With `APP_PASSWORD` set, `proxy.ts` (Next 16's name for middleware) stops every request that carries no
session and sends pages to `/login` and API calls to a `401`. A correct code sets an http-only cookie
for 30 days holding an HMAC of the code, never the code itself, so changing the code ends every
session that was handed out under the old one. Two routes stay open by design: `/api/health`, which
returns nothing but a status, and `/api/cron/cleanup`, which Vercel Cron authenticates with
`CRON_SECRET` and which would otherwise stop running. What protects you here is the length of the
code: the comparison is constant-time, but there is no rate limiting — per-instance counters do not
work on serverless. Against a protected deployment, `npm run smoke` signs in first when `APP_PASSWORD`
is in its environment.

## Architecture

A run moves through six stages, each recorded with its own timing and cost:

```
upload → file-check → transcribe → precheck → extract → verify
         format, duration,         2 speakers,  LLM      quotes matched to
         no video track            enough speech         the transcript
```

```
proxy.ts            the access-code gate, when APP_PASSWORD is set
app/
  login/            the access-code form
  api/login/        checks the code and issues the session cookie
  api/runs/…        upload target, transcribe, extract, audio, delete
  api/cron/cleanup  daily deletion of runs past their 30-day retention
  components/       upload, progress, timeline, commitment list
  history/          run list and a single run's report
lib/
  auth/             access-code gate: session token, public paths
  gate/             file checks and the two-speaker precheck
  stt/              Deepgram call and speaker re-segmentation
  extract/          system prompt, zod schema, Gateway client
  verify/           quote matching, deferral and hedge lexicons, flags
  runs/             run records, retention
  store/            local filesystem and Vercel Blob drivers
  pricing.ts        list prices; metrics.ts turns usage into cost
testset/            3 recordings with expectations written before testing
eval/results/       scored runs of that test set
```

A run's audio, transcript, raw provider responses and report are all kept under `runs/<id>/`, so any
number in the UI can be traced back to what the providers actually returned.

## Tests and evaluation

```bash
npm test          # 146 unit tests
npm run typecheck
npm run lint
npm run eval      # end-to-end against testset/, costs real API calls
```

`npm run eval -- --runs=5 --pause=30` scores every case several times and writes a report to
`eval/results/`. It checks that real commitments are found *and* that unsupported ones are absent,
and it never edits `testset/*/expected.json` to match the model. Add `--render=<results.json>` to
re-score and re-render a stored run without spending anything.

Latest: of 12 completed runs, 11 passed every check with no forbidden conclusion
(`eval/results/20260917T225133Z.md`).

## Cost

**Per recording.** Measured over the eval above, on a 75-second recording:

| Item | Cost |
|---|---|
| Deepgram `nova-3`, $0.0043/min | $0.0054 |
| `gpt-5-mini` reasoning, ~1.7k in / ~5k out tokens | $0.0091 |
| Blob storage, ops, egress and function time | ~$0.0008 |
| **Total** | **~$0.015 per recording, ~$0.012 per audio minute** |

That is roughly **$15 per 1,000 recordings**. Speed: 56–59 s median for a 75-second recording, of
which extraction is over 90%; transcription takes about 2 s.

Longer recordings cost more in both parts: transcription is linear in audio minutes, reasoning grows
with the transcript. The 3-minute maximum was not measured — take ~$0.03 as an estimate, not a
promise.

**Hosting.** The app fits Vercel's Hobby plan at $0/month; everything above is usage billed by the
providers. On a paid plan the same work is billed per use: functions from $0.128/active-CPU-hour plus
$0.0106/GB-hour of provisioned memory, Blob at $0.023/GB-month, egress at $0.05/GB. Audio dominates
storage: a 1 MB recording kept the full 30 days costs $0.000023, so 1,000 of them cost about
two cents. Prices are in `lib/pricing.ts` with their sources and the date they were checked.

**Free tiers are not zero.** The Vercel AI Gateway grants $5 of credit a month, which covers roughly
500 extractions, but its per-model rate limit — not the credit — is what you hit first when running
the eval back to back. Every number above is a list price, with free credit deliberately ignored.

Every account behind this project is on free credit today, and Hobby is licensed for personal,
non-commercial use, so a client-facing deployment belongs on Pro. The per-audio-minute breakdown,
Hobby against Pro, what each free tier covers and what a full move to GCP would cost are in
[docs/how-it-works.md](docs/how-it-works.md#what-it-costs).

## Limits

Audio only (video is rejected), 1 KB to 35 MB, 3 seconds to 3 minutes, exactly two speakers who say
their names. Runs are deleted 30 days after they are created. There are no accounts: everyone who
reaches the app — everyone with the access code, or everyone at all when none is set — sees the same
uploads.
