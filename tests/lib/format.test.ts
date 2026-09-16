import { describe, expect, it } from "vitest";
import { formatMs, formatTime, formatUsd } from "@/lib/format";

describe("format", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65.9)).toBe("01:05");
  });
  it("formats durations", () => {
    expect(formatMs(250)).toBe("250 ms");
    expect(formatMs(14230)).toBe("14.2 s");
    expect(formatMs(null)).toBe("—");
  });
  it("formats USD with enough precision for tiny costs", () => {
    expect(formatUsd(0.0586)).toBe("$0.0586");
    expect(formatUsd(0.00123)).toBe("$0.00123");
  });
});
