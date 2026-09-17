import { computeCost } from "@/lib/metrics";
import { addAttempts, declinedReport, runExtract, runTranscribe, StageError, type OnEvent } from "@/lib/pipeline";
import { chargeInvocation, startMeter, type Meter } from "@/lib/runs/meter";
import { addEvent, type Runs } from "@/lib/runs/runs";
import type { Metrics, Report, Run, Transcript } from "@/lib/types";

export class ConflictError extends Error {}

/** A "transcribing"/"extracting" run older than this is assumed to have died (crash, timeout) and is retried. */
const STALE_STAGE_MS = 150_000;

function isStaleInFlight(stageStartedAt: string | null): boolean {
  if (!stageStartedAt) return true;
  return Date.now() - Date.parse(stageStartedAt) >= STALE_STAGE_MS;
}

function accountRequest(run: Run, meter: Meter) {
  chargeInvocation(run.usage, meter);
  // So a failed run still shows the cost already incurred, not just successful ones.
  run.cost = computeCost(run.usage);
}

/** Final accounting. `pendingWrites` are the uncounted report.json/run.json writes that follow. */
function finalizeRun(run: Run, meter: Meter, pendingWrites: number): Metrics {
  accountRequest(run, meter);
  run.usage.blobAdvancedOps += pendingWrites;
  run.timeToResultMs = Date.now() - Date.parse(run.createdAt);
  run.cost = computeCost(run.usage);
  return { stageMs: run.stageMs, timeToResultMs: run.timeToResultMs, usage: run.usage, cost: run.cost };
}

const logTo = (run: Run): OnEvent => (stage, type, detail, ms) => addEvent(run, stage, type, detail, ms);

export async function stageTranscribe(runs: Runs, run: Run): Promise<Run> {
  let allowed = run.status === "created" || (run.status === "failed" && (run.failedStage === "upload" || run.failedStage === "transcribe"));
  if (run.status === "transcribing") {
    if (!isStaleInFlight(run.stageStartedAt)) throw new ConflictError("Transcription already in progress");
    addEvent(run, "transcribe", "failed", "previous attempt timed out");
    allowed = true;
  }
  if (!allowed) return run;
  const meter = startMeter();

  let bytes: Uint8Array | null;
  try {
    bytes = await runs.getAudio(run);
  } catch (e) {
    addEvent(run, "upload", "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = "upload";
    run.stageStartedAt = null;
    accountRequest(run, meter);
    await runs.save(run);
    return run;
  }
  if (!bytes) {
    addEvent(run, "upload", "failed", "Audio file not found in storage; the upload did not complete");
    run.status = "failed";
    run.failedStage = "upload";
    run.stageStartedAt = null;
    accountRequest(run, meter);
    await runs.save(run);
    return run;
  }
  if (!run.events.some((e) => e.stage === "upload" && e.type === "finished")) {
    run.usage.blobAdvancedOps += 1; // the browser's presigned PUT
    run.usage.storedBytes += bytes.byteLength;
    // Downloaded twice: read above for transcription, and one assumed playback of the recording.
    run.usage.blobTransferBytes += 2 * bytes.byteLength;
    run.usage.blobSimpleOps += 1; // the assumed playback's presigned GET
    addEvent(run, "upload", "finished", `Received ${bytes.byteLength} bytes`);
  }

  run.status = "transcribing";
  run.failedStage = null;
  run.stageStartedAt = new Date().toISOString();
  await runs.save(run); // counted write: marks this run in-flight before the paid Deepgram call

  // Only the paid Deepgram call and its transcript/raw writes are allowed to land in the
  // failure path below; a report.json/run.json write failure after that must propagate
  // to the caller instead of being mistaken for a failed transcription (see stageExtract).
  let outcome: Awaited<ReturnType<typeof runTranscribe>>;
  try {
    outcome = await runTranscribe(bytes, logTo(run));
    Object.assign(run.stageMs, outcome.ms);
    run.file.detectedFormat = outcome.check.detectedFormat;
    run.file.mime = outcome.check.mime;
    run.file.durationSec = outcome.check.durationSec;
    run.file.hasVideo = outcome.check.hasVideo;

    if (outcome.kind !== "rejected") {
      run.usage.audioSeconds += outcome.transcript.durationSec;
      await runs.putJson(run, "transcript.json", outcome.transcript);
      await runs.putJson(run, "raw/deepgram.json", outcome.raw);
    }
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "transcribe";
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
    run.stageStartedAt = null;
    accountRequest(run, meter);
    await runs.save(run);
    return run;
  }

  if (outcome.kind === "rejected") {
    run.status = "rejected";
    run.rejection = { code: outcome.check.code, message: outcome.check.message };
    run.stageStartedAt = null;
    finalizeRun(run, meter, 1);
    await runs.save(run, { counted: false });
    return run;
  }

  if (outcome.kind === "declined") {
    run.status = "done";
    run.reportStatus = "declined";
    run.stageStartedAt = null;
    const metrics = finalizeRun(run, meter, 2);
    await runs.putJson(run, "report.json", { ...declinedReport(outcome.reasons), metrics }, { counted: false });
    await runs.save(run, { counted: false });
    return run;
  }

  run.status = "transcribed";
  run.stageStartedAt = null;
  accountRequest(run, meter);
  await runs.save(run);
  return run;
}

export async function stageExtract(runs: Runs, run: Run): Promise<{ run: Run; report: Report | null }> {
  if (run.status === "done") return { run, report: await runs.getJson<Report>(run.id, "report.json") };
  let allowed = run.status === "transcribed" || (run.status === "failed" && (run.failedStage === "extract" || run.failedStage === "verify"));
  if (run.status === "extracting") {
    if (!isStaleInFlight(run.stageStartedAt)) throw new ConflictError("Extraction already in progress");
    addEvent(run, "extract", "failed", "previous attempt timed out");
    allowed = true;
  }
  if (!allowed) throw new ConflictError(`Run is "${run.status}"; extraction needs a transcribed run`);
  const meter = startMeter();

  const transcript = await runs.getJson<Transcript>(run.id, "transcript.json");
  run.usage.blobSimpleOps += 1;
  if (!transcript) throw new ConflictError("Transcript not found for this run");

  run.status = "extracting";
  run.failedStage = null;
  run.stageStartedAt = new Date().toISOString();
  await runs.save(run); // counted write: marks this run in-flight before the paid LLM call

  let out: Awaited<ReturnType<typeof runExtract>>;
  try {
    out = await runExtract(transcript, logTo(run));
    addAttempts(run.usage, out.attempts);
    Object.assign(run.stageMs, out.ms);
    await runs.putJson(run, "raw/llm.json", out.attempts.map((a) => a.raw));
  } catch (e) {
    const stage = e instanceof StageError ? e.stage : "extract";
    if (e instanceof StageError && e.attempts.length) {
      addAttempts(run.usage, e.attempts);
      try {
        await runs.putJson(run, "raw/llm.json", e.attempts.map((a) => a.raw ?? { error: a.error }));
      } catch (writeErr) {
        addEvent(
          run,
          stage,
          "failed",
          `Could not store the raw LLM response: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        );
      }
    }
    addEvent(run, stage, "failed", e instanceof Error ? e.message : String(e));
    run.status = "failed";
    run.failedStage = stage;
    run.stageStartedAt = null;
    accountRequest(run, meter);
    await runs.save(run);
    return { run, report: null };
  }

  run.status = "done";
  run.reportStatus = out.report.status;
  run.stageStartedAt = null;
  const metrics = finalizeRun(run, meter, 2);
  const report: Report = { ...out.report, metrics };
  await runs.putJson(run, "report.json", report, { counted: false });
  await runs.save(run, { counted: false });
  return { run, report };
}
