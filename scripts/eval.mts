import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeCost } from "@/lib/metrics";
import type { CostBreakdown, Usage } from "@/lib/types";
import { scoreCase, type CaseScore, type Expected, type LineOffset } from "@/scripts/eval-lib";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CASES = ["01-normal", "02-changed", "03-clarify"];
const runsPerCase = Number(arg("runs") ?? 3);
// EXTRACT_MODEL is read when lib/extract/llm.ts loads, so the override must precede the pipeline import.
const modelOverride = arg("model");
if (modelOverride) process.env.EXTRACT_MODEL = modelOverride;
const { processAudio } = await import("@/lib/pipeline");

type RunResult = {
  case: string;
  run: number;
  totalMs: number;
  stageMs: Record<string, number>;
  usage: Usage;
  cost: CostBreakdown;
  score: CaseScore | null;
  error?: string;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const results: RunResult[] = [];
for (const name of CASES) {
  const dir = path.join("testset", name);
  const expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf8")) as Expected;
  const offsets = JSON.parse(await readFile(path.join(dir, "offsets.json"), "utf8")) as LineOffset[];
  const bytes = new Uint8Array(await readFile(path.join(dir, "audio.mp3")));
  for (let i = 1; i <= runsPerCase; i++) {
    const t0 = performance.now();
    try {
      const r = await processAudio(bytes);
      const totalMs = performance.now() - t0;
      const score = scoreCase(expected, r.report, r.transcript, offsets);
      results.push({ case: name, run: i, totalMs, stageMs: r.stageMs as Record<string, number>, usage: r.usage, cost: computeCost(r.usage), score });
      const failed = score.checks.filter((c) => !c.pass).length;
      console.log(`${name} #${i}: status ${score.status}${score.statusMatch ? "" : " (MISMATCH)"}, found ${score.found}/${score.expectedItems}, failed checks ${failed}, must_not violations ${score.mustNotViolations.length}, ${(totalMs / 1000).toFixed(1)} s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${name} #${i}: ERROR ${msg}`);
      results.push({ case: name, run: i, totalMs: performance.now() - t0, stageMs: {}, usage: {} as Usage, cost: {} as CostBreakdown, score: null, error: msg });
    }
  }
}

function modelLine(): string {
  const used = results.filter((r) => r.usage.llmModel);
  if (!used.length) return "?";
  const served = [...new Set(used.map((r) => r.usage.llmResolvedModel).filter(Boolean))].join(", ") || "none succeeded";
  const sources = [...new Set(used.map((r) => r.usage.llmCostSource))].join(", ");
  return `${used[0].usage.llmModel} via AI Gateway (served by ${served}; LLM cost source: ${sources})`;
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
await mkdir(path.join("eval", "results"), { recursive: true });
await writeFile(path.join("eval", "results", `${stamp}.json`), JSON.stringify(results, null, 2));

const lines: string[] = [
  `# Eval ${stamp}`,
  "",
  `Runs per case: ${runsPerCase}. Model: ${modelLine()}. API costs only (recognition + reasoning); infrastructure costs come from deployed runs.`,
  "",
  "| Case | Status match | Items found | Field checks passed | must_not violations | Extra active items | STT misses | Median / max time | Median cost per op | Median cost per audio min |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const name of CASES) {
  const rs = results.filter((r) => r.case === name);
  const ok = rs.filter((r) => r.score);
  const sum = (f: (r: RunResult) => number) => ok.reduce((s, r) => s + f(r), 0);
  const checks = ok.flatMap((r) => r.score!.checks);
  lines.push(
    `| ${name} | ${ok.filter((r) => r.score!.statusMatch).length}/${rs.length} | ${sum((r) => r.score!.found)}/${sum((r) => r.score!.expectedItems)} | ${checks.filter((c) => c.pass).length}/${checks.length} | ${sum((r) => r.score!.mustNotViolations.length)} | ${sum((r) => r.score!.extraActive.length)} | ${sum((r) => r.score!.sttMisses.length)} | ${(median(rs.map((r) => r.totalMs)) / 1000).toFixed(1)} s / ${(Math.max(...rs.map((r) => r.totalMs)) / 1000).toFixed(1)} s | $${median(ok.map((r) => r.cost.total)).toFixed(4)} | $${median(ok.map((r) => r.cost.perAudioMinute ?? 0)).toFixed(4)} |`,
  );
}
lines.push("", "## Stage timings (median ms)", "", "| Case | file-check | transcribe | precheck | extract | verify |", "|---|---|---|---|---|---|");
for (const name of CASES) {
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
  ];
  lines.push(`- **${r.case} #${r.run}**: ${problems.length ? problems.join("; ") : "all checks passed"}${s.extraOther.length ? ` (other extras: ${s.extraOther.join("; ")})` : ""}`);
}
await writeFile(path.join("eval", "results", `${stamp}.md`), lines.join("\n") + "\n");
console.log(`\nWrote eval/results/${stamp}.md`);
