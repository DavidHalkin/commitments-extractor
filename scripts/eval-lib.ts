import type { Evidence, FinalStatus, Flag, Report, ReportStatus, Transcript, VerifiedItem } from "@/lib/types";
import { containsPhrase, fuzzyContainsPhrase, normalize } from "@/lib/verify/text";

type OneOrMany<T> = T | T[];

export type LineOffset = { line: number; speaker: string; start: number; end: number };

export type ExpectedItem = {
  anchor: OneOrMany<string>;
  kind: VerifiedItem["kind"];
  final_status: FinalStatus;
  owner?: string | null;
  owner_line?: OneOrMany<number>;
  deadline_contains?: string | null;
  deadline_line?: OneOrMany<number>;
  flags?: Flag[];
  evidence_line?: OneOrMany<number>;
};

export type MustNot = {
  anchor?: OneOrMany<string>;
  final_status?: FinalStatus;
  has_owner?: boolean;
  has_deadline?: boolean;
  deadline_contains?: string;
};

export type ExpectedClarification = { about: "owner" | "deadline" | "question"; lines: number[] };

export type Expected = {
  status: ReportStatus;
  items: ExpectedItem[];
  must_not: MustNot[];
  clarifications: ExpectedClarification[];
};

export type Check = { name: string; pass: boolean; detail: string };

export type CaseScore = {
  statusMatch: boolean;
  status: ReportStatus;
  expectedItems: number;
  found: number;
  checks: Check[];
  mustNotViolations: string[];
  extraActive: string[];
  extraOther: string[];
  sttMisses: string[];
};

const arr = <T>(x: OneOrMany<T> | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function quotes(it: VerifiedItem): Evidence[] {
  return [...it.events, ...(it.owner.evidence ? [it.owner.evidence] : []), ...(it.deadline.evidence ? [it.deadline.evidence] : [])];
}

function anchorMatches(it: VerifiedItem, anchors: string[]): boolean {
  return anchors.some((a) => quotes(it).some((q) => fuzzyContainsPhrase(q.quote, a)));
}

function inLines(ev: Evidence | null, lines: number[], offsets: LineOffset[], tolSec = 1): boolean {
  if (!ev) return false;
  return lines.some((l) => {
    const o = offsets.find((x) => x.line === l);
    return !!o && ev.start >= o.start - tolSec && ev.start <= o.end + tolSec;
  });
}

const show = (ev: Evidence | null) => (ev ? `${ev.start.toFixed(1)} s “${ev.quote}”` : "no evidence");

export function scoreCase(expected: Expected, report: Report, transcript: Transcript | null, offsets: LineOffset[]): CaseScore {
  const used = new Set<VerifiedItem>();
  const checks: Check[] = [];
  const sttMisses: string[] = [];
  const fullText = transcript?.utterances.map((u) => u.text).join(" ") ?? "";
  let found = 0;

  for (const exp of expected.items) {
    const anchors = arr(exp.anchor);
    const label = anchors[0];
    const item = report.items.find((it) => !used.has(it) && anchorMatches(it, anchors));
    if (!item) {
      checks.push({ name: `${label}: found`, pass: false, detail: "no item has a quote containing the anchor" });
      if (transcript && !anchors.some((a) => fuzzyContainsPhrase(fullText, a))) sttMisses.push(label);
      continue;
    }
    used.add(item);
    found++;
    checks.push({ name: `${label}: found`, pass: true, detail: item.summary });
    checks.push({ name: `${label}: kind`, pass: item.kind === exp.kind, detail: `got ${item.kind}, expected ${exp.kind}` });
    checks.push({ name: `${label}: final_status`, pass: item.finalStatus === exp.final_status, detail: `got ${item.finalStatus}, expected ${exp.final_status}` });
    if (exp.owner !== undefined) {
      const pass = exp.owner === null ? item.owner.name === null : item.owner.name !== null && normalize(item.owner.name) === normalize(exp.owner);
      checks.push({ name: `${label}: owner`, pass, detail: `got ${item.owner.name ?? "null"}, expected ${exp.owner ?? "null"}` });
    }
    if (exp.owner_line !== undefined) {
      checks.push({ name: `${label}: owner evidence line`, pass: inLines(item.owner.evidence, arr(exp.owner_line), offsets), detail: show(item.owner.evidence) });
    }
    if (exp.deadline_contains !== undefined) {
      const pass = exp.deadline_contains === null
        ? item.deadline.wording === null
        : item.deadline.wording !== null && containsPhrase(item.deadline.wording, exp.deadline_contains);
      checks.push({ name: `${label}: deadline`, pass, detail: `got ${item.deadline.wording ?? "null"}, expected ${exp.deadline_contains ?? "null"}` });
    }
    if (exp.deadline_line !== undefined) {
      checks.push({ name: `${label}: deadline evidence line`, pass: inLines(item.deadline.evidence, arr(exp.deadline_line), offsets), detail: show(item.deadline.evidence) });
    }
    if (exp.flags !== undefined) {
      const got = [...item.flags].sort().join(",");
      const want = [...exp.flags].sort().join(",");
      checks.push({ name: `${label}: flags`, pass: got === want, detail: `got [${got}], expected [${want}]` });
    }
    if (exp.evidence_line !== undefined) {
      checks.push({
        name: `${label}: evidence timestamp`,
        pass: item.events.some((e) => inLines(e, arr(exp.evidence_line), offsets)),
        detail: item.events.map((e) => e.start.toFixed(1)).join(", "),
      });
    }
  }

  for (const c of expected.clarifications) {
    const pass = report.clarifications.some((x) => x.about === c.about && inLines(x.evidence, c.lines, offsets));
    checks.push({
      name: `clarification ${c.about} @ lines ${c.lines.join("/")}`,
      pass,
      detail: report.clarifications.map((x) => `${x.about}@${x.evidence.start.toFixed(1)}`).join(", ") || "none",
    });
  }

  const mustNotViolations: string[] = [];
  for (const m of expected.must_not) {
    const anchors = arr(m.anchor);
    const candidates = anchors.length ? report.items.filter((it) => anchorMatches(it, anchors)) : report.items;
    for (const it of candidates) {
      const conds: boolean[] = [];
      if (m.final_status) conds.push(it.finalStatus === m.final_status);
      if (m.has_owner !== undefined) conds.push((it.owner.name !== null) === m.has_owner);
      if (m.has_deadline !== undefined) conds.push((it.deadline.wording !== null) === m.has_deadline);
      if (m.deadline_contains) conds.push(it.deadline.wording !== null && containsPhrase(it.deadline.wording, m.deadline_contains));
      if (conds.length && conds.every(Boolean)) mustNotViolations.push(`${JSON.stringify(m)} violated by "${it.summary}"`);
    }
  }

  const extras = report.items.filter((it) => !used.has(it));
  return {
    statusMatch: report.status === expected.status,
    status: report.status,
    expectedItems: expected.items.length,
    found,
    checks,
    mustNotViolations,
    extraActive: extras.filter((i) => i.finalStatus === "active").map((i) => i.summary),
    extraOther: extras.filter((i) => i.finalStatus !== "active").map((i) => `${i.finalStatus}: ${i.summary}`),
    sttMisses,
  };
}
