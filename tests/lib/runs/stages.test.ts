import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([
  [0, "Hi, I'm Anna, the project manager for this launch."],
  [1, "Hi, I'm Mark, the developer on the team."],
  [1, "I'll write the API docs by Wednesday."],
]);

vi.mock("@/lib/stt/deepgram", () => ({
  transcribeBytes: vi.fn(async () => ({ transcript, raw: { mocked: true } })),
}));

const extraction: Extraction = {
  speakers: [
    { speaker: 0, name: "Anna", intro_utterance_id: "u1" },
    { speaker: 1, name: "Mark", intro_utterance_id: "u2" },
  ],
  no_commitments_discussed: false,
  items: [
    {
      kind: "task",
      summary: "Write API docs",
      final_status: "active",
      owner: { status: "agreed", name: "Mark", evidence: { utterance_id: "u3", quote: "I'll write the API docs" } },
      deadline: { status: "agreed", wording: "by Wednesday", evidence: { utterance_id: "u3", quote: "I'll write the API docs by Wednesday" }, resolved_date: null, anchor_utterance_id: null },
      events: [{ type: "accepted", utterance_id: "u3", quote: "I'll write the API docs by Wednesday" }],
    },
  ],
};

vi.mock("@/lib/extract/claude", () => ({
  EXTRACT_MODEL: "claude-sonnet-5",
  ExtractionError: class ExtractionError extends Error {
    attempts: unknown[];
    constructor(message: string, attempts: unknown[]) {
      super(message);
      this.attempts = attempts;
    }
  },
  extractCommitments: vi.fn(async () => ({
    extraction,
    attempts: [{ ok: true, stopReason: "end_turn", inputTokens: 1200, outputTokens: 400, raw: {} }],
  })),
}));

const { LocalStore } = await import("@/lib/store/local");
const { Runs } = await import("@/lib/runs/runs");
const { ConflictError, stageExtract, stageTranscribe } = await import("@/lib/runs/stages");
const { transcribeBytes } = await import("@/lib/stt/deepgram");
const { extractCommitments, ExtractionError } = await import("@/lib/extract/claude");

const defaultTranscribeImpl = vi.mocked(transcribeBytes).getMockImplementation()!;
const defaultExtractImpl = vi.mocked(extractCommitments).getMockImplementation()!;

let root: string;
let runs: InstanceType<typeof Runs>;
let store: InstanceType<typeof LocalStore>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stages-"));
  store = new LocalStore(root);
  runs = new Runs(store);
  vi.mocked(transcribeBytes).mockReset();
  vi.mocked(transcribeBytes).mockImplementation(defaultTranscribeImpl);
  vi.mocked(extractCommitments).mockReset();
  vi.mocked(extractCommitments).mockImplementation(defaultExtractImpl);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function uploaded(fixture: string) {
  const bytes = new Uint8Array(readFileSync(path.join("testset", "invalid", fixture)));
  const { run } = await runs.create({ name: fixture, sizeBytes: bytes.byteLength, declaredType: "audio/mpeg" }, "claude-sonnet-5");
  await store.put(runs.audioKey(run.id), bytes, "application/octet-stream");
  return run;
}

describe("stages", () => {
  it("rejects a renamed video without calling Deepgram and keeps it in history", async () => {
    const run = await uploaded("video-renamed.mp3");
    const after = await stageTranscribe(runs, run);
    expect(after.status).toBe("rejected");
    expect(after.rejection?.code).toBe("contains_video");
    expect(after.cost?.recognition).toBe(0);
    expect(transcribeBytes).not.toHaveBeenCalled();
    expect((await runs.list())[0].status).toBe("rejected");
  });

  it("runs transcribe then extract and stores transcript, report and metrics", async () => {
    const run = await uploaded("wav-renamed.mp3");
    const transcribed = await stageTranscribe(runs, run);
    expect(transcribed.status).toBe("transcribed");
    const { run: done, report } = await stageExtract(runs, transcribed);
    expect(done.status).toBe("done");
    expect(done.reportStatus).toBe("ok");
    expect(report?.items[0].owner.name).toBe("Mark");
    expect(report?.metrics?.usage.claudeInputTokens).toBe(1200);
    expect(report?.metrics?.cost.total).toBeGreaterThan(0);
    expect(done.events.map((e) => `${e.stage}:${e.type}`)).toEqual([
      "upload:started", "upload:finished", "file-check:started", "file-check:finished",
      "transcribe:started", "transcribe:finished", "precheck:finished",
      "extract:started", "extract:finished", "verify:finished",
    ]);
    expect(await runs.getJson(done.id, "report.json")).toMatchObject({ status: "ok" });
    const again = await stageExtract(runs, done);
    expect(again.report?.status).toBe("ok");
  });

  it("marks a run failed when the upload never arrived", async () => {
    const { run } = await runs.create({ name: "x.mp3", sizeBytes: 5000, declaredType: "" }, "claude-sonnet-5");
    const after = await stageTranscribe(runs, run);
    expect(after).toMatchObject({ status: "failed", failedStage: "upload" });
  });

  it("fails on a Deepgram error, accounts the cost, and succeeds on retry", async () => {
    const run = await uploaded("wav-renamed.mp3");
    vi.mocked(transcribeBytes).mockRejectedValueOnce(new Error("Deepgram 503"));

    const failed = await stageTranscribe(runs, run);
    expect(failed.status).toBe("failed");
    expect(failed.failedStage).toBe("transcribe");
    expect(failed.events.some((e) => e.detail.includes("503"))).toBe(true);
    expect(failed.cost).not.toBeNull();

    const reloaded = await runs.get(failed.id);
    const after = await stageTranscribe(runs, reloaded!);
    expect(after.status).toBe("transcribed");
  });

  it("counts every Claude attempt, even failed ones, when extraction fails", async () => {
    const run = await uploaded("wav-renamed.mp3");
    const transcribed = await stageTranscribe(runs, run);

    const attempts = [
      { ok: false, stopReason: "max_tokens", inputTokens: 1000, outputTokens: 16000, error: "truncated", raw: { truncated: true } },
      { ok: false, stopReason: null, inputTokens: 0, outputTokens: 0, error: "network error", raw: null },
    ];
    vi.mocked(extractCommitments).mockRejectedValueOnce(new ExtractionError("Extraction failed after 2 attempts", attempts));

    const { run: failed, report } = await stageExtract(runs, transcribed);
    expect(report).toBeNull();
    expect(failed.status).toBe("failed");
    expect(failed.failedStage).toBe("extract");
    expect(failed.usage.claudeInputTokens).toBe(1000);
    expect(failed.usage.claudeOutputTokens).toBe(16000);
    expect(failed.usage.claudeAttempts).toBe(2);
    expect(failed.cost).not.toBeNull();
    expect(await runs.getJson(failed.id, "raw/claude.json")).not.toBeNull();
  });

  it("guards a concurrent extract in flight and recovers once it is stale", async () => {
    const run = await uploaded("wav-renamed.mp3");
    const transcribed = await stageTranscribe(runs, run);

    transcribed.status = "extracting";
    transcribed.stageStartedAt = new Date().toISOString();
    await runs.save(transcribed);

    const inFlight = await runs.get(transcribed.id);
    await expect(stageExtract(runs, inFlight!)).rejects.toThrow(ConflictError);

    const stale = await runs.get(transcribed.id);
    stale!.stageStartedAt = new Date(Date.now() - 200_000).toISOString();
    await runs.save(stale!);
    const staleLoaded = await runs.get(transcribed.id);

    const { run: done } = await stageExtract(runs, staleLoaded!);
    expect(done.status).toBe("done");
  });

  it("propagates a report.json storage error on the declined path without entering the transcribe-failure path", async () => {
    class ThrowingReportStore extends LocalStore {
      async put(key: string, data: Uint8Array | string, contentType?: string): Promise<void> {
        if (key.endsWith("report.json")) throw new Error("disk full");
        return super.put(key, data, contentType);
      }
    }
    const throwingRuns = new Runs(new ThrowingReportStore(root));

    // Only one speaker and too few words: precheck declines it, taking the "declined" branch
    // in stageTranscribe, which is the one that writes report.json.
    const declinedTranscript = makeTranscript([[0, "Hi, I'm Anna, the project manager for this launch."]]);
    vi.mocked(transcribeBytes).mockResolvedValueOnce({ transcript: declinedTranscript, raw: { metadata: { duration: 0 }, results: {} } });

    const run = await uploaded("wav-renamed.mp3");
    await expect(stageTranscribe(throwingRuns, run)).rejects.toThrow("disk full");

    // The report.json write failure must not be mistaken for a failed transcription: the
    // persisted run should still be the in-flight "transcribing" marker saved just before the
    // (successful) Deepgram call, not a "failed"/"transcribe" run.
    const persisted = await runs.get(run.id);
    expect(persisted?.status).toBe("transcribing");
    expect(persisted?.failedStage).toBeNull();
    expect(persisted?.events.some((e) => e.stage === "transcribe" && e.type === "failed")).toBe(false);
  });
});
