import { describe, expect, it } from "vitest";
import { emptyUsage } from "@/lib/metrics";
import { chargeInvocation, startMeter } from "@/lib/runs/meter";

describe("chargeInvocation", () => {
  it("adds one invocation with wall time since the meter started and user + system CPU time", () => {
    const usage = emptyUsage("anthropic/claude-sonnet-5");
    const meter = { startedAt: 1_000, cpu: { user: 0, system: 0 } };

    chargeInvocation(usage, meter, 3_500, { user: 1_500_000, system: 500_000 });
    expect(usage).toMatchObject({ fnInvocations: 1, fnWallSeconds: 2.5, fnCpuSeconds: 2 });

    chargeInvocation(usage, meter, 2_000, { user: 250_000, system: 0 });
    expect(usage).toMatchObject({ fnInvocations: 2, fnWallSeconds: 3.5, fnCpuSeconds: 2.25 });
  });

  it("measures real process CPU time by default", () => {
    const usage = emptyUsage("anthropic/claude-sonnet-5");
    const meter = startMeter();
    chargeInvocation(usage, meter);
    expect(usage.fnCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(usage.fnWallSeconds).toBeGreaterThanOrEqual(0);
  });
});
