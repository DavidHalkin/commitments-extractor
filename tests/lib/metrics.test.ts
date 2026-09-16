import { describe, expect, it } from "vitest";
import { computeCost, emptyUsage } from "@/lib/metrics";

describe("computeCost", () => {
  it("prices recognition and reasoning per audio minute", () => {
    const u = { ...emptyUsage("claude-sonnet-5"), audioSeconds: 120, claudeInputTokens: 10_000, claudeOutputTokens: 3_000, vcpu: 0, memoryGib: 0 };
    const c = computeCost(u);
    expect(c.recognition).toBeCloseTo(0.0086, 6);
    expect(c.reasoning).toBeCloseTo(0.05, 6);
    expect(c.speech).toBe(0);
    expect(c.total).toBeCloseTo(0.0586, 6);
    expect(c.perAudioMinute).toBeCloseTo(0.0293, 6);
  });

  it("includes storage, operations, egress and compute", () => {
    const u = {
      ...emptyUsage("claude-sonnet-5"),
      audioSeconds: 60,
      gcsClassA: 8,
      gcsClassB: 3,
      storedBytes: 1024 ** 3,
      egressBytes: 1024 ** 3,
      cloudRunRequests: 3,
      cloudRunSeconds: 20,
    };
    const c = computeCost(u);
    expect(c.storage).toBeCloseTo(0.02, 6);
    expect(c.storageOps).toBeCloseTo((8 * 0.005 + 3 * 0.0004) / 1000, 9);
    expect(c.egress).toBeCloseTo(0.12, 6);
    expect(c.compute).toBeCloseTo(20 * (0.000024 + 0.0000025) + 3 * 0.4 / 1e6, 9);
  });

  it("returns null per-minute cost when no audio was processed", () => {
    expect(computeCost(emptyUsage("claude-sonnet-5")).perAudioMinute).toBeNull();
  });

  it("fails loudly for an unpriced model", () => {
    expect(() => computeCost(emptyUsage("unknown-model"))).toThrow("No pricing");
  });
});
