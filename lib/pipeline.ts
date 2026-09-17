import { EXTRACT_MODEL, ExtractionError, extractCommitments, type Generate, type LlmAttempt } from "@/lib/extract/llm";
import { checkAudioFile, type FileCheckFail, type FileCheckOk } from "@/lib/gate/file-check";
import { precheck } from "@/lib/gate/precheck";
import { emptyUsage } from "@/lib/metrics";
import { transcribeBytes, type DeepgramResponse } from "@/lib/stt/deepgram";
import type { LlmCostSource, Report, RunEvent, Stage, Transcript, Usage } from "@/lib/types";
import { verify } from "@/lib/verify/verify";

export type StageMs = Partial<Record<Stage, number>>;
export type OnEvent = (stage: Stage, type: RunEvent["type"], detail: string, ms?: number) => void;
const noop: OnEvent = () => {};

export class StageError extends Error {
  constructor(public stage: Stage, message: string, public attempts: LlmAttempt[] = []) {
    super(message);
    this.name = "StageError";
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type TranscribeOutcome =
  | { kind: "rejected"; check: FileCheckFail; ms: StageMs }
  | { kind: "declined"; check: FileCheckOk; transcript: Transcript; raw: DeepgramResponse; reasons: string[]; ms: StageMs }
  | { kind: "transcribed"; check: FileCheckOk; transcript: Transcript; raw: DeepgramResponse; ms: StageMs };

export function declinedReport(reasons: string[]): Report {
  return { status: "declined", declineReasons: reasons, clarifications: [], speakers: [], items: [], dropped: [], metrics: null };
}

export async function runTranscribe(bytes: Uint8Array, onEvent: OnEvent = noop): Promise<TranscribeOutcome> {
  const ms: StageMs = {};
  onEvent("file-check", "started", `${bytes.byteLength} bytes`);
  let t = performance.now();
  const check = await checkAudioFile(bytes);
  ms["file-check"] = performance.now() - t;
  if (!check.ok) {
    onEvent("file-check", "rejected", `${check.code}: ${check.message}`, ms["file-check"]);
    return { kind: "rejected", check, ms };
  }
  onEvent("file-check", "finished", `${check.detectedFormat}, ${check.durationSec?.toFixed(1) ?? "unknown"} s, audio only`, ms["file-check"]);

  onEvent("transcribe", "started", "Deepgram nova-3");
  t = performance.now();
  let transcript: Transcript;
  let raw: DeepgramResponse;
  try {
    ({ transcript, raw } = await transcribeBytes(bytes, check.mime));
  } catch (e) {
    throw new StageError("transcribe", errMsg(e));
  }
  ms.transcribe = performance.now() - t;
  onEvent("transcribe", "finished", `${transcript.utterances.length} utterances, ${transcript.durationSec.toFixed(1)} s`, ms.transcribe);

  t = performance.now();
  const reasons = precheck(transcript);
  ms.precheck = performance.now() - t;
  if (reasons.length) {
    onEvent("precheck", "rejected", reasons.join(" "), ms.precheck);
    return { kind: "declined", check, transcript, raw, reasons, ms };
  }
  onEvent("precheck", "finished", "2 speakers, enough speech", ms.precheck);
  return { kind: "transcribed", check, transcript, raw, ms };
}

export async function runExtract(
  transcript: Transcript,
  onEvent: OnEvent = noop,
  generate?: Generate,
): Promise<{ report: Report; attempts: LlmAttempt[]; ms: StageMs }> {
  const ms: StageMs = {};
  onEvent("extract", "started", `Model ${EXTRACT_MODEL}`);
  let t = performance.now();
  let result: Awaited<ReturnType<typeof extractCommitments>>;
  try {
    result = await extractCommitments(transcript, generate);
  } catch (e) {
    const attempts = e instanceof ExtractionError ? e.attempts : [];
    attempts.forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.finishReason}`));
    throw new StageError("extract", errMsg(e), attempts);
  }
  result.attempts
    .filter((a) => !a.ok)
    .forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.finishReason}`));
  ms.extract = performance.now() - t;
  const served = result.attempts[result.attempts.length - 1].model;
  onEvent("extract", "finished", `${result.extraction.items.length} items proposed by ${served}`, ms.extract);

  t = performance.now();
  const report = verify(transcript, result.extraction);
  ms.verify = performance.now() - t;
  onEvent("verify", "finished", `${report.items.length} items kept, ${report.dropped.length} dropped; status ${report.status}`, ms.verify);
  return { report, attempts: result.attempts, ms };
}

const COST_SOURCE_RANK: Record<LlmCostSource, number> = { gateway: 0, estimated: 1, unknown: 2 };

function addAttempts(usage: Usage, attempts: LlmAttempt[]) {
  for (const a of attempts) {
    usage.llmInputTokens += a.inputTokens;
    usage.llmOutputTokens += a.outputTokens;
    usage.llmAttempts += 1;
    usage.llmCostUsd += a.costUsd;
    if (COST_SOURCE_RANK[a.costSource] > COST_SOURCE_RANK[usage.llmCostSource]) usage.llmCostSource = a.costSource;
    if (a.ok) usage.llmResolvedModel = a.model;
  }
}

/** Eval path: same processing as the app, no storage; usage covers API calls only. */
export async function processAudio(bytes: Uint8Array): Promise<{ report: Report; transcript: Transcript | null; stageMs: StageMs; usage: Usage }> {
  const usage: Usage = { ...emptyUsage(EXTRACT_MODEL), retentionDays: 0, vcpu: 0, memoryGib: 0 };
  const tr = await runTranscribe(bytes);
  if (tr.kind === "rejected") return { report: declinedReport([tr.check.message]), transcript: null, stageMs: tr.ms, usage };
  usage.audioSeconds = tr.transcript.durationSec;
  if (tr.kind === "declined") return { report: declinedReport(tr.reasons), transcript: tr.transcript, stageMs: tr.ms, usage };
  try {
    const ex = await runExtract(tr.transcript);
    addAttempts(usage, ex.attempts);
    return { report: ex.report, transcript: tr.transcript, stageMs: { ...tr.ms, ...ex.ms }, usage };
  } catch (e) {
    if (e instanceof StageError) addAttempts(usage, e.attempts);
    throw e;
  }
}

export { addAttempts };
