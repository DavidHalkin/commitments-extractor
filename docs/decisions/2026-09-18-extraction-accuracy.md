# Extraction accuracy: fix the transcript, not the prompt alone

Date: 2026-09-18. Status: accepted. Addresses the extraction-quality items in `todo.md` §3 that the
`openai/gpt-5-mini` eval of 2026-09-17 reported (`eval/results/20260917T130623Z.md`).

## Context

Three recorded runs of the test set (`.data/runs/20260917T175712Z-n9fd8i`, `…T180728Z-0g0gn4`,
`…T131245Z-mdk8c9`) were scored against the expectations written before testing. 01-normal passed
completely; the other two failed in ways that repeated across runs:

- **`book the room` came out `not_accepted`** and lost its "before next Tuesday" deadline.
- **`customer survey` could not be bound to its anchor**: its quotes ("I was going to send it out",
  "I'll send it out myself") never named the survey.
- **03-clarify concluded instead of asking**: an invented active task "Talk about the client report"
  with a deadline of "next week", taken from "Okay, let's pick this up next week". That made the
  report status `ok` where the case expects `needs_clarification`, and broke two `must_not` rules.

The first failure was not a reasoning failure. Deepgram labels every **word** with a speaker
correctly, but sometimes groups two speakers into one utterance: across the two 75-second runs,
7 utterances were mixed. In one of them Anna's confirmation "Yes. Someone should book the room
before next Tuesday." sat inside Mark's utterance, so the model read the whole exchange as one
person's unconfirmed suggestion. The same defect produced the recurring
`landing page: cancelled` error, where Mark's "Maybe later" was glued to Anna's proposal.

## Decision

Fix the input first, then constrain the output with code, and use prompt rules only for what is
genuinely semantic. Model and budget stay as decided in
`docs/decisions/2026-09-17-extraction-model.md`.

1. **Re-segment the transcript by word-level speakers** (`lib/stt/deepgram.ts`). Each run of
   consecutive words with the same `words[].speaker` becomes its own utterance; words without a
   label continue the current run; `speakerStats` counts words per word-level speaker. Consecutive
   segments of one speaker separated by less than 0.8 s — the silence after which Deepgram itself
   ends an utterance — are then merged back into one turn, so sentences stay quotable in a single
   utterance. On the two recorded runs this turns 25 and 24 raw utterances into 17 clean turns each.
2. **A quote that postpones settles nothing** (`lib/verify/text.ts`, `lib/verify/verify.ts`).
   `isDeferral` recognizes postponement the way the existing `HEDGES`/`NEGATIONS` lexicons recognize
   hedging and negation: a self-sufficient phrase ("pick this up", "come back to", "postpone") or a
   deciding/discussing verb together with a postponing marker ("decide later", "talk about it
   another time"). Such a quote supports neither an `accepted`/`assigned` event nor an agreed
   deadline. "I'll send it out later" is not a deferral — there is no deciding verb.
3. **Every item must be identifiable from its own quotes** (`lib/verify/verify.ts`). The significant
   words of the summary apart from its leading verb must appear in at least one of the item's
   quotes; otherwise the item carries the new `evidence_unspecific` flag. The report keeps the
   commitment — losing a real one is worse — but says the evidence does not name it.
4. **Prompt rules for the genuinely semantic cases** (`lib/extract/prompt.ts`):
   - declining a proposal ("Let's not add that now", "Maybe later") leaves it `not_accepted`;
     `cancelled` is only for something already agreed or already someone's plan;
   - a task nobody is named for can still be `active` when both speakers agree it has to happen;
   - a question about an item's owner or deadline belongs to that item as `disputed`, not to a
     separate `open_question`;
   - at least one quote must name the subject of the item, extended within its utterance if needed;
   - postponing the discussion is never an acceptance and never a task of its own.

Rejected alternatives: a stronger extraction model or 3-sample majority voting. Both would raise the
measured cost and time the brief asks us to report, and neither addresses the transcript defect that
caused most of the errors.

## Measured result

`eval/results/20260917T225133Z.md`, 5 runs per case with `--pause=30`. Twelve runs completed; 11 passed
every field check with no `must_not` violation, against 8/9 status matches and 2 violations before.

| Case | Status match | Items found | Field checks | must_not | Errors | Median / max time | Median cost per op |
|---|---|---|---|---|---|---|---|
| 01-normal | 2/5 | 12/12 | 82/82 | 0 | 3 | 58.5 s / 70.0 s | $0.0145 |
| 02-changed | 5/5 | 29/30 | 212/213 | 0 | 0 | 56.3 s / 64.1 s | $0.0145 |
| 03-clarify | 5/5 | 0/0 | 10/10 | 0 | 0 | 35.0 s / 46.8 s | $0.0085 |

The three errors in 01-normal are AI Gateway free-tier rate limits, not accuracy: a single extraction
run alone finishes on the first attempt (`finishReason: "stop"`, 4,538 output tokens of the 16,000
requested) and the credit balance was $4.74 of $5. The one imperfect run, 02-changed #2, dropped
"Client demo (move to Friday)" for want of a verifiable acceptance quote — the item went missing
rather than wrong, which is the failure direction the brief asks for.

`eval/results/20260917T223528Z.md` is a partial earlier run of the same code, kept because it shows
both the rate limits and one more finding: it reported two `must_not` violations that the product did
not commit. Turn merging puts Mark's closing recap, "the docs from me by Wednesday, and the demo on
Friday", into one utterance, so the API-docs item's quote now contains "demo on Friday" — and the
scorer, which binds anchors by searching every item's quotes, checked the client-demo rule against the
API-docs item, which does have an owner. `scoreCase` now checks an anchored `must_not` against the item
it bound to that anchor, falling back to the quote search only for anchors no expectation claims. The
expectations in `testset/*/expected.json` were not touched.

## Consequences

- `needs_clarification` needs no new rule: once a postponement stops supporting an acceptance, no
  active item survives in 03-clarify and `lib/verify/verify.ts` reaches that status on its own.
- `Flag` gains `evidence_unspecific`, with its label in `app/components/CommitmentRow.tsx`.
- `scripts/eval.mts` stores the verified report per run and lists verifier drops in the markdown, so
  a failing run can be diagnosed from the artifact instead of re-running it. Report rendering moved to
  `renderReport` in `scripts/eval-lib.ts`, timing and cost now describe the runs that produced a result
  (an errored run measures the failure), errored runs have their own column, and
  `npm run eval -- --render=<results.json>` re-scores the stored reports with the current scorer and
  re-renders the run, so fixing the scorer or the report never costs another set of API calls.
- Turn merging relies on the 0.8 s Deepgram `utt_split` default. If that query parameter changes,
  `TURN_GAP_SEC` must change with it.
- Word-level diarization errors remain: in 02-changed Deepgram assigns Anna's "Right." to Mark. No
  deterministic fix exists for that on our side.
