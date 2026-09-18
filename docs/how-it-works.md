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

One 75-second recording costs about **$0.015** end to end, roughly **$15 per 1,000 recordings**, and
the app itself fits Vercel's Hobby plan at $0/month. The measured breakdown, the hosting rates and the
note about free credit are in the [README](../README.md#cost). Synthesizing the test set is a separate
one-time $0.0714, and `npm run smoke` costs nothing because it never calls a paid API.

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
