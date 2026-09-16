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
