import { describe, expect, it } from "vitest";
import {
  allDone,
  currentStep,
  initialSteps,
  ORDER,
  progressPercent,
  SPAN,
  stepFraction,
  TIME_CAP,
  type Steps,
} from "@/app/components/progressModel";

const with_ = (patch: Partial<Steps>): Steps => ({ ...initialSteps(), ...patch });

describe("progress spans", () => {
  it("cover 0–100 without gaps, in step order", () => {
    let expected = 0;
    for (const name of ORDER) {
      expect(SPAN[name][0]).toBe(expected);
      expected = SPAN[name][1];
    }
    expect(expected).toBe(100);
  });
});

describe("progressPercent", () => {
  it("is 0 before anything runs and 100 when every step is done", () => {
    expect(progressPercent(initialSteps(), 0)).toBe(0);
    const done = { status: "done" as const };
    expect(progressPercent({ upload: done, transcribe: done, extract: done, verify: done }, 0)).toBe(100);
  });

  it("moves the upload by real bytes", () => {
    expect(progressPercent(with_({ upload: { status: "running", startedAt: 0, fraction: 0.5 } }), 99_999)).toBe(7);
  });

  it("moves transcription and extraction by time, slowing down and never reaching the end of the step", () => {
    const at = (elapsed: number) =>
      progressPercent(with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "running", startedAt: 1_000 } }), 1_000 + elapsed);
    expect(at(0)).toBe(30);
    const values = [5_000, 20_000, 55_000, 120_000, 600_000].map(at);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(at(55_000)).toBeGreaterThan(60);
    expect(at(10 * 60_000)).toBeLessThan(95);
  });

  it("keeps the time-based fraction under the cap at any elapsed time", () => {
    for (const elapsed of [0, 1, 1_000, 55_000, 1e9]) {
      expect(stepFraction("extract", { status: "running", startedAt: 0 }, elapsed)).toBeLessThan(TIME_CAP + 1e-9);
    }
  });

  it("jumps to the end of extraction and verification when the extract response arrives", () => {
    const steps = with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "done" }, verify: { status: "done" } });
    expect(progressPercent(steps, 0)).toBe(100);
  });

  it("freezes at the percent reached when a step fails", () => {
    const steps = with_({ upload: { status: "done" }, transcribe: { status: "done" }, extract: { status: "failed", frozenPercent: 71.6 } });
    expect(progressPercent(steps, 1e9)).toBe(71);
  });
});

describe("currentStep", () => {
  it("points at the first step that is not done", () => {
    expect(currentStep(initialSteps())).toEqual({ name: "upload", index: 0, status: "pending" });
    expect(currentStep(with_({ upload: { status: "done" }, transcribe: { status: "running", startedAt: 0 } }))).toEqual({ name: "transcribe", index: 1, status: "running" });
    expect(currentStep(with_({ upload: { status: "done" }, transcribe: { status: "failed" } }))).toEqual({ name: "transcribe", index: 1, status: "failed" });
  });

  it("points at the last step when everything is done", () => {
    const done = { status: "done" as const };
    const steps = { upload: done, transcribe: done, extract: done, verify: done };
    expect(currentStep(steps)).toEqual({ name: "verify", index: 3, status: "done" });
    expect(allDone(steps)).toBe(true);
  });
});
