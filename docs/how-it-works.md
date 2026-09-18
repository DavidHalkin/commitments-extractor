# How it works

The whole product in one file: how a recording travels through the system, how the test recordings are
made and what they cost, what gets rejected and why, what the daily cron deletes, and which package
does what.

- [The path of one recording](#the-path-of-one-recording)
- [Making the test recordings](#making-the-test-recordings)
- [Running everything](#running-everything)
- [What gets rejected](#what-gets-rejected)
- [Retention and the daily cron](#retention-and-the-daily-cron)
- [Access code](#access-code)
- [What it costs](#what-it-costs)
- [What we actually pay today](#what-we-actually-pay-today)
- [Moving to GCP](#moving-to-gcp)
- [What the project uses](#what-the-project-uses)

## The path of one recording

Six stages. Each one records its own duration and cost into the run, which is why the report can show
where the time and the money went.

| # | Stage | Where | What happens |
|---|---|---|---|
| 1 | `upload` | `POST /api/runs` → `PUT` | The browser asks for an upload target and sends the bytes. With the Blob driver it PUTs straight to a presigned Vercel Blob URL, so the file never passes through a function. Locally it PUTs to `/api/runs/[id]/upload`. |
| 2 | `file-check` | `lib/gate/file-check.ts` | The stored bytes are sniffed and measured: real container, video track, duration. See [What gets rejected](#what-gets-rejected). |
| 3 | `transcribe` | `lib/stt/deepgram.ts` | Deepgram `nova-3` with diarization and utterances. The reply is re-segmented by word-level speaker and turns are rejoined across pauses under 0.8 s. |
| 4 | `precheck` | `lib/gate/precheck.ts` | Exactly two speakers with at least 5% of the words each, and at least 20 words in total. Otherwise the run is declined without spending anything on the model. |
| 5 | `extract` | `lib/extract/` | The transcript, one line per utterance with ids and timings, goes to the model through the Vercel AI Gateway. The answer must fit `ExtractionSchema` or it is retried once. |
| 6 | `verify` | `lib/verify/` | Every quote is matched against the transcript word by word. Unsupported, hedged or postponed items are dropped or flagged, and the report's status is decided here. |

The browser drives the work with two calls: `POST /api/runs/[id]/transcribe` runs stages 2–4 in one
request, `POST /api/runs/[id]/extract` runs stages 5–6. Each one saves the run before it answers, so a
page refresh never loses a run in progress; `lib/pipeline.ts` runs the same stages in one call for
the eval. Everything a run produced — audio, transcript, both raw provider responses, report — is kept
under `runs/<id>/`, so any number in the UI can be traced back to what the providers actually returned.

## Making the test recordings

The test set is synthetic on purpose: it can be shared, and the expected answers were written before
the recordings existed (`testset/*/expected.json`).

`testset/<case>/script.json` holds the dialogue, one line per turn, with a Deepgram Aura-2 voice per
speaker (`aura-2-thalia-en` for Anna, `aura-2-apollo-en` for Mark). Then:

```bash
npm run synth                 # all three cases
npm run synth -- 01-normal    # or just one
```

`scripts/synthesize.ts` speaks every line through Deepgram Aura-2, normalizes each to 24 kHz mono,
concatenates them with 0.4 s gaps into `audio.mp3` (MP3, 96 kbps), and writes `offsets.json` — the
start and end of every script line inside the finished file. The eval scorer needs those offsets to
check that a quote's timestamp really points at the line it claims.

It needs `ffmpeg` and `ffprobe` on PATH and `DEEPGRAM_API_KEY` in `.env.local`.

**Cost:** Aura-2 is $0.03 per 1,000 characters. The three scripts are 2,379 characters, so regenerating
the whole test set costs **$0.0714**, once. The audio is committed, so nobody has to pay it again to
run the tests.

Rejection fixtures are made the same way, without any API call:

```bash
npm run fixtures
```

`scripts/make-invalid-fixtures.ts` uses ffmpeg to build `testset/invalid/`: MP4 and WebM files with a
real video track saved under audio extensions, a WAV named `.mp3`, a 200-second file, a 1-second file,
a text file named `.mp3`, and an empty file.

## Running everything

```bash
npm install
cp .env.example .env.local    # DEEPGRAM_API_KEY and AI_GATEWAY_API_KEY at minimum
npm run dev                   # http://localhost:3000

npm test                      # 146 unit tests, no network
npm run typecheck
npm run lint
npm run build

npm run eval                  # end-to-end over testset/, real API calls
npm run eval -- --runs=5 --pause=30
npm run eval -- --render=eval/results/<stamp>.json   # re-score a stored run, free

npm run smoke -- https://<deployment>                # checks a deployment, no paid calls
```

Locally `STORE_DRIVER=local` writes runs to `.data/runs/<id>/`, so you can open any raw provider
response with a text editor. `--pause=30` exists because the free AI Gateway tier rate-limits each
model and back-to-back eval runs start failing without it.

## What gets rejected

The same three functions in `lib/gate/classify.ts` run twice: once in the browser
(`app/components/clientFileCheck.ts`) for instant feedback, and once on the server over the stored
bytes (`lib/gate/file-check.ts`), which is the check that actually counts. A renamed file cannot pass
the second one, because nothing is decided from the file name.

| Rule | Limit | How it is decided |
|---|---|---|
| Too small | < 1 KB | Byte length, before anything else |
| Too large | > 35 MB | Byte length, checked in the browser and again when the upload target is issued |
| Not audio | — | `file-type` reads the container's magic bytes. A text file named `.mp3` is detected as not audio; a WAV named `.mp3` is accepted as a WAV, because it really is audio |
| Contains video | — | Three independent signals: `music-metadata`'s `hasVideo`, any track with video info, and for MP4/M4A a scan for an ISO-BMFF `hdlr` box with handler type `vide`. A video file renamed to `.mp3` is caught by the container sniff or by the handler scan |
| Too short | < 3 s | Duration from `music-metadata` |
| Too long | > 3 min | Duration from `music-metadata`. The server allows 185 s against the browser's 180 s, so a file the browser measured as just under the limit is not rejected after it was uploaded |
| Unreadable | — | `music-metadata` cannot parse the bytes |
| Wrong number of speakers | ≠ 2 | After transcription: speakers holding at least 5% of the recognized words |
| Not enough speech | < 20 words | After transcription |

The first six rules cost nothing; the last two cost only the transcription, which is why they run
before the model is called. Every rejection is stored on the run with its code and the detail that
triggered it, so the history page explains what happened instead of showing a failure.

## Retention and the daily cron

Audio is the expensive thing to keep: Vercel Blob bills $0.023 per GB-month, and a demo that never
forgets would pay for every recording anyone ever tried, forever. So every run expires **30 days**
after it was created.

`vercel.json` schedules `GET /api/cron/cleanup` daily at 03:00 UTC. Vercel Cron sends
`Authorization: Bearer $CRON_SECRET`; without that header the route answers 401, and it stays outside
the access-code gate for exactly this reason. `lib/runs/cleanup.ts` reads the creation time out of the
run id itself (`20260917T134225Z-kpoo1c`), so deciding what is expired needs no reads at all, and then
deletes the whole `runs/<id>/` prefix — audio, transcript, raw responses and report together.

There is no cron locally. Call the route by hand if you want to see it work:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/cleanup
```

## Access code

Setting `APP_PASSWORD` puts the whole app behind a login form; leaving it unset keeps the app open.
The rules, the cookie and the two routes that stay public are described in the
[README](../README.md#access-code).

## What it costs

### One minute of audio, end to end

Measured, not estimated: the per-recording numbers come from `eval/results/20260917T225133Z.md` and a
stored deployed-shape run, divided by their audio length.

| Step | Per audio minute | Where the number comes from |
|---|---|---|
| Generating the audio (Aura-2 TTS) | **$0.0225** | Only for synthetic test material. 2,379 characters produced 3.17 minutes of speech, about 750 characters a minute at $0.03 per 1,000 |
| Transcription (Deepgram nova-3) | **$0.0043** | List price per audio minute |
| Processing (gpt-5-mini via AI Gateway) | **$0.0072** | $0.0091 measured on a 75.6 s recording. It follows the transcript, not the clock, so a dense minute costs more than a quiet one |
| Hosting per run (functions, Blob, egress) | **$0.0006** | Storage, operations, egress and function time measured on one run: $0.00077 for 75.6 s |
| **A real upload** | **~$0.0121** | Everything except the TTS, which only test recordings need |
| **A synthesized minute** | **~$0.0346** | The same, plus Aura-2 |

So a real one-minute recording costs about **1.2 cents**, and 1,000 of them about **$12**. Generating a
minute of test audio costs roughly twice as much as processing it.

### Hosting: Hobby versus Pro

| | Hobby | Pro |
|---|---|---|
| Plan fee | $0 | $20 per seat per month, including $20 of usage credit |
| Functions | 4 active-CPU hours included | Past the credit, $0.128 per active-CPU-hour plus $0.0106 per GB-hour of provisioned memory |
| Blob storage | 1 GB included | $0.023 per GB-month |
| Edge requests | 1M included | 10M included, then $2 per million |
| Fast data transfer | 100 GB included | 1 TB included, then $0.15 per GB |
| Allowed use | Personal, non-commercial | Commercial |

This workload is small against those allowances: one run spends 0.33 s of active CPU and stores about
1 MB for 30 days. The Hobby function allowance alone covers tens of thousands of runs, and its 1 GB of
Blob holds roughly a thousand recordings at a time. The reason to move to Pro is the licence rather
than the meter: Hobby is for personal, non-commercial projects, so a client-facing deployment belongs
on Pro, where the $20 fee arrives with $20 of usage credit this workload will not exhaust.

Synthesizing the whole test set is a separate one-time $0.0714, and `npm run smoke` costs nothing
because it never calls a paid API.

## What we actually pay today

**Nothing. Every account behind this project is running on free credit,** and it is worth being precise
about what that hides.

| Account | What is free | Measured state | What happens when it ends |
|---|---|---|---|
| Vercel Hobby | The plan and the allowances above | Far below every limit | Nothing stops. The licence, not the meter, is what forces Pro at $20 per seat per month |
| Vercel AI Gateway | $5 of credit a month | $4.74 of $5 left on 2026-09-18 | The credit covers about 550 extractions a month; after that $0.0072 per audio minute at the provider's list price, with no markup |
| Deepgram | $200 credit on a new account | Running on it | It covers about 46,500 audio minutes of nova-3; after that $0.0043 a minute |

The honest version: at this volume the credit is not the constraint — **the free tier's per-model rate
limit is**. Running the eval back to back already fails, with the model refusing requests, which is why
`--pause=30` exists. When the credits end, a thousand one-minute recordings cost about **$12 in API
calls plus $20 a month for the Pro seat**, and not a line of the code changes.

## Moving to GCP

Nothing in the pipeline is tied to Vercel except two seams, and both are already abstracted:
`ObjectStore` (`lib/store/`) and the two API routes the browser calls.

| Now | On GCP | Notes |
|---|---|---|
| Vercel Functions | Cloud Run service, container built from this repo | Next.js runs unchanged; `next start` behind Cloud Run |
| Vercel Blob | Cloud Storage bucket plus a `GcsStore` implementing `ObjectStore` | The interface already has `put`, `get`, `listDirs`, `deletePrefix`, `uploadTarget`, `downloadUrl`, and GCS signed URLs map onto the last two one to one |
| Vercel Cron | Cloud Scheduler calling the same `/api/cron/cleanup` with the same bearer token | Or a bucket lifecycle rule that deletes objects older than 30 days, which removes the endpoint altogether |
| AI Gateway | Keep it, call the provider directly, or move to Vertex AI | The Gateway is reachable from anywhere; only Vertex changes the model and its prices, so re-check them at the time |
| Deepgram | Unchanged | It is an HTTP API and knows nothing about the host |
| Environment variables | Secret Manager | Same names |

**What it would cost.** Tier 1 / us-central1, checked on 2026-09-18.

| Resource | Price | This workload |
|---|---|---|
| Cloud Run, request-based | $0.000024 per vCPU-second, $0.0000025 per GiB-second, $0.40 per million requests | About 0.33 CPU-seconds and 3 requests per run — well under a hundredth of a cent, and the always-free tier (180,000 vCPU-seconds, 360,000 GiB-seconds and 2M requests a month) absorbs it entirely |
| Cloud Storage Standard | $0.022 per GB-month; class A $0.05 per 1,000 operations, class B $0.004 per 10,000 | 1 MB for 30 days is $0.000022 a run, marginally cheaper than Blob |
| Cloud Scheduler | 3 jobs free a month | The cleanup job is free |
| Internet egress | Per Network Service Tiers | About 2 MB a run; check the current rate before quoting one |

The API costs do not move at all — they are Deepgram and the model, not the platform — and the platform
costs go from small to smaller, with no seat fee. The real trade is elsewhere: Vercel hands this app
preview deployments, a CDN and a cron for nothing, and on GCP you assemble them yourself.

**What scaling actually needs.** At this size neither platform is under strain. What gives way first,
in order:

1. **Provider rate limits**, which belong to Deepgram and the model, not to the host. Concurrency has
   to be bounded before anything else matters, on either platform.
2. **The extract stage holds a request open for about 55 seconds.** Fine while a person watches a
   progress bar, useless for batching. Past a handful of concurrent uploads this belongs in a queue —
   Cloud Tasks or Pub/Sub with a Cloud Run worker, the browser polling the run instead of holding the
   call open. The same shape is needed on Vercel.
3. **Storage growth**, which retention already bounds; a bucket lifecycle rule enforces it without any
   code at all.
4. **Cold starts.** Cloud Run charges by the hour for `min-instances` to avoid them; Vercel's fluid
   compute hides them. Only worth paying for once there is real traffic.

Recommendation: stay on Vercel while this is a demo — the free tier and the ops work you do not have to
do are worth more than the fraction of a cent per run that GCP would save. Move when the app needs a
queue, processing longer than a request, or data residency. When that day comes the only new code is
`GcsStore` and a worker entry point.

Prices above: [Vercel](https://vercel.com/pricing), [Deepgram](https://deepgram.com/pricing),
[Cloud Run](https://cloud.google.com/run/pricing), [Cloud Storage](https://cloud.google.com/storage/pricing).
The per-unit rates the app bills itself with live in `lib/pricing.ts` with their own `checkedAt` date.

## What the project uses

**Runtime dependencies**

| Package | Why it is here |
|---|---|
| `next` 16 | App Router serves both the UI and the API routes as one deployable; `proxy.ts` (the renamed middleware) runs the access-code gate |
| `react`, `react-dom` 19 | The UI: uploader, progress, timeline, commitment list |
| `ai` (AI SDK 7) | Talks to the Vercel AI Gateway and enforces the zod schema on the model's answer; carries back the Gateway's own cost report per generation |
| `zod` | `ExtractionSchema` — the shape the model must produce, and the parser that rejects anything else |
| `file-type` | Container detection from magic bytes, in the browser and on the server. This is what makes a renamed file useless |
| `music-metadata` | Duration and track information, including the video-track signals |
| `@vercel/blob` | Private object store in production: presigned PUT for uploads, presigned GET for playback, prefix delete for retention |

**Development**

| Package | Why it is here |
|---|---|
| `typescript`, `@types/*` | Types across the app, the library and the scripts |
| `vitest` | 146 unit tests over pure logic: gate, verifier, cost model, eval scorer, access code |
| `tsx` | Runs the TypeScript scripts (`synth`, `eval`, `smoke`, `fixtures`) with the `@/` alias |
| `eslint`, `eslint-config-next` | Lint rules matching this Next version |

**External tools and services**

| What | Used for | Price |
|---|---|---|
| Deepgram `nova-3` | Transcription with word timings and speaker labels | $0.0043 per audio minute |
| Deepgram Aura-2 | Text to speech for the test recordings only | $0.03 per 1,000 characters |
| Vercel AI Gateway | One endpoint and one API key for any model; reports the real cost of each generation | Provider list price, no markup |
| Vercel Blob, Functions, Cron | Storage, the app itself, the daily cleanup | See the README's cost section |
| `ffmpeg` / `ffprobe` | Local only: assembling the test recordings and the rejection fixtures | Free |

Every price above is a list price recorded in `lib/pricing.ts` together with its source and the date it
was checked.
