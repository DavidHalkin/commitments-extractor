import type { CostBreakdown, Evidence, FinalStatus, Flag, Report, ReportStatus, Transcript, Usage, VerifiedItem } from "@/lib/types";
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
  /** Anchors the expectations claim, and the item each one was matched to. */
  const claimed = new Set(expected.items.flatMap((e) => arr(e.anchor)).map(normalize));
  const bound = new Map<string, VerifiedItem>();

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
    for (const a of anchors) bound.set(normalize(a), item);
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
    // An anchor an expectation already claims is checked on the item bound to it: another item may quote
    // the same phrase (a closing recap names several items in one utterance) without being that item.
    const candidates = !anchors.length
      ? report.items
      : anchors.some((a) => claimed.has(normalize(a)))
        ? [...new Set(anchors.flatMap((a) => bound.get(normalize(a)) ?? []))]
        : report.items.filter((it) => anchorMatches(it, anchors));
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

export type RunResult = {
  case: string;
  run: number;
  totalMs: number;
  stageMs: Record<string, number>;
  usage: Usage;
  cost: CostBreakdown;
  score: CaseScore | null;
  report?: Report;
  error?: string;
};

const NEWLINE = "\n";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const seconds = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—");

function modelLine(results: RunResult[]): string {
  const used = results.filter((r) => r.usage?.llmModel);
  if (!used.length) return "?";
  const served = [...new Set(used.map((r) => r.usage.llmResolvedModel).filter(Boolean))].join(", ") || "none succeeded";
  const sources = [...new Set(used.map((r) => r.usage.llmCostSource))].join(", ");
  return `${used[0].usage.llmModel} via AI Gateway (served by ${served}; LLM cost source: ${sources})`;
}

/** Renders the eval markdown from run results, so a stored results JSON can be re-rendered without re-running it. */
export function renderReport(stamp: string, runsPerCase: number, cases: string[], results: RunResult[]): string {
  const lines: string[] = [
    `# Eval ${stamp}`,
    "",
    `Runs per case: ${runsPerCase}. Model: ${modelLine(results)}. API costs only (recognition + reasoning); infrastructure costs come from deployed runs.`,
    "",
    "| Case | Status match | Items found | Field checks passed | must_not violations | Extra active items | STT misses | Errors | Median / max time | Median cost per op | Median cost per audio min |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const name of cases) {
    const rs = results.filter((r) => r.case === name);
    const ok = rs.filter((r) => r.score);
    const sum = (f: (r: RunResult) => number) => ok.reduce((acc, r) => acc + f(r), 0);
    const checks = ok.flatMap((r) => r.score!.checks);
    // Timing and cost describe the runs that produced a result; an errored run measures the failure, not the product.
    const times = ok.map((r) => r.totalMs);
    lines.push(
      `| ${name} | ${ok.filter((r) => r.score!.statusMatch).length}/${rs.length} | ${sum((r) => r.score!.found)}/${sum((r) => r.score!.expectedItems)} | ${checks.filter((c) => c.pass).length}/${checks.length} | ${sum((r) => r.score!.mustNotViolations.length)} | ${sum((r) => r.score!.extraActive.length)} | ${sum((r) => r.score!.sttMisses.length)} | ${rs.length - ok.length} | ${seconds(median(times))} / ${seconds(times.length ? Math.max(...times) : NaN)} | $${median(ok.map((r) => r.cost.total)).toFixed(4)} | $${median(ok.map((r) => r.cost.perAudioMinute ?? 0)).toFixed(4)} |`,
    );
  }
  lines.push("", "## Stage timings (median ms)", "", "| Case | file-check | transcribe | precheck | extract | verify |", "|---|---|---|---|---|---|");
  for (const name of cases) {
    const ok = results.filter((r) => r.case === name && r.score);
    const m = (s: string) => Math.round(median(ok.map((r) => r.stageMs[s]).filter((x) => x != null)));
    lines.push(`| ${name} | ${m("file-check")} | ${m("transcribe")} | ${m("precheck")} | ${m("extract")} | ${m("verify")} |`);
  }
  lines.push("", "## Failures by run", "");
  for (const r of results) {
    if (r.error) {
      lines.push(`- **${r.case} #${r.run}**: error — ${r.error}`);
      continue;
    }
    const s = r.score!;
    const problems = [
      ...(s.statusMatch ? [] : [`status ${s.status}`]),
      ...s.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`),
      ...s.mustNotViolations,
      ...s.extraActive.map((x) => `extra active item: ${x}`),
      ...s.sttMisses.map((x) => `STT miss: ${x}`),
      ...(r.report?.dropped ?? []).map((d) => `dropped "${d.summary}": ${d.reason}`),
    ];
    lines.push(`- **${r.case} #${r.run}**: ${problems.length ? problems.join("; ") : "all checks passed"}${s.extraOther.length ? ` (other extras: ${s.extraOther.join("; ")})` : ""}`);
  }
  return `${lines.join(NEWLINE)}${NEWLINE}`;
}
