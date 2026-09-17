import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteExpiredRuns, expiredRunIds, runIdTime } from "@/lib/runs/cleanup";
import { LocalStore } from "@/lib/store/local";

const now = new Date("2026-10-17T03:00:00Z");

describe("runIdTime", () => {
  it("reads the UTC timestamp from a run id", () => {
    expect(runIdTime("20260916T132501Z-ab12cd")).toBe(Date.parse("2026-09-16T13:25:01Z"));
  });
});

describe("expiredRunIds", () => {
  it("keeps runs up to exactly 30 days old and ignores foreign folder names", () => {
    const ids = [
      "20260917T030000Z-aaaaaa", // exactly 30 days
      "20260917T025959Z-bbbbbb", // 30 days and 1 second
      "20261001T000000Z-cccccc",
      "not-a-run",
    ];
    expect(expiredRunIds(ids, now)).toEqual(["20260917T025959Z-bbbbbb"]);
  });
});

describe("deleteExpiredRuns", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cleanup-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("deletes every object of expired runs and leaves recent ones", async () => {
    const store = new LocalStore(root);
    await store.put("runs/20260801T000000Z-old000/run.json", "{}", "application/json");
    await store.put("runs/20260801T000000Z-old000/audio", "x", "application/octet-stream");
    await store.put("runs/20261010T000000Z-new000/run.json", "{}", "application/json");

    expect(await deleteExpiredRuns(store, now)).toEqual(["20260801T000000Z-old000"]);
    expect(await store.listDirs("runs/")).toEqual(["20261010T000000Z-new000"]);
  });
});
