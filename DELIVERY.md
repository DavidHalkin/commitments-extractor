# Delivery notes

**Live demo:** https://commitments-extractor.vercel.app — behind an access code, sent separately.
**Repository:** https://github.com/DavidHalkin/commitments-extractor
**Video walkthrough:** linked in the submission email.

Upload a recorded discussion, get the commitments that survived it: tasks, owners, deadlines and the
questions nobody answered, each with the quote that proves it and a button to hear that moment. Not a
meeting summary — a proposal nobody accepted stays "not accepted", a cancelled task stays cancelled, a
corrected deadline shows only the correction, and an owner nobody agreed on stays empty.

## Sample inputs, expected and actual

The three recordings are synthetic (Deepgram Aura-2) so they can be shared. **Expectations were written
before the recordings existed** and are in `testset/*/expected.json`; the scorer never sees the model's
answer first. Last full measurement: `eval/results/20260917T225133Z.md`, 5 runs per case.

| Case | What it contains | Expected | Actual |
|---|---|---|---|
| `01-normal` | Accepted task with owner and deadline, proposal that is declined, deadline corrected Thursday → Friday, cancelled survey, task with no owner, unanswered question | `ok`, 6 items with exact statuses, owners, deadlines and flags | 2 of 5 runs completed (3 hit Gateway rate limits); both completed runs **82/82 field checks, 0 forbidden conclusions** |
| `02-changed` | The same conversation with one agreement changed: the survey is kept and Anna takes it | `ok`, the survey is `active` with owner Anna | 5/5 runs, **212 of 213 checks**, 0 forbidden conclusions |
| `03-clarify` | Nobody takes the report, the due date is postponed, the roadmap is only floated | `needs_clarification`, no active task, no invented owner or deadline | 5/5 runs, **10/10 checks**, 0 forbidden conclusions |

The scorer checks both directions: that real commitments are found, and that unsupported ones are
absent (`must_not` rules — "the demo must not have an owner", "the landing page must not be active").

Rejection fixtures (`testset/invalid/`) are asserted in the unit suite, file by file:

| Input | Expected | Actual |
|---|---|---|
| MP4 with a video track named `.mp3` / `.m4a`, WebM video | `contains_video` | matches |
| Text file named `.mp3` | `not_audio` | matches |
| WAV named `.mp3` | accepted — it really is audio | matches |
| 200-second MP3 / 1-second MP3 | `too_long` / `too_short` | matches |
| Empty file | `file_too_small` | matches |

Nothing is decided from the file name: the container is read from magic bytes, and MP4/M4A are also
scanned for an ISO-BMFF `hdlr` box with handler type `vide`.

## What failed

- **The first production deployment was broken.** Presigned uploads stored the audio at
  `runs/<id>/audio-TnLlRjOFzD…` while everything reads `runs/<id>/audio`: `put()` passes
  `addRandomSuffix: false`, the presign path did not, and there it defaults to true. The upload
  answered 200 and the run then failed with "the upload did not complete". Found by the smoke test on
  the first deploy, fixed in `222c534`, re-verified. Local development never saw it.
- **Model flakiness: 1 run in 15.** In `02-changed` #2 the client-demo item was dropped because its
  acceptance quote could not be verified. The item went missing rather than wrong, which is the
  failure direction I want, but it is a real miss.
- **AI Gateway free-tier rate limits.** 3 of 15 eval runs errored with the model refusing requests.
  Not accuracy: a single run alone succeeds on the first attempt. `--pause=30` between runs helps.
- **Speech recognition artifacts remain.** Deepgram renders "Great, thanks" as "Preet eggs" and once
  assigns Anna's "Right." to Mark at word level. Neither changed a commitment, because quotes are
  matched against the transcript and those words carry none.
- **Earlier, two `must_not` violations turned out to be a defect in my own scorer**, not the product:
  after turn merging, Mark's closing recap names two items in one utterance, so an anchor search over
  quotes bound the client-demo rule to the API-docs item. Fixed by binding anchored rules to the item
  the expectation matched. `testset/*/expected.json` was never edited to fit the model.

## Time spent

**10.7 hours** measured from 61 commits across 8 sessions (16–18 September 2026), grouping commits
into sessions with a 45-minute gap and adding 20 minutes of lead-in per session. Realistically
**12–13 hours**: research, waiting on eval runs and the production debugging left no commits. The
brief suggested eight. The overrun went into the eval harness, the verifier and the documentation.

## Tools, models and what is reused

| Layer | Exact tool | Mine or reused |
|---|---|---|
| Build assistant | Claude Code with Claude Opus 5 | Tool |
| Speech to text | Deepgram `nova-3`, diarization + utterances | Reused API; the word-level re-segmentation on top is mine |
| Reasoning | `openai/gpt-5-mini` through the Vercel AI Gateway | Reused API; prompt, schema and retry accounting are mine |
| Test audio | Deepgram Aura-2 (`aura-2-thalia-en`, `aura-2-apollo-en`) | Reused API; scripts and assembly are mine |
| Framework | Next.js 16, React 19 | Reused |
| Libraries | `zod`, `ai` (AI SDK 7), `file-type`, `music-metadata`, `@vercel/blob`, `vitest` | Reused |
| Everything else | Pipeline, gate, verifier, eval harness and scorer, cost model, UI, access gate | Mine |

`EXTRACT_MODEL` is an environment variable, so the model swaps in one line. The choice is argued in
`docs/decisions/2026-09-17-extraction-model.md`.

## How I checked the model's output — one worked example

On `03-clarify` the model returned an active task "Talk about the client report" with the deadline
"next week", taken from "Okay, let's pick this up next week." The eval scored it against the
expectations written beforehand and reported two `must_not` violations: an active item where none
should exist, and a deadline where none was agreed.

The fix was deterministic rather than a plea in the prompt: `isDeferral` in `lib/verify/text.ts`
recognizes postponement — a self-sufficient phrase ("pick this up", "come back to") or a
deciding/discussing verb with a postponing marker ("decide later", "talk about it another time") — and
such a quote now supports neither an acceptance nor a deadline. "I'll send it out later" is not a
deferral, and a test pins that boundary. After the change, `03-clarify` returns `needs_clarification`
in 5 of 5 runs with zero violations.

The same principle runs on every item: `lib/verify/` matches each quote against the transcript word by
word, rejects owner or deadline evidence that sits away from the item's own timeline, and drops any
item it cannot support. The model proposes; code decides what survives.

## Measured speed and cost

Measured, not promised. Per-run numbers come from the eval above and from a stored deployed-shape run.

| | 75-second recording | Per audio minute |
|---|---|---|
| Recognition (Deepgram `nova-3`) | $0.0054 | $0.0043 |
| Reasoning (`gpt-5-mini`, ~1.7k in / ~5k out) | $0.0091 | $0.0072 |
| Infrastructure (functions, Blob storage, operations, egress) | $0.0008 | $0.0006 |
| **Total** | **$0.0153** | **$0.0121** |

- **Time to a useful result:** 56–59 s median for a 75-second recording; extraction is over 90% of it,
  transcription about 2 s. A live production run of the 38-second case took **35.5 s and $0.0088**.
- **Retries** are counted, not hidden: every attempt is recorded on the run with its tokens and cost
  (`llmAttempts`). In the measured runs the model answered on the first attempt.
- **Speech synthesis** is not part of an operation. It built the test set once: 2,379 characters for
  **$0.0714** total, at $0.03 per 1,000.
- **Paid intermediaries:** the AI Gateway adds no markup and reports each generation's real cost, which
  the app stores rather than estimating. The list-price table is the fallback when it does not.

**Pricing assumptions.** All rates are list prices recorded in `lib/pricing.ts` with their sources and
the date they were checked (2026-09-17): Deepgram $0.0043/min and $0.03 per 1k characters, `gpt-5-mini`
$0.25/$2.00 per million tokens, Vercel Functions $0.128 per active-CPU-hour plus $0.0106 per GB-hour,
Blob $0.023 per GB-month, transfer $0.05/GB.

**Hosting is separate from usage.** The app fits Vercel's Hobby plan at $0/month, but Hobby is licensed
for personal, non-commercial use, so a client-facing deployment belongs on Pro at $20 per seat per
month, which includes $20 of usage credit this workload will not exhaust.

**Free credit is not zero cost.** Everything currently runs on it — Vercel Hobby, $5 a month of AI
Gateway credit ($4.74 of $5 left on 18 September), Deepgram's $200 new-account credit — and every
number above ignores that deliberately. At list price, a thousand one-minute recordings cost about $12
in API calls plus the $20 seat.

## Limits and what I would do next

Scope as briefed: English, two speakers who introduce themselves, audio up to three minutes, no
accounts, no calendar or task-tracker integration.

Not done, in the order I would do it: accept video and extract its audio track instead of rejecting it;
accept screenshots of chats through a vision model into the same contract; lift the three-minute and
two-speaker limits, which needs a queue because extraction holds a request for ~55 seconds; accounts
instead of one shared code; export into a calendar or tracker, without which a commitment stays text.
There is no rate limiting today — the access code's length is the only thing standing between a script
and the API credit.

More detail: [README.md](README.md) for setup and cost, [docs/how-it-works.md](docs/how-it-works.md)
for the pipeline, the rejection rules and the retention cron, and `docs/decisions/` for why the model
and the accuracy fixes are what they are.
