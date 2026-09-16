# Recorded Conversation → Final Commitments — Design

Date: 2026-09-16
Source brief: `TS.md`

## 1. Goal

A browser app where a user uploads a recorded project discussion (English, two speakers who
introduce themselves, ≤ 3 minutes) and receives the **final state** of agreed tasks, owners,
deadlines and unresolved questions. Every task, owner, deadline and unresolved question carries its
own timestamped verbatim supporting quotation the user can play back. It is a commitments list, not a meeting summary.

Hard rules from the brief:

- Keep only the final state of each commitment (corrections and cancellations applied).
- Never turn "we could" into "we will"; never show a cancelled task as active.
- Never infer an owner or deadline that was not agreed.
- Relative dates that cannot be resolved from the recording keep their wording and are flagged
  `date_context_missing`.
- Where the recording does not settle an agreement, the product does not conclude it: the item is
  reported as needing clarification, and the whole input is declined when no reliable list is
  possible.

Out of scope: calendar integration, sending tasks, accounts, microphone recording in the app,
languages other than English, overlapping speech, asking the user for the meeting date.

## 2. Decisions

| Topic | Decision |
|---|---|
| Speech-to-text | Deepgram Nova-3 (pre-recorded API, `diarize`, `utterances`, `smart_format`, `punctuate`, `language=en`) |
| Reasoning | Claude Sonnet 5 (`claude-sonnet-5`) via tool use with a strict JSON schema, one pass |
| Reliability | Deterministic server-side verifier: quotes, timestamps, owners, deadlines checked against the transcript |
| Ambiguity | Item flags + explicit clarification list (`needs_clarification`) + `declined` result with reasons; no interactive dialogue |
| Stack / hosting | Next.js (App Router, TypeScript) on Vercel; Vercel Blob for client uploads |
| Test audio | Scripts voiced with Deepgram Aura-2 (two voices), stitched with ffmpeg |
| Test scoring | Deterministic eval script; expectations drafted from the scripts, reviewed and corrected by the user before the first run; no LLM judge |

## 3. Architecture and data flow

```
Browser                              Vercel functions                   External
1. Pick/drop file (mp3/wav/m4a/webm/ogg)
   client file check (fast feedback): size, duration,
   video track, real format — see §5a
2. Upload directly to Vercel Blob ──► POST /api/upload (client token,
                                      max size + allowed types enforced)
3. POST /api/transcribe {blobUrl} ──► fetch bytes from Blob
                                      server file check (authoritative, §5a)
                                      send bytes to Deepgram ─────────► Deepgram
                                      normalize → Transcript
                                      precheck (may decline)
                                      delete blob (also on rejection)
4. POST /api/extract {transcript} ──► Claude tool call ──────────────► Anthropic
                                      verify → Report
5. Render report; playback from the local file (object URL), seeking to quote start/end
```

Two endpoints instead of one so the UI shows per-stage progress and each stage is timed
separately; each function stays well inside Vercel duration limits (`maxDuration` 60 s).
API keys live only in server environment variables.

### Modules (`lib/`, pure where possible, unit-testable)

| Module | Responsibility |
|---|---|
| `lib/types.ts` | `Transcript`, `Extraction`, `Report`, `Metrics` types |
| `lib/stt/deepgram.ts` | Call Deepgram, normalize response into `Transcript` |
| `lib/gate/file-check.ts` | Input file validation: size, real format by content, video track, duration (§5a) |
| `lib/gate/precheck.ts` | Deterministic pre-LLM decline rules |
| `lib/extract/prompt.ts` | System prompt and transcript rendering |
| `lib/extract/schema.ts` | Tool JSON schema + runtime validation (zod) |
| `lib/extract/claude.ts` | Model call; one retry on invalid output |
| `lib/verify/verify.ts` | Quote matching, timestamp attribution, field checks, final filtering, post-LLM decline rules |
| `lib/verify/text.ts` | Normalization and fuzzy matching helpers |
| `lib/metrics.ts` + `lib/pricing.ts` | Stage timings, usage, cost computation; dated price constants with source URLs |
| `lib/pipeline.ts` | `transcribe(audio)` and `extract(transcript)` used by both API routes and scripts |

`scripts/synthesize.ts` and `scripts/eval.ts` import the same `lib/` modules as the app.

## 4. Data model

### Transcript (from Deepgram)

```ts
Transcript {
  durationSec: number
  utterances: { id: "u1"…, speaker: number, start: number, end: number, text: string,
                words: { word: string, punctuated: string, start: number, end: number }[] }[]
  speakerStats: { speaker: number, wordCount: number }[]
}
```

### Extraction (model tool input)

```ts
Extraction {
  speakers: { speaker: number, name: string | null, intro_utterance_id: string | null }[]
  no_commitments_discussed: boolean
  items: {
    kind: "task" | "open_question"
    summary: string
    final_status: "active" | "cancelled" | "not_accepted" | "open"   // "open" only for questions
    owner: { status: "agreed" | "none" | "disputed", name: string | null,
             evidence: { utterance_id: string, quote: string } | null }  // the agreement itself
    deadline: { status: "agreed" | "none" | "disputed",
                wording: string | null,            // verbatim, e.g. "by Friday"
                evidence: { utterance_id: string, quote: string } | null, // latest agreed wording
                resolved_date: string | null,      // ISO, only with an anchor in the recording
                anchor_utterance_id: string | null }
    events: { type: "proposed" | "accepted" | "assigned" | "deadline_set" | "deadline_changed"
                    | "cancelled" | "reopened" | "question_raised" | "left_open",
              utterance_id: string, quote: string }[]   // chronological, verbatim
  }[]
}
```

The prompt instructs the model: tentative language ("we could", "maybe") is `proposed`, not
accepted; only explicit agreement makes a task `active`; later statements override earlier ones;
`null` rather than guessing; an owner or deadline is `agreed` only when a specific utterance
settles it, and that utterance is given as `evidence` (for a corrected deadline, the correction);
`disputed` carries the utterance that leaves it open; quotes must be copied verbatim.

### Report (returned to UI)

```ts
Report {
  status: "ok" | "needs_clarification" | "no_commitments" | "declined"
  declineReasons: string[]
  clarifications: { itemSummary, question, evidence: Evidence }[]  // e.g. "Who owns 'client report'?"
  speakers: { speaker, name, intro: Evidence | null }[]
  items: VerifiedItem[]            // owner/deadline each with own Evidence; flags; event timeline
  dropped: { summary, reason }[]   // removed by verifier, shown in a debug section
  transcript: Transcript
  metrics: Metrics
}
Evidence { type, quote, utteranceId, speaker, speakerName, start, end }
Flags: "owner_missing" | "owner_disputed" | "owner_unverified" | "deadline_missing"
     | "deadline_disputed" | "deadline_unverified" | "date_context_missing"
```

## 5. Verifier rules (`lib/verify`)

1. **Quote match.** Normalize (lowercase, strip punctuation, collapse whitespace). The quote must be
   a substring of the referenced utterance; otherwise a fuzzy match over word windows of the same
   length with similarity ≥ 0.9. If still not found, search all utterances once (the model may cite
   the wrong id). No match → event dropped.
2. **Timestamps and speaker** come from Deepgram words of the matched span, never from the model.
3. **Final-state support.** The event that establishes the final status must survive verification:
   `active` needs `accepted` or `assigned`; `cancelled` needs `cancelled`; `not_accepted` needs
   `proposed`; `open` needs `question_raised` or `left_open`. Otherwise the item moves to `dropped`
   with the reason.
4. **Owner.** `agreed` is kept only if `owner.evidence` passes rule 1 **and** supports the name:
   the evidence utterance is spoken by the owner (self-commitment or acceptance, e.g. Mark: "I'll
   take it") or its quote contains the owner's name (e.g. Anna: "Mark owns the docs"). A name merely
   mentioned elsewhere is not enough. Otherwise the owner is cleared, flag `owner_unverified`.
   `none` → `owner_missing`; `disputed` → `owner_disputed` plus a clarification entry.
5. **Deadline.** `agreed` is kept only if `deadline.evidence` passes rule 1 **and** the normalized
   `wording` occurs inside that quote. Otherwise wording is cleared, flag `deadline_unverified`.
   `resolved_date` is kept only if `anchor_utterance_id` exists and contains a date expression;
   otherwise cleared. Relative wording without a kept resolved date → `date_context_missing` (the
   wording is preserved). `none` → `deadline_missing`; `disputed` → `deadline_disputed` plus a
   clarification entry.
6. **Speaker identity.** A speaker name is accepted only if it appears in the text of
   `intro_utterance_id` and that utterance belongs to the same speaker.
7. **Clarifications.** Built deterministically from verified items: disputed owner, disputed
   deadline, and `open` questions. Each entry has a question text and the evidence quote.

## 5a. Input file validation (`lib/gate/file-check.ts`)

The file name, extension and browser-reported MIME type are **not trusted**: a user can rename
`meeting.mp4` to `meeting.mp3`. Validation runs twice with the same limits:

- **Client** (before upload, instant feedback; can be bypassed, so not authoritative).
- **Server** in `/api/transcribe` on the actual bytes, before any paid API call. A rejected file
  is deleted from Blob and never reaches Deepgram.

| Check | Rule | Client method | Server method |
|---|---|---|---|
| Size | 1 KB ≤ size ≤ 35 MB (3 min stereo 44.1 kHz WAV ≈ 32 MB) | `File.size` | byte length; Blob token `maximumSizeInBytes` |
| Real format | Detected from magic bytes, must be an audio container: MP3, WAV, M4A/MP4, WebM/Matroska, Ogg, FLAC. Extension mismatch without video (e.g. WAV named `.mp3`) is accepted and processed as the real format | first bytes of `File` | `file-type` |
| Video track | Any video stream → reject: "This file contains video (detected: MP4 with video track). Upload an audio-only file." | load into hidden `<video>`; `videoWidth > 0` → video | `music-metadata` `format.hasVideo` / track list |
| Duration | 3 s ≤ duration ≤ 180 s (server allows 185 s tolerance) | `<audio>` `loadedmetadata` | `music-metadata` `format.duration` |
| Readability | File must parse as media | media element `error` event | `music-metadata` parse error → "File is corrupted or not an audio file" |

If the container reports no duration (possible for some WebM streams), the server accepts the file
and relies on the post-STT duration check from Deepgram metadata (below), which runs before the
Claude call. Each rejection returns a machine code (`file_too_large`, `file_too_small`,
`not_audio`, `contains_video`, `too_long`, `too_short`, `unreadable`) and a human message.

### Decline rules

Pre-LLM (`precheck`, skips the Claude call):
- duration > 185 s (5 s tolerance for encoding)
- number of speakers with ≥ 5 % of words ≠ 2
- fewer than 20 words

Post-LLM (`verify`):
- any speaker not identified by rule 6 → `declined` ("Speakers never introduce themselves; owners
  cannot be attributed")
- zero verified items and `no_commitments_discussed` → `no_commitments`
- no verified `active` task and at least one clarification → `needs_clarification` (the recording
  discusses work but settles nothing reliably; the report lists what must be clarified and does
  not present any commitment)
- otherwise `ok` (clarifications, if any, are still listed)

Within the brief's scope (two speakers who introduce themselves) the `declined` rules are
safeguards; they are covered by unit tests rather than recordings. A declined report still
includes transcript and metrics.

## 6. UI (single page)

1. **Input:** drop zone + "Choose file", file name, duration, audio player, "Extract commitments".
   No text input for the source.
2. **Processing:** stage list with live timings: Uploading → Transcribing → Extracting → Verifying.
3. **Result**, titled "Final commitments":
   - Speakers with intro quote ▶.
   - **Active tasks:** summary; **Owner** with its own quote `mm:ss ▶` (or ⚠ flag); **Deadline**
     wording, resolved date or ⚠ date context missing, with its own quote `mm:ss ▶`; evidence
     timeline — each event shows type label, `mm:ss ▶`, speaker, quote. ▶ plays exactly
     `start−0.3 s … end+0.3 s`.
   - **Needs clarification / Open questions:** each entry with question and quote ▶ (disputed
     owners and deadlines, unresolved questions).
   - **needs_clarification** state: panel "No commitment can be concluded from this recording"
     followed by the clarification list; no task lists shown as commitments.
   - **Cancelled** (collapsed) and **Proposals not accepted** (collapsed, labelled "not a
     commitment").
   - **Dropped by verifier** (collapsed).
   - **Declined** state: yellow panel with reasons instead of lists.
   - **Metrics:** stage timings, time to result, audio minutes, tokens in/out, cost per operation and
     per audio minute.
   - "Show transcript" (click an utterance to play it) and "Download JSON".

Errors: file validation failures (§5a) shown with the specific reason before upload and again if
the server check rejects; failing stage named with a
"Retry" button; invalid model output retried once, then shown as an error.

## 7. Test set and evaluation

### Layout

```
testset/<case>/
  script.json     # [{speaker, voice, text}] — source for synthesis
  audio.mp3       # generated by scripts/synthesize.ts
  offsets.json    # actual start/end of each line in the stitched audio
  expected.json   # written BEFORE the first run, committed separately (see below)
```

`scripts/synthesize.ts`: Aura-2 per line (two distinct voices), 0.4 s silence between lines,
ffmpeg concat, writes `offsets.json`.

### Cases

| Case | Content | Expected |
|---|---|---|
| `01-normal` | Anna (PM) and Mark (developer) introduce themselves. Proposal never accepted ("We could also redo the landing page" → "Maybe later", topic changes). Accepted task (Mark writes the API docs by Wednesday). Corrected deadline (client demo Thursday → "actually, Friday"). Cancelled task (customer survey dropped). Task with no named owner ("someone needs to book the room"). Relative date without anchor ("next Tuesday"). Open question (budget approval unresolved). | `ok`; each item with exact status/owner/deadline/flags |
| `02-changed` | Same script, one agreement changed: the survey is kept and Anna owns it. | Survey `active`, owner Anna; everything else identical to 01 |
| `03-clarify` | Anna and Mark introduce themselves. They discuss a client report: owner bounced ("Can you take it?" / "I'm not sure I can, maybe you?"), deadline left undecided ("Thursday or Friday… let's decide later"), a vague "we should probably update the roadmap" never confirmed; the call ends without closing anything. | `needs_clarification`; clarifications for the report's owner and deadline with quotes; must_not: any `active` task, any agreed owner, any agreed deadline |

### Expected list authoring (independence)

1. Claude drafts `expected.json` from `script.json` only — never from app output.
2. The user reviews the script and draft, corrects it, and approves it. The approved version is
   committed ("expected: approved by reviewer") before any extraction run; git history shows the
   order.
3. Corrections made by the user are recorded in `DELIVERY.md` as the example of checking AI output.

### Expectation format

```json
{
  "status": "ok",
  "items": [
    { "anchor": "API docs", "kind": "task", "final_status": "active",
      "owner": "Mark", "owner_line": 7,
      "deadline_wording": "by Wednesday", "deadline_line": 7,
      "flags": ["date_context_missing"], "evidence_line": 7 }
  ],
  "must_not": [
    { "anchor": "landing page", "final_status": "active" },
    { "anchor": "book the room", "has_owner": true }
  ]
}
```

`anchor` is a short phrase from the script used **only by the eval script** to find which item
in the app's output corresponds to an expected item: an output item matches if one of its
verified quotes contains the anchor (normalized, ≤ 2 character edits). The app never sees anchors.
Each `must_not` entry describes a forbidden state: the check fails if a matching item is in that
state (e.g. "landing page" item is active, or "book the room" item has an owner).

### `scripts/eval.ts`

Runs each case 3 times through `lib/pipeline.ts` and reports:

- **Inclusion:** expected items found; field accuracy (status, owner, deadline wording, flags);
  owner and deadline evidence present and matching the expected script line.
- **Exclusion:** `must_not` checks and extra unmatched items (precision).
- **STT vs extraction attribution:** if an anchor is absent from the transcript itself, the miss
  is labelled an STT error.
- **Timestamp accuracy:** evidence start within ±1 s of `offsets.json` for `evidence_line`.
- **Speed and cost:** per stage and total (median, max); cost per operation and per audio minute.

Output: `eval/results/<timestamp>.json` and `.md`. Failures are reported as they are.

### Unit tests (vitest, no network)

Transcript fixtures for: quote normalization and fuzzy matching, wrong utterance id, fabricated
quote, final-state support rule, owner evidence (name only mentioned elsewhere → rejected;
self-commitment → kept), deadline evidence (wording not in evidence quote → rejected; corrected
deadline uses the correction), date anchor rule, clarification and status rules, precheck (3
speakers, > 185 s, too few words), unidentified speaker decline.

File-check fixtures (`testset/invalid/`, generated by `scripts/make-invalid-fixtures.ts` with
ffmpeg, expected codes written in `testset/invalid/expected.json`):

| Fixture | Expected |
|---|---|
| `video-renamed.mp3` — MP4 with video track, extension `.mp3` | `contains_video` |
| `video-renamed.m4a` — MP4 with video track, extension `.m4a` | `contains_video` |
| `webm-video-renamed.webm` — WebM with video track | `contains_video` |
| `text-renamed.mp3` — plain text file | `not_audio` |
| `wav-renamed.mp3` — valid WAV, extension `.mp3` | accepted |
| `too-long.mp3` — 200 s tone | `too_long` |
| `too-short.mp3` — 1 s tone | `too_short` |
| `too-large.wav` — > 35 MB | `file_too_large` |
| `empty.mp3` — 0 bytes | `file_too_small` |

These run through the server-side `file-check` in vitest (no network). The client check is
verified manually in the browser with the same files and listed in `DELIVERY.md`.

## 8. Speed and cost measurement

- Timings measured server-side per stage and client-side end-to-end (time to useful result).
- Variable cost per operation, all at list price, including every retry:
  - **Recognition:** Deepgram Nova-3 audio minutes × price.
  - **Reasoning:** Claude input and output tokens × price (from API `usage`).
  - **Speech output:** none in the product (reported as 0 with that reason).
  - **Paid intermediaries:** Vercel Blob operations (upload, read, delete) and data transfer for the
    file; Vercel Function compute for `/api/upload`, `/api/transcribe`, `/api/extract`
    (measured duration × memory × price, plus invocations).
  - Reported per operation and per audio minute.
- Prices live in `lib/pricing.ts` with date checked and source URL, verified against official
  pricing pages at implementation time; assumptions are named in `DELIVERY.md`.
- Free credits and free tiers are costed at list price, not zero.
- **Hosting (fixed)** reported separately: Vercel plan fee and Blob storage baseline.
- Test-audio synthesis (Aura-2) reported separately as a one-time preparation cost.

## 9. Deliverables

- Deployed Vercel demo URL.
- Repository with `README.md` (setup: env vars `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`,
  `BLOB_READ_WRITE_TOKEN`; `npm run dev`, `npm test`, `npm run synth`, `npm run eval`).
- `DELIVERY.md`: sample inputs, expected vs actual (eval table), what failed, time spent, exact
  tools and models (Claude Code with Claude Opus 5, Deepgram Nova-3, Deepgram Aura-2, Claude
  Sonnet 5), one example of checking AI output, reused components vs own work, measured speed and
  cost with pricing assumptions, hosting costs, next improvements.
- Script for a ≤ 3-minute walkthrough video (recorded by the user).

## 10. Budget and risks

Target ≤ 8 focused hours; unfinished parts are listed in `DELIVERY.md`.

| Risk | Mitigation |
|---|---|
| Diarization splits a TTS voice or merges both | Distinct voices; 5 % word threshold; measured and reported by eval |
| Model misjudges final state on correction chains | Event timeline in schema; eval exposes it; two-pass extraction listed as next step |
| STT misrecognizes names/anchors | Fuzzy matching; STT vs extraction attribution in eval |
| Vercel 4.5 MB body limit | Client upload to Blob; server reads bytes from Blob and forwards to Deepgram |
| Renamed/fake files bypass client checks | Authoritative server check on bytes before any paid call |
