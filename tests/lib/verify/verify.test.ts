import { describe, expect, it } from "vitest";
import type { ExtractedItem, Extraction } from "@/lib/extract/schema";
import { isAbsoluteDate, verify } from "@/lib/verify/verify";
import { makeTranscript } from "../../helpers/transcript";

const t = makeTranscript([
  [0, "Hi, I'm Anna, the project manager."], // u1
  [1, "Hi, I'm Mark, the developer."], // u2
  [0, "Mark, the API docs are still missing."], // u3
  [1, "I'll write the API docs by Wednesday."], // u4
  [0, "We could also redo the landing page."], // u5
  [1, "Maybe later."], // u6
  [0, "Can you take the client report?"], // u7
  [1, "I'm not sure, maybe you could?"], // u8
  [0, "Let's drop the survey."], // u9
  [0, "Today is September 14, so the report is due on September 20."], // u10
]);

const speakers: Extraction["speakers"] = [
  { speaker: 0, name: "Anna", intro_utterance_id: "u1" },
  { speaker: 1, name: "Mark", intro_utterance_id: "u2" },
];

function item(over: Partial<ExtractedItem>): ExtractedItem {
  return {
    kind: "task",
    summary: "Write API docs",
    final_status: "active",
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, evidence: null, resolved_date: null, anchor_utterance_id: null },
    events: [{ type: "accepted", utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }],
    ...over,
  };
}

const run = (items: ExtractedItem[], extra: Partial<Extraction> = {}) =>
  verify(t, { speakers, no_commitments_discussed: false, items, ...extra });

describe("verify: quotes and timestamps", () => {
  it("takes evidence text and timestamps from the transcript words", () => {
    const r = run([item({})]);
    const ev = r.items[0].events[0];
    expect(ev.quote).toBe("I'll write the API docs by Wednesday.");
    expect(ev.utteranceId).toBe("u4");
    expect(ev.speakerName).toBe("Mark");
    expect(ev.start).toBe(t.utterances[3].words[0].start);
    expect(ev.end).toBe(t.utterances[3].words[6].end);
  });

  it("finds a quote cited with the wrong utterance id", () => {
    const r = run([item({ events: [{ type: "accepted", utterance_id: "u9", quote: "I'll write the API docs" }] })]);
    expect(r.items[0].events[0].utteranceId).toBe("u4");
  });

  it("drops an item whose supporting quote is fabricated", () => {
    const r = run([item({ events: [{ type: "accepted", utterance_id: "u4", quote: "Anna will do the docs by Friday" }] })]);
    expect(r.items).toHaveLength(0);
    expect(r.dropped[0].reason).toContain("accepted");
    expect(r.status).toBe("declined");
  });

  it("drops an active task supported only by a proposal", () => {
    const r = run([
      item({ summary: "Redo landing page", events: [{ type: "proposed", utterance_id: "u5", quote: "We could also redo the landing page" }] }),
    ]);
    expect(r.items).toHaveLength(0);
  });
});

describe("verify: owners", () => {
  it("keeps a self-committed owner with evidence", () => {
    const r = run([item({ owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u4", quote: "I'll write the API docs" } } })]);
    expect(r.items[0].owner).toMatchObject({ status: "agreed", name: "Mark" });
    expect(r.items[0].owner.evidence?.utteranceId).toBe("u4");
    expect(r.items[0].flags).toContain("deadline_missing");
  });

  it("rejects an owner whose evidence neither is spoken by nor names them", () => {
    const r = run([item({ owner: { status: "agreed", name: "Anna", evidence: { utterance_id: "u4", quote: "I'll write the API docs" } } })]);
    expect(r.items[0].owner).toMatchObject({ status: "none", name: null, evidence: null });
    expect(r.items[0].flags).toContain("owner_unverified");
  });

  it("accepts an owner named inside the evidence quote", () => {
    const r = run([item({ owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u3", quote: "Mark, the API docs are still missing" } } })]);
    expect(r.items[0].owner.name).toBe("Mark");
  });

  it("flags a missing owner", () => {
    expect(run([item({})]).items[0].flags).toContain("owner_missing");
  });
});

describe("verify: deadlines", () => {
  it("keeps relative wording and flags missing date context", () => {
    const r = run([item({ deadline: { status: "agreed", wording: "by Wednesday", evidence: { utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }, resolved_date: "2026-09-16", anchor_utterance_id: null } })]);
    expect(r.items[0].deadline).toMatchObject({ status: "agreed", wording: "by Wednesday", resolvedDate: null });
    expect(r.items[0].flags).toContain("date_context_missing");
  });

  it("rejects wording that is not in the evidence quote", () => {
    const r = run([item({ deadline: { status: "agreed", wording: "by Friday", evidence: { utterance_id: "u4", quote: "I'll write the API docs by Wednesday" }, resolved_date: null, anchor_utterance_id: null } })]);
    expect(r.items[0].deadline.wording).toBeNull();
    expect(r.items[0].flags).toContain("deadline_unverified");
  });

  it("keeps a resolved date anchored in the recording", () => {
    const r = run([
      item({
        summary: "Client report",
        events: [{ type: "assigned", utterance_id: "u10", quote: "the report is due on September 20" }],
        deadline: { status: "agreed", wording: "on September 20", evidence: { utterance_id: "u10", quote: "the report is due on September 20" }, resolved_date: "2026-09-20", anchor_utterance_id: "u10" },
      }),
    ]);
    expect(r.items[0].deadline.resolvedDate).toBe("2026-09-20");
    expect(r.items[0].flags).not.toContain("date_context_missing");
  });

  it("recognizes absolute dates", () => {
    expect(isAbsoluteDate("on September 20")).toBe(true);
    expect(isAbsoluteDate("2026-09-20")).toBe(true);
    expect(isAbsoluteDate("by Wednesday")).toBe(false);
    expect(isAbsoluteDate("we may be late")).toBe(false);
  });
});

describe("verify: statuses and clarifications", () => {
  it("keeps cancelled and not-accepted items without owner flags", () => {
    const r = run([
      item({}),
      item({ summary: "Customer survey", final_status: "cancelled", events: [{ type: "cancelled", utterance_id: "u9", quote: "Let's drop the survey" }] }),
      item({ summary: "Landing page", final_status: "not_accepted", events: [{ type: "proposed", utterance_id: "u5", quote: "We could also redo the landing page" }] }),
    ]);
    expect(r.items.map((i) => i.finalStatus)).toEqual(["active", "cancelled", "not_accepted"]);
    expect(r.items[1].flags).toEqual([]);
    expect(r.items[2].flags).toEqual([]);
    expect(r.status).toBe("ok");
  });

  it("returns needs_clarification when only disputed work remains", () => {
    const r = run([
      item({
        summary: "Client report",
        final_status: "not_accepted",
        events: [{ type: "proposed", utterance_id: "u7", quote: "Can you take the client report?" }],
        owner: { status: "disputed", name: null, evidence: { utterance_id: "u8", quote: "I'm not sure, maybe you could?" } },
      }),
    ]);
    expect(r.status).toBe("needs_clarification");
    expect(r.clarifications).toHaveLength(1);
    expect(r.clarifications[0]).toMatchObject({ about: "owner", question: 'Who owns "Client report"?' });
    expect(r.clarifications[0].evidence.utteranceId).toBe("u8");
    expect(r.items[0].flags).toEqual(["owner_disputed"]);
  });

  it("turns open questions into clarifications", () => {
    const r = run([
      item({}),
      item({ kind: "open_question", summary: "Is the client report ours?", final_status: "open", events: [{ type: "question_raised", utterance_id: "u7", quote: "Can you take the client report?" }] }),
    ]);
    expect(r.status).toBe("ok");
    expect(r.clarifications.map((c) => c.about)).toEqual(["question"]);
  });

  it("drops inconsistent kind/status combinations", () => {
    const r = run([item({}), item({ summary: "Bad", final_status: "open", events: [{ type: "question_raised", utterance_id: "u7", quote: "Can you take the client report?" }] })]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped[0].reason).toContain("inconsistent");
  });

  it("declines when a speaker is not identified by their own introduction", () => {
    const r = verify(t, { speakers: [speakers[0], { speaker: 1, name: "Mark", intro_utterance_id: "u1" }], no_commitments_discussed: false, items: [item({})] });
    expect(r.status).toBe("declined");
    expect(r.declineReasons[0]).toContain("introduce");
    expect(r.items).toEqual([]);
  });

  it("reports no_commitments when nothing was discussed", () => {
    const r = run([], { no_commitments_discussed: true });
    expect(r.status).toBe("no_commitments");
  });
});
