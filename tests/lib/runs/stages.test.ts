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
  ExtractionError: class extends Error {},
  extractCommitments: vi.fn(async () => ({
    extraction,
    attempts: [{ ok: true, stopReason: "end_turn", inputTokens: 1200, outputTokens: 400, raw: {} }],
  })),
}));

const { LocalStore } = await import("@/lib/store/local");
const { Runs } = await import("@/lib/runs/runs");
const { stageExtract, stageTranscribe } = await import("@/lib/runs/stages");

let root: string;
let runs: InstanceType<typeof Runs>;
let store: InstanceType<typeof LocalStore>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stages-"));
  store = new LocalStore(root);
  runs = new Runs(store);
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
    const { transcribeBytes } = await import("@/lib/stt/deepgram");
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
});
