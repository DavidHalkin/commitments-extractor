# Recorded Conversation → Final Commitments — Design

Date: 2026-09-16
Source brief: `TS.md`

## 1. Goal

A browser app where a user uploads a recorded project discussion (English, two speakers who
introduce themselves, ≤ 3 minutes) and receives the **final state** of agreed tasks, owners,
deadlines and unresolved questions. Every item carries timestamped verbatim quotations the user
can play back. It is a commitments list, not a meeting summary.

Hard rules from the brief:

- Keep only the final state of each commitment (corrections and cancellations applied).
- Never turn "we could" into "we will"; never show a cancelled task as active.
- Never infer an owner or deadline that was not agreed.
- Relative dates that cannot be resolved from the recording keep their wording and are flagged
  `date_context_missing`.
- The product declines to conclude when the input does not allow a reliable list.

Out of scope: calendar integration, sending tasks, accounts, microphone recording in the app,
languages other than English, overlapping speech, asking the user for the meeting date.

## 2. Decisions

| Topic | Decision |
|---|---|
| Speech-to-text | Deepgram Nova-3 (pre-recorded API, `diarize`, `utterances`, `smart_format`, `punctuate`, `language=en`) |
| Reasoning | Claude Sonnet 5 (`claude-sonnet-5`) via tool use with a strict JSON schema, one pass |
| Reliability | Deterministic server-side verifier: quotes, timestamps, owners, deadlines checked against the transcript |
| Ambiguity | Flags on items + a `declined` result with reasons; no interactive clarification |
| Stack / hosting | Next.js (App Router, TypeScript) on Vercel; Vercel Blob for client uploads |
| Test audio | Scripts voiced with Deepgram Aura-2 (two voices), stitched with ffmpeg |
| Test scoring | Deterministic eval script with hand-written expectations; no LLM judge |

## 3. Architecture and data flow

```
Browser                              Vercel functions                   External
1. Pick/drop file (mp3/wav/m4a/webm/ogg)
   read duration locally, reject > 180 s
2. Upload directly to Vercel Blob ──► POST /api/upload (client token)
3. POST /api/transcribe {blobUrl} ──► Deepgram by URL ───────────────► Deepgram
                                      normalize → Transcript
                                      precheck (may decline)
                                      delete blob
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
    owner: { status: "agreed" | "none" | "disputed", name: string | null }
    deadline: { status: "agreed" | "none" | "disputed",
                wording: string | null,            // verbatim, e.g. "by Friday"
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
`null` rather than guessing; quotes must be copied verbatim from the given utterance.

### Report (returned to UI)

```ts
Report {
  status: "ok" | "no_commitments" | "declined"
  declineReasons: string[]
  speakers: { speaker, name, intro: Evidence | null }[]
  items: VerifiedItem[]            // with flags, verified evidence (start/end/speaker from STT)
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
4. **Owner.** `agreed` name must equal an identified speaker name or appear in the transcript text;
   otherwise owner cleared and `owner_unverified`. `none` → `owner_missing`; `disputed` →
   `owner_disputed` (the UI also lists the item under Open questions).
5. **Deadline.** `wording` must appear (normalized) in the transcript, else cleared with
   `deadline_unverified`. `resolved_date` is kept only if `anchor_utterance_id` exists and contains a
   date expression; otherwise cleared. Relative wording without a kept resolved date →
   `date_context_missing`. `none` → `deadline_missing`; `disputed` → `deadline_disputed`.
6. **Speaker identity.** A speaker name is accepted only if it appears in the text of
   `intro_utterance_id` and that utterance belongs to the same speaker.

### Decline rules

Pre-LLM (`precheck`, skips the Claude call):
- duration > 185 s (5 s tolerance for encoding)
- number of speakers with ≥ 5 % of words ≠ 2
- fewer than 20 words

Post-LLM (`verify`):
- any speaker not identified by rule 6 → `declined` ("Speakers never introduce themselves; owners
  cannot be attributed")
- zero verified items and `no_commitments_discussed` → `no_commitments`

A declined report still includes transcript and metrics.

## 6. UI (single page)

1. **Input:** drop zone + "Choose file", file name, duration, audio player, "Extract commitments".
   No text input for the source.
2. **Processing:** stage list with live timings: Uploading → Transcribing → Extracting → Verifying.
3. **Result**, titled "Final commitments":
   - Speakers with intro quote ▶.
   - **Active tasks:** summary, Owner (or ⚠ flag), Deadline (wording, resolved date or
     ⚠ date context missing), evidence timeline — each event shows type label, `mm:ss ▶`, speaker,
     quote. ▶ plays exactly `start−0.3 s … end+0.3 s`.
   - **Open questions** (includes tasks with disputed owner/deadline, cross-referenced).
   - **Cancelled** (collapsed) and **Proposals not accepted** (collapsed, labelled "not a
     commitment").
   - **Dropped by verifier** (collapsed).
   - **Declined** state: yellow panel with reasons instead of lists.
   - **Metrics:** stage timings, time to result, audio minutes, tokens in/out, cost per operation and
     per audio minute.
   - "Show transcript" (click an utterance to play it) and "Download JSON".

Errors: unsupported/empty/too long file rejected before upload; failing stage named with a
"Retry" button; invalid model output retried once, then shown as an error.

## 7. Test set and evaluation

### Layout

```
testset/<case>/
  script.json     # [{speaker, voice, text}] — source for synthesis
  audio.mp3       # generated by scripts/synthesize.ts
  offsets.json    # actual start/end of each line in the stitched audio
  expected.json   # written by hand BEFORE the first run, committed separately
```

`scripts/synthesize.ts`: Aura-2 per line (two distinct voices), 0.4 s silence between lines,
ffmpeg concat, writes `offsets.json`.

### Cases

| Case | Content | Expected |
|---|---|---|
| `01-normal` | Anna (PM) and Mark (developer) introduce themselves. Proposal never accepted ("We could also redo the landing page" → "Maybe later", topic changes). Accepted task (Mark writes the API docs by Wednesday). Corrected deadline (client demo Thursday → "actually, Friday"). Cancelled task (customer survey dropped). Task with no named owner ("someone needs to book the room"). Relative date without anchor ("next Tuesday"). Open question (budget approval unresolved). | `ok`; each item with exact status/owner/deadline/flags |
| `02-changed` | Same script, one agreement changed: the survey is kept and Anna owns it. | Survey `active`, owner Anna; everything else identical to 01 |
| `03-clarify` | Two speakers, no introductions, owners bounced ("you'll handle it?" / "or you?"), nothing closed. | `declined`, reason: speakers not identified |

### Expectation format

```json
{
  "status": "ok",
  "items": [
    { "anchor": "API docs", "kind": "task", "final_status": "active",
      "owner": "Mark", "deadline_wording": "by Wednesday",
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

- **Inclusion:** expected items found; field accuracy (status, owner, deadline wording, flags).
- **Exclusion:** `must_not` checks and extra unmatched items (precision).
- **STT vs extraction attribution:** if an anchor is absent from the transcript itself, the miss
  is labelled an STT error.
- **Timestamp accuracy:** evidence start within ±1 s of `offsets.json` for `evidence_line`.
- **Speed and cost:** per stage and total (median, max); cost per operation and per audio minute.

Output: `eval/results/<timestamp>.json` and `.md`. Failures are reported as they are.

### Unit tests (vitest, no network)

Transcript fixtures for: quote normalization and fuzzy matching, wrong utterance id, fabricated
quote, final-state support rule, owner/deadline verification, date anchor rule, precheck (3
speakers, > 185 s, too few words), unidentified speaker decline.

## 8. Speed and cost measurement

- Timings measured server-side per stage and client-side end-to-end (time to useful result).
- Variable cost per operation = Deepgram audio minutes × STT price + Claude input/output tokens ×
  model price, including retries. Prices live in `lib/pricing.ts` with the date checked and source
  URL; verified against official pricing pages at implementation time.
- Free credits are costed at list price.
- Hosting (Vercel, Blob) reported separately, not included in per-operation cost.
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
| Vercel 4.5 MB body limit | Client upload to Blob; Deepgram fetches by URL |
