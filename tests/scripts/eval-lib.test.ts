import { describe, expect, it } from "vitest";
import { renderReport, scoreCase, type CaseScore, type Expected, type LineOffset, type RunResult } from "@/scripts/eval-lib";
import type { Evidence, Report, VerifiedItem } from "@/lib/types";

const offsets: LineOffset[] = [
  { line: 1, speaker: "Anna", start: 0, end: 2 },
  { line: 2, speaker: "Mark", start: 2.4, end: 5 },
  { line: 3, speaker: "Anna", start: 5.4, end: 8 },
];

const ev = (quote: string, start: number, type: Evidence["type"] = "accepted"): Evidence => ({
  type, quote, utteranceId: "u1", speaker: 1, speakerName: "Mark", start, end: start + 1,
});

const docs: VerifiedItem = {
  kind: "task",
  summary: "Write documentation",
  finalStatus: "active",
  owner: { status: "agreed", name: "Mark", evidence: ev("I'll write the API docs", 2.5, "owner") },
  deadline: { status: "agreed", wording: "by Wednesday", resolvedDate: null, evidence: ev("by Wednesday", 3, "deadline") },
  flags: ["date_context_missing"],
  events: [ev("I'll write the API docs by Wednesday.", 2.5)],
};

const landing: VerifiedItem = {
  ...docs,
  summary: "Landing page",
  finalStatus: "active",
  owner: { status: "none", name: null, evidence: null },
  deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
  flags: ["owner_missing", "deadline_missing"],
  events: [ev("we could redo the landing page", 5.5, "accepted")],
};

const report = (items: VerifiedItem[]): Report => ({
  status: "ok", declineReasons: [], clarifications: [], speakers: [], items, dropped: [], metrics: null,
});

const expected: Expected = {
  status: "ok",
  items: [
    { anchor: ["API docs"], kind: "task", final_status: "active", owner: "Mark", owner_line: 2, deadline_contains: "Wednesday", deadline_line: 2, flags: ["date_context_missing"], evidence_line: 2 },
  ],
  must_not: [{ anchor: "landing page", final_status: "active" }],
  clarifications: [],
};

describe("scoreCase", () => {
  it("passes every field check for a correct item", () => {
    const s = scoreCase(expected, report([docs]), null, offsets);
    expect(s.found).toBe(1);
    expect(s.checks.filter((c) => !c.pass)).toEqual([]);
    expect(s.mustNotViolations).toEqual([]);
    expect(s.statusMatch).toBe(true);
  });

  it("reports must-not violations and extra active items", () => {
    const s = scoreCase(expected, report([docs, landing]), null, offsets);
    expect(s.mustNotViolations).toHaveLength(1);
    expect(s.extraActive).toEqual(["Landing page"]);
  });

  it("fails field checks and timestamp checks precisely", () => {
    const wrong: VerifiedItem = { ...docs, owner: { ...docs.owner, name: "Anna", evidence: ev("I'll write the API docs", 7.5, "owner") } };
    const s = scoreCase(expected, report([wrong]), null, offsets);
    const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(["API docs: owner", "API docs: owner evidence line"]);
  });

  it("labels a missing item as an STT miss when the anchor is not in the transcript", () => {
    const transcript = { durationSec: 8, speakerStats: [], utterances: [{ id: "u1", speaker: 1, start: 0, end: 1, text: "I'll write the API dogs", words: [] }] };
    const s1 = scoreCase(expected, report([]), transcript, offsets);
    expect(s1.sttMisses).toEqual([]);
    const other = { ...transcript, utterances: [{ ...transcript.utterances[0], text: "something else entirely" }] };
    const s2 = scoreCase(expected, report([]), other, offsets);
    expect(s2.sttMisses).toEqual(["API docs"]);
  });

  it("checks clarifications by kind and timestamp", () => {
    const withClar: Report = {
      ...report([]),
      status: "needs_clarification",
      clarifications: [{ about: "owner", itemSummary: "Report", question: 'Who owns "Report"?', evidence: ev("maybe you could", 5.6) }],
    };
    const exp: Expected = { status: "needs_clarification", items: [], must_not: [{ has_owner: true }], clarifications: [{ about: "owner", lines: [3] }, { about: "deadline", lines: [3] }] };
    const s = scoreCase(exp, withClar, null, offsets);
    expect(s.checks.map((c) => [c.name, c.pass])).toEqual([
      ["clarification owner @ lines 3", true],
      ["clarification deadline @ lines 3", false],
    ]);
  });
});

describe("renderReport", () => {
  const usage = { audioSeconds: 60, llmModel: "openai/gpt-5-mini", llmResolvedModel: "openai/gpt-5-mini", llmCostSource: "gateway" } as RunResult["usage"];
  const cost = { total: 0.014, perAudioMinute: 0.014 } as RunResult["cost"];
  const score = {
    statusMatch: true, status: "ok", expectedItems: 1, found: 1,
    checks: [{ name: "c", pass: true, detail: "" }],
    mustNotViolations: [], extraActive: [], extraOther: [], sttMisses: [],
  } as CaseScore;
  const results: RunResult[] = [
    { case: "01-normal", run: 1, totalMs: 46900, stageMs: { extract: 40000 }, usage, cost, score },
    { case: "01-normal", run: 2, totalMs: 1200, stageMs: {}, usage, cost, score: null, error: "Extraction failed after 2 attempts" },
    { case: "01-normal", run: 3, totalMs: 70000, stageMs: { extract: 60000 }, usage, cost, score },
  ];

  it("times the runs that produced a result, not the ones that errored", () => {
    const row = renderReport("20260918T000000Z", 3, ["01-normal"], results)
      .split("\n")
      .find((l) => l.startsWith("| 01-normal |"))!;
    expect(row).toContain("58.5 s / 70.0 s");
  });

  it("counts errored runs in their own column", () => {
    const md = renderReport("20260918T000000Z", 3, ["01-normal"], results);
    const header = md.split("\n").find((l) => l.startsWith("| Case |"))!;
    const row = md.split("\n").find((l) => l.startsWith("| 01-normal |"))!;
    const at = header.split("|").findIndex((c) => c.trim() === "Errors");
    expect(at).toBeGreaterThan(0);
    expect(row.split("|")[at].trim()).toBe("1");
  });
});

describe("scoreCase: must_not binding", () => {
  const demo: VerifiedItem = {
    ...docs,
    summary: "Client demo",
    owner: { status: "none", name: null, evidence: null },
    deadline: { status: "none", wording: null, resolvedDate: null, evidence: null },
    flags: [],
    events: [ev("The client demo is on Friday then.", 5.5)],
  };
  // Mark's closing recap names both items in one utterance, so this item's quote also mentions the demo.
  const recap: VerifiedItem = { ...docs, events: [ev("the docs from me by Wednesday, and the demo on Friday.", 6.5)] };
  const demoExpected: Expected = {
    status: "ok",
    items: [{ anchor: ["client demo", "demo on Friday"], kind: "task", final_status: "active", owner: null }],
    must_not: [{ anchor: ["client demo", "demo on Friday"], has_owner: true }],
    clarifications: [],
  };

  it("checks an anchored must_not against the item bound to that anchor", () => {
    const s = scoreCase(demoExpected, report([demo, recap]), null, offsets);
    expect(s.found).toBe(1);
    expect(s.mustNotViolations).toEqual([]);
  });

  it("still reports a violation when the bound item breaks the rule", () => {
    const owned: VerifiedItem = { ...demo, owner: { status: "agreed", name: "Mark", evidence: ev("Mark", 5.5, "owner") } };
    const s = scoreCase(demoExpected, report([owned, recap]), null, offsets);
    expect(s.mustNotViolations).toHaveLength(1);
    expect(s.mustNotViolations[0]).toContain("Client demo");
  });
});
