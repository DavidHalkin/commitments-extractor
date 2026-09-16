import { computeCost } from "@/lib/metrics";
import { addAttempts, declinedReport, runExtract, runTranscribe, StageError, type OnEvent } from "@/lib/pipeline";
import { addEvent, type Runs } from "@/lib/runs/runs";
import type { Metrics, Report, Run, Transcript } from "@/lib/types";

export class ConflictError extends Error {}

function accountRequest(run: Run, startedAt: number) {
  run.usage.cloudRunRequests += 1;
  run.usage.cloudRunSeconds += (Date.now() - startedAt) / 1000;
}

/** Final accounting. `pendingWrites` are the uncounted report.json/run.json writes that follow. */
function finalizeRun(run: Run, startedAt: number, pendingWrites: number): Metrics {
  accountRequest(run, startedAt);
  run.usage.gcsClassA += pendingWrites;
  run.timeToResultMs = Date.now() - Date.parse(run.createdAt);
  run.cost = computeCost(run.usage);
  return { stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost };
}

const logTo = (run: Run): OnEvent => (stage, type, detail, ms) => addEvent(run, stage, type, detail, ms);

export async function stageTranscribe(runs: Runs, run: Run): Promise<Run> {
  const allowed = run.status === "created" || (run.status === "failed" && (run.failedStage === "upload" || run.failedStage === "transcribe"));
  if (!allowed) return run;
  const startedAt = Date.now();

  const bytes = await runs.getAudio(run);
  if (!bytes) {
    addEvent(run, "upload", "failed", "Audio file not found in storage; the upload did not complete");
    run.status = "failed";
    run.failedStage = "upload";
    accountRequest(run, startedAt);
    await runs.save(run);
    return run;
  }
  if (!run.events.some((e) => e.stage === "upload" && e.type === "finished")) {
    run.usage.gcsClassA += 1; // the browser's PUT
    run.usage.storedBytes += bytes.byteLength;
    run.usage.egressBytes += bytes.byteLength; // assumption: the recording is played back once
    addEvent(run, "upload", "finished", `Received ${bytes.byteLength} bytes`);
  }

  run.status = "transcribing";
  run.failedStage = null;
  try {
    const outcome = await runTranscribe(bytes, logTo(run));
    Object.assign(run.stageMs, outcome.ms);
    run.file.detectedFormat = outcome.check.detectedFormat;
    run.file.mime = outcome.check.mime;
    run.file.durationSec = outcome.check.durationSec;
    run.file.hasVideo = outcome.check.hasVideo;

    if (outcome.kind === "rejected") {
      run.status = "rejected";
      run.rejection = { code: outcome.check.code, message: outcome.check.message };
      finalizeRun(run, startedAt, 1);
      await runs.save(run, { counted: false });
      return run;
    }

    run.usage.audioSeconds = outcome.transcript.durationSec;
    await runs.putJson(run, "transcript.json", outcome.transcript);
    await runs.putJson(run, "raw/deepgram.json", outcome.raw);

    if (outcome.kind === "declined") {
      run.status = "done";
      run.reportStatus = "declined";
      const metrics = finalizeRun(run, startedAt, 2);
      await runs.putJson(run, "report.json", { ...declinedReport(outcome.reasons), metrics }, { counted: false });
      await runs.save(run, { counted: false });
      return run;
    }

    run.status = "transcribed";
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "transcribe";
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
  }
  accountRequest(run, startedAt);
  await runs.save(run);
  return run;
}

export async function stageExtract(runs: Runs, run: Run): Promise<{ run: Run; report: Report | null }> {
  if (run.status === "done") return { run, report: await runs.getJson<Report>(run.id, "report.json") };
  const allowed = run.status === "transcribed" || (run.status === "failed" && (run.failedStage === "extract" || run.failedStage === "verify"));
  if (!allowed) throw new ConflictError(`Run is "${run.status}"; transcribe it first`);
  const startedAt = Date.now();

  const transcript = await runs.getJson<Transcript>(run.id, "transcript.json");
  run.usage.gcsClassB += 1;
  if (!transcript) throw new ConflictError("Transcript not found for this run");

  run.status = "extracting";
  run.failedStage = null;
  try {
    const out = await runExtract(transcript, logTo(run));
    addAttempts(run.usage, out.attempts);
    Object.assign(run.stageMs, out.ms);
    await runs.putJson(run, "raw/claude.json", out.attempts.map((a) => a.raw));
    run.status = "done";
    run.reportStatus = out.report.status;
    const metrics = finalizeRun(run, startedAt, 2);
    const report: Report = { ...out.report, metrics };
    await runs.putJson(run, "report.json", report, { counted: false });
    await runs.save(run, { counted: false });
    return { run, report };
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "extract";
    if (e instanceof StageError && e.attempts.length) {
      addAttempts(run.usage, e.attempts);
      await runs.putJson(run, "raw/claude.json", e.attempts.map((a) => a.raw ?? { error: a.error }));
    }
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
    accountRequest(run, startedAt);
    await runs.save(run);
    return { run, report: null };
  }
}
