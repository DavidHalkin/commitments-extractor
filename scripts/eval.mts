import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeCost } from "@/lib/metrics";
import { renderReport, scoreCase, type Expected, type LineOffset, type RunResult } from "@/scripts/eval-lib";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CASES = ["01-normal", "02-changed", "03-clarify"];
const runsPerCase = Number(arg("runs") ?? 3);
// Seconds to wait between runs; the AI Gateway free tier rate-limits each model.
const pauseSec = Number(arg("pause") ?? 0);

const outDir = path.join("eval", "results");
const write = async (stamp: string, results: RunResult[], runs: number) => {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${stamp}.json`), JSON.stringify(results, null, 2));
  await writeFile(path.join(outDir, `${stamp}.md`), renderReport(stamp, runs, CASES, results));
  console.log(`\nWrote ${path.join(outDir, `${stamp}.md`)}`);
};

const caseFiles = async (name: string) => ({
  expected: JSON.parse(await readFile(path.join("testset", name, "expected.json"), "utf8")) as Expected,
  offsets: JSON.parse(await readFile(path.join("testset", name, "offsets.json"), "utf8")) as LineOffset[],
});

// Re-scores and re-renders a stored results JSON with the current scorer, so fixing either never costs
// another set of API calls. Runs that stored no report keep the score they were written with.
const rerender = arg("render");
if (rerender) {
  const stored = JSON.parse(await readFile(rerender, "utf8")) as RunResult[];
  for (const name of CASES) {
    const { expected, offsets } = await caseFiles(name);
    for (const r of stored.filter((x) => x.case === name && x.report)) {
      r.score = scoreCase(expected, r.report!, null, offsets);
    }
  }
  const stamp = path.basename(rerender, ".json");
  await write(stamp, stored, Math.max(...CASES.map((c) => stored.filter((r) => r.case === c).length)));
  process.exit(0);
}

// EXTRACT_MODEL is read when lib/extract/llm.ts loads, so the override must precede the pipeline import.
const modelOverride = arg("model");
if (modelOverride) process.env.EXTRACT_MODEL = modelOverride;
const { processAudio } = await import("@/lib/pipeline");

const results: RunResult[] = [];
for (const name of CASES) {
  const { expected, offsets } = await caseFiles(name);
  const bytes = new Uint8Array(await readFile(path.join("testset", name, "audio.mp3")));
  for (let i = 1; i <= runsPerCase; i++) {
    if (results.length > 0 && pauseSec > 0) await new Promise((r) => setTimeout(r, pauseSec * 1000));
    const t0 = performance.now();
    try {
      const r = await processAudio(bytes);
      const totalMs = performance.now() - t0;
      const score = scoreCase(expected, r.report, r.transcript, offsets);
      results.push({ case: name, run: i, totalMs, stageMs: r.stageMs as Record<string, number>, usage: r.usage, cost: computeCost(r.usage), score, report: r.report });
      const failed = score.checks.filter((c) => !c.pass).length;
      console.log(`${name} #${i}: status ${score.status}${score.statusMatch ? "" : " (MISMATCH)"}, found ${score.found}/${score.expectedItems}, failed checks ${failed}, must_not violations ${score.mustNotViolations.length}, ${(totalMs / 1000).toFixed(1)} s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${name} #${i}: ERROR ${msg}`);
      results.push({ case: name, run: i, totalMs: performance.now() - t0, stageMs: {}, usage: {} as RunResult["usage"], cost: {} as RunResult["cost"], score: null, error: msg });
    }
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
await write(stamp, results, runsPerCase);
