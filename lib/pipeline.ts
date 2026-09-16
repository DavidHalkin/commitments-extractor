import type Anthropic from "@anthropic-ai/sdk";
import { EXTRACT_MODEL, ExtractionError, extractCommitments, type ClaudeAttempt } from "@/lib/extract/claude";
import { checkAudioFile, type FileCheckFail, type FileCheckOk } from "@/lib/gate/file-check";
import { precheck } from "@/lib/gate/precheck";
import { emptyUsage } from "@/lib/metrics";
import { transcribeBytes, type DeepgramResponse } from "@/lib/stt/deepgram";
import type { Report, RunEvent, Stage, Transcript, Usage } from "@/lib/types";
import { verify } from "@/lib/verify/verify";

export type StageMs = Partial<Record<Stage, number>>;
export type OnEvent = (stage: Stage, type: RunEvent["type"], detail: string, ms?: number) => void;
const noop: OnEvent = () => {};

export class StageError extends Error {
  constructor(public stage: Stage, message: string, public attempts: ClaudeAttempt[] = []) {
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
  client?: Anthropic,
): Promise<{ report: Report; attempts: ClaudeAttempt[]; ms: StageMs }> {
  const ms: StageMs = {};
  onEvent("extract", "started", `Model ${EXTRACT_MODEL}`);
  let t = performance.now();
  let result: Awaited<ReturnType<typeof extractCommitments>>;
  try {
    result = await extractCommitments(transcript, client);
  } catch (e) {
    const attempts = e instanceof ExtractionError ? e.attempts : [];
    attempts.forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.stopReason}`));
    throw new StageError("extract", errMsg(e), attempts);
  }
  result.attempts
    .filter((a) => !a.ok)
    .forEach((a, i) => onEvent("extract", "retry", `Attempt ${i + 1} failed: ${a.error ?? a.stopReason}`));
  ms.extract = performance.now() - t;
  onEvent("extract", "finished", `${result.extraction.items.length} items proposed by the model`, ms.extract);

  t = performance.now();
  const report = verify(transcript, result.extraction);
  ms.verify = performance.now() - t;
  onEvent("verify", "finished", `${report.items.length} items kept, ${report.dropped.length} dropped; status ${report.status}`, ms.verify);
  return { report, attempts: result.attempts, ms };
}

function addAttempts(usage: Usage, attempts: ClaudeAttempt[]) {
  for (const a of attempts) {
    usage.claudeInputTokens += a.inputTokens;
    usage.claudeOutputTokens += a.outputTokens;
    usage.claudeAttempts += 1;
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
