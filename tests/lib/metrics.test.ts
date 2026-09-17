import { describe, expect, it } from "vitest";
import { computeCost, emptyUsage } from "@/lib/metrics";

const GB = 1024 ** 3;

describe("computeCost", () => {
  it("prices recognition and takes reasoning cost from the recorded LLM cost", () => {
    const u = { ...emptyUsage("anthropic/claude-sonnet-5"), audioSeconds: 120, llmInputTokens: 10_000, llmOutputTokens: 3_000, llmCostUsd: 0.05 };
    const c = computeCost(u);
    expect(c.recognition).toBeCloseTo(0.0086, 6);
    expect(c.reasoning).toBeCloseTo(0.05, 6);
    expect(c.speech).toBe(0);
    expect(c.total).toBeCloseTo(0.0586, 6);
    expect(c.perAudioMinute).toBeCloseTo(0.0293, 6);
  });

  it("prices Blob storage, operations, transfer and Vercel compute in iad1", () => {
    const u = {
      ...emptyUsage("anthropic/claude-sonnet-5"),
      audioSeconds: 60,
      blobAdvancedOps: 8,
      blobSimpleOps: 3,
      storedBytes: GB,
      blobTransferBytes: GB,
      fnInvocations: 3,
      fnWallSeconds: 3600,
      fnCpuSeconds: 1800,
    };
    const c = computeCost(u);
    expect(c.storage).toBeCloseTo(0.023, 9);
    expect(c.storageOps).toBeCloseTo((8 * 5 + 3 * (0.4 + 2)) / 1e6, 12);
    expect(c.egress).toBeCloseTo(0.05 + 0.06, 9);
    expect(c.compute).toBeCloseTo(0.5 * 0.128 + 1 * 2 * 0.0106 + (3 * 0.6) / 1e6, 9);
  });

  it("returns null per-minute cost when no audio was processed", () => {
    expect(computeCost(emptyUsage("anthropic/claude-sonnet-5")).perAudioMinute).toBeNull();
  });
});
