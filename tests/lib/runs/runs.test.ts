import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStore } from "@/lib/store/local";
import { addEvent, newRunId, RUN_ID_RE, Runs } from "@/lib/runs/runs";

let root: string;
let runs: Runs;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "runs-"));
  runs = new Runs(new LocalStore(root));
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
    expect(loaded?.usage.gcsClassA).toBe(1);
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

  it("rejects ids that could escape the runs prefix", async () => {
    expect(await runs.get("../../etc")).toBeNull();
    expect(await runs.delete("..")).toBe(false);
  });
});
