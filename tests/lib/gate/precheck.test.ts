import { describe, expect, it } from "vitest";
import { precheck, significantSpeakers } from "@/lib/gate/precheck";
import { makeTranscript } from "../../helpers/transcript";

const long = "word ".repeat(12).trim();

describe("precheck", () => {
  it("passes two speakers with enough speech", () => {
    expect(precheck(makeTranscript([[0, long], [1, long]]))).toEqual([]);
  });
  it("declines three significant speakers", () => {
    const t = makeTranscript([[0, long], [1, long], [2, long]]);
    expect(significantSpeakers(t)).toEqual([0, 1, 2]);
    expect(precheck(t)[0]).toContain("3 speaker(s) detected");
  });
  it("ignores a speaker with under 5% of words", () => {
    const t = makeTranscript([[0, long + " " + long], [1, long], [2, "yes"]]);
    expect(significantSpeakers(t)).toEqual([0, 1]);
  });
  it("declines too little speech", () => {
    expect(precheck(makeTranscript([[0, "hello there"], [1, "hi"]]))[0]).toContain("Only 3 words");
  });
  it("declines recordings over 185 s", () => {
    const t = { ...makeTranscript([[0, long], [1, long]]), durationSec: 200 };
    expect(precheck(t)[0]).toContain("200 s");
  });
});
