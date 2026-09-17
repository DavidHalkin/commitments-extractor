export type Word = { word: string; punctuated: string; start: number; end: number };

export type Utterance = {
  id: string;
  speaker: number;
  start: number;
  end: number;
  text: string;
  words: Word[];
};

export type Transcript = {
  durationSec: number;
  utterances: Utterance[];
  speakerStats: { speaker: number; wordCount: number }[];
};

export const EVENT_TYPES = [
  "proposed",
  "accepted",
  "assigned",
  "deadline_set",
  "deadline_changed",
  "cancelled",
  "reopened",
  "question_raised",
  "left_open",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EvidenceType = EventType | "owner" | "deadline" | "intro";

export type Evidence = {
  type: EvidenceType;
  quote: string;
  utteranceId: string;
  speaker: number;
  speakerName: string | null;
  start: number;
  end: number;
};

export type Flag =
  | "owner_missing"
  | "owner_disputed"
  | "owner_unverified"
  | "deadline_missing"
  | "deadline_disputed"
  | "deadline_unverified"
  | "date_context_missing";

export type AgreementStatus = "agreed" | "none" | "disputed";
export type FinalStatus = "active" | "cancelled" | "not_accepted" | "open";

export type VerifiedItem = {
  kind: "task" | "open_question";
  summary: string;
  finalStatus: FinalStatus;
  owner: { status: AgreementStatus; name: string | null; evidence: Evidence | null };
  deadline: {
    status: AgreementStatus;
    wording: string | null;
    resolvedDate: string | null;
    evidence: Evidence | null;
  };
  flags: Flag[];
  events: Evidence[];
};

export type Clarification = {
  about: "owner" | "deadline" | "question";
  itemSummary: string;
  question: string;
  evidence: Evidence;
};

export type ReportStatus = "ok" | "needs_clarification" | "no_commitments" | "declined";

export type Stage = "upload" | "file-check" | "transcribe" | "precheck" | "extract" | "verify";

/** Where an LLM cost figure came from, from most to least reliable. */
export type LlmCostSource = "gateway" | "estimated" | "unknown";

export type Usage = {
  audioSeconds: number;
  /** Requested AI Gateway model id. */
  llmModel: string;
  /** Provider/model that served the successful attempt, as reported by AI Gateway. */
  llmResolvedModel: string | null;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmAttempts: number;
  llmCostUsd: number;
  /** Least reliable source across all attempts. */
  llmCostSource: LlmCostSource;
  /** Blob put and list calls, including the browser's presigned PUT. */
  blobAdvancedOps: number;
  /** Blob reads, including the assumed playback's presigned GET. */
  blobSimpleOps: number;
  storedBytes: number;
  retentionDays: number;
  /** Bytes downloaded from Blob: the audio read for transcription plus one assumed playback. */
  blobTransferBytes: number;
  fnInvocations: number;
  /** Request durations; drive provisioned memory. */
  fnWallSeconds: number;
  /** Process CPU time during requests; drives Active CPU. */
  fnCpuSeconds: number;
  fnMemoryGb: number;
};

export type CostBreakdown = {
  recognition: number;
  reasoning: number;
  speech: number;
  storage: number;
  storageOps: number;
  egress: number;
  compute: number;
  total: number;
  perAudioMinute: number | null;
};

export type Metrics = {
  stageMs: Partial<Record<Stage, number>>;
  timeToResultMs: number | null;
  usage: Usage;
  cost: CostBreakdown;
};

export type Report = {
  status: ReportStatus;
  declineReasons: string[];
  clarifications: Clarification[];
  speakers: { speaker: number; name: string | null; intro: Evidence | null }[];
  items: VerifiedItem[];
  dropped: { summary: string; reason: string }[];
  metrics: Metrics | null;
};

export type RunStatus =
  | "created"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "extracting"
  | "done"
  | "rejected"
  | "failed";

export type RunEvent = {
  at: string;
  stage: Stage;
  type: "started" | "finished" | "rejected" | "failed" | "retry";
  detail: string;
  durationMs?: number;
};

export type Run = {
  id: string;
  createdAt: string;
  file: {
    name: string;
    sizeBytes: number;
    declaredType: string;
    detectedFormat: string | null;
    mime: string | null;
    durationSec: number | null;
    hasVideo: boolean | null;
  };
  status: RunStatus;
  failedStage: Stage | null;
  /** Set when entering "transcribing"/"extracting"; used to detect and recover from stuck in-flight stages. */
  stageStartedAt: string | null;
  rejection: { code: string; message: string } | null;
  reportStatus: ReportStatus | null;
  events: RunEvent[];
  stageMs: Partial<Record<Stage, number>>;
  usage: Usage;
  timeToResultMs: number | null;
  cost: CostBreakdown | null;
};

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };
