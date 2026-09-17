import { describe, expect, it } from "vitest";
import { summaryCounts } from "@/app/components/reportModel";
import type { Clarification, Evidence, Report, VerifiedItem } from "@/lib/types";

const ev: Evidence = { type: "accepted", quote: "ok", utteranceId: "u1", speaker: 0, speakerName: "Anna", start: 1, end: 2 };

function item(kind: VerifiedItem["kind"], finalStatus: VerifiedItem["finalStatus"], summary: string): VerifiedItem {
  return {
    kind,
    summary,
    finalStatus,
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
    flags: [],
    events: [ev],
  };
}

const clarification = (about: Clarification["about"], question: string): Clarification => ({ about, itemSummary: question, question, evidence: ev });

function report(patch: Partial<Report>): Report {
  return { status: "ok", declineReasons: [], clarifications: [], speakers: [], items: [], dropped: [], metrics: null, ...patch };
}

describe("summaryCounts", () => {
  it("counts agreed tasks and everything set aside in an ok report", () => {
    const r = report({
      items: [
        item("task", "active", "Write the API docs"),
        item("task", "active", "Client demo"),
        item("task", "cancelled", "Customer survey"),
        item("task", "not_accepted", "Landing page"),
      ],
      dropped: [{ summary: "Invented task", reason: "quote not found" }],
    });
    expect(summaryCounts(r)).toEqual({ agreed: 2, toClarify: 0, notCommitments: 3 });
  });

  it("counts an open question once, through its clarification", () => {
    const r = report({
      status: "needs_clarification",
      items: [item("open_question", "open", "When is the report due?"), item("task", "not_accepted", "Update the road map")],
      clarifications: [clarification("question", "When is the report due?"), clarification("owner", "Who owns the client report?")],
    });
    expect(summaryCounts(r)).toEqual({ agreed: 0, toClarify: 2, notCommitments: 1 });
  });

  it("does not count active tasks as agreed unless the report is ok", () => {
    const r = report({ status: "declined", items: [item("task", "active", "Something")] });
    expect(summaryCounts(r).agreed).toBe(0);
  });
});
