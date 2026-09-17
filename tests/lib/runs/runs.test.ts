import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStore } from "@/lib/store/local";
import { addEvent, newRunId, RUN_ID_RE, Runs } from "@/lib/runs/runs";

let root: string;
let store: LocalStore;
let runs: Runs;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "runs-"));
  store = new LocalStore(root);
  runs = new Runs(store);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("newRunId", () => {
  it("is sortable by time and matches the id pattern", () => {
    const id = newRunId(new Date("2026-09-16T13:25:01.123Z"), () => 0);
    expect(id).toBe("20260916T132501Z-aaaaaa");
    expect(RUN_ID_RE.test(id)).toBe(true);
  });
});

describe("Runs", () => {
  it("creates a run with an upload target and persists run.json", async () => {
    const { run, upload } = await runs.create({ name: "meeting.mp3", sizeBytes: 2048, declaredType: "audio/mpeg" }, "anthropic/claude-sonnet-5");
    expect(upload).toEqual({ url: `/api/runs/${run.id}/upload`, method: "PUT", headers: {} });
    const loaded = await runs.get(run.id);
    expect(loaded?.status).toBe("created");
    expect(loaded?.events[0]).toMatchObject({ stage: "upload", type: "started" });
    expect(loaded?.usage.blobAdvancedOps).toBe(1);
    expect(loaded?.usage.fnInvocations).toBe(1);
  });

  it("appends events and stores JSON documents", async () => {
    const { run } = await runs.create({ name: "a.mp3", sizeBytes: 2048, declaredType: "" }, "anthropic/claude-sonnet-5");
    addEvent(run, "file-check", "rejected", "contains_video", 12.4);
    await runs.putJson(run, "transcript.json", { hello: "world" });
    await runs.save(run);
    const loaded = await runs.get(run.id);
    expect(loaded?.events.at(-1)).toMatchObject({ stage: "file-check", type: "rejected", detail: "contains_video", durationMs: 12 });
    expect(await runs.getJson(run.id, "transcript.json")).toEqual({ hello: "world" });
    expect(loaded?.usage.storedBytes).toBe(JSON.stringify({ hello: "world" }).length);
  });

  it("lists newest first and deletes all objects of a run", async () => {
    const a = await runs.create({ name: "a.mp3", sizeBytes: 2048, declaredType: "" }, "anthropic/claude-sonnet-5");
    await new Promise((r) => setTimeout(r, 1100));
    const b = await runs.create({ name: "b.mp3", sizeBytes: 2048, declaredType: "" }, "anthropic/claude-sonnet-5");
    expect((await runs.list()).map((r) => r.file.name)).toEqual(["b.mp3", "a.mp3"]);
    expect(await runs.delete(a.run.id)).toBe(true);
    expect(await runs.get(a.run.id)).toBeNull();
    expect((await runs.list()).map((r) => r.id)).toEqual([b.run.id]);
  });

  it("reads runs stored before the Vercel migration with their usage mapped to the current fields", async () => {
    const id = "20260916T210344Z-z4ob5t";
    const legacy = {
      id,
      createdAt: "2026-09-16T21:03:44.000Z",
      file: { name: "old.mp3", sizeBytes: 2048, declaredType: "", detectedFormat: "mp3", mime: "audio/mpeg", durationSec: 38.3, hasVideo: false },
      status: "failed",
      failedStage: "extract",
      stageStartedAt: null,
      rejection: null,
      reportStatus: null,
      events: [],
      stageMs: {},
      usage: {
        audioSeconds: 38.3, claudeModel: "claude-sonnet-5", claudeInputTokens: 1200, claudeOutputTokens: 300, claudeAttempts: 2,
        gcsClassA: 9, gcsClassB: 4, storedBytes: 4096, retentionDays: 30, egressBytes: 2048,
        cloudRunRequests: 3, cloudRunSeconds: 1.8, vcpu: 1, memoryGib: 1,
      },
      timeToResultMs: null,
      cost: { recognition: 0.003, reasoning: 0.0054, speech: 0, storage: 0, storageOps: 0, egress: 0, compute: 0, total: 0.0084, perAudioMinute: 0.013 },
    };
    await store.put(`runs/${id}/run.json`, JSON.stringify(legacy), "application/json");

    const loaded = await runs.get(id);
    expect(loaded?.usage).toEqual({
      audioSeconds: 38.3,
      llmModel: "claude-sonnet-5",
      llmResolvedModel: null,
      llmInputTokens: 1200,
      llmOutputTokens: 300,
      llmAttempts: 2,
      llmCostUsd: 0.0054,
      llmCostSource: "estimated",
      blobAdvancedOps: 9,
      blobSimpleOps: 5,
      storedBytes: 4096,
      retentionDays: 30,
      blobTransferBytes: 2048,
      fnInvocations: 3,
      fnWallSeconds: 1.8,
      fnCpuSeconds: 0,
      fnMemoryGb: 1,
    });
    expect(loaded?.cost?.total).toBe(0.0084);
    expect((await runs.list())[0].usage.llmModel).toBe("claude-sonnet-5");
  });

  it("rejects ids that could escape the runs prefix", async () => {
    expect(await runs.get("../../etc")).toBeNull();
    expect(await runs.delete("..")).toBe(false);
  });
});
