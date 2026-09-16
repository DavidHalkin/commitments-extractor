import { describe, expect, it } from "vitest";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { makeTranscript } from "../../helpers/transcript";

describe("renderTranscript", () => {
  it("renders one line per utterance with id, speaker and seconds", () => {
    const lines = renderTranscript(makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]])).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[u1] Speaker 0 (0.0–1.0 s): Hi, I'm Anna.");
    expect(lines[1]).toMatch(/^\[u2\] Speaker 1 \(\d+\.\d–\d+\.\d s\): I'm Mark\.$/);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("states the non-negotiable rules", () => {
    for (const phrase of ["we could", "cancelled", "null", "verbatim", "accepted", "assigned", "disputed"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });
});
