import { describe, expect, it } from "vitest";
import {
  containsPhrase,
  findQuoteSpan,
  fuzzyContainsPhrase,
  isDeferral,
  levenshtein,
  normalize,
} from "@/lib/verify/text";

const words = (s: string) => s.split(" ").map((punctuated) => ({ punctuated }));

describe("normalize", () => {
  it("lowercases, drops apostrophes and punctuation, collapses spaces", () => {
    expect(normalize("  I'll write the API docs, by Wednesday! ")).toBe("ill write the api docs by wednesday");
    expect(normalize("It’s done")).toBe("its done");
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("survey", "server")).toBe(2);
    expect(levenshtein("docs", "docs")).toBe(0);
  });
});

describe("containsPhrase", () => {
  it("matches whole words only", () => {
    expect(containsPhrase("I'll write the API docs by Wednesday.", "by wednesday")).toBe(true);
    expect(containsPhrase("the API docs", "API doc")).toBe(false);
  });
});

describe("fuzzyContainsPhrase", () => {
  it("allows edits proportional to phrase length", () => {
    expect(fuzzyContainsPhrase("we need the API dogs soon", "API docs")).toBe(true);
    expect(fuzzyContainsPhrase("the staging server", "survey")).toBe(false);
    expect(fuzzyContainsPhrase("book the room for the demo", "book the room")).toBe(true);
  });
});

describe("findQuoteSpan", () => {
  const ws = words("Okay, so I'll write the API docs by Wednesday, promise.");
  it("finds an exact quote and returns word indices", () => {
    expect(findQuoteSpan("I'll write the API docs by Wednesday", ws)).toEqual({ first: 2, last: 8 });
  });
  it("tolerates small differences", () => {
    expect(findQuoteSpan("I will write the API docs by Wednesday", ws)).toEqual({ first: 2, last: 8 });
  });
  it("rejects fabricated quotes", () => {
    expect(findQuoteSpan("Anna will write the docs by Friday", ws)).toBeNull();
  });
  it("returns null for empty quotes", () => {
    expect(findQuoteSpan("  ", ws)).toBeNull();
  });
  it("rejects a source utterance that adds a negation not in the quote", () => {
    const neg = words("I will not write the API docs by Wednesday");
    expect(findQuoteSpan("I will write the API docs by Wednesday", neg)).toBeNull();
  });
  it("still finds an exact quote that itself contains a hedge or negation token", () => {
    const hedge = words("We could also redo the landing page");
    expect(findQuoteSpan("We could also redo the landing page", hedge)).toEqual({ first: 0, last: 6 });
  });
});

describe("isDeferral", () => {
  it("recognizes postponing the decision or the discussion", () => {
    expect(isDeferral("Okay, let's pick this up next week.")).toBe(true);
    expect(isDeferral("Maybe. Let's talk about it another time.")).toBe(true);
    expect(isDeferral("I don't know yet. Let's decide later.")).toBe(true);
    expect(isDeferral("Let's come back to this.")).toBe(true);
  });

  it("does not treat a commitment or a plain date as a deferral", () => {
    expect(isDeferral("I'll write the API docs by Wednesday.")).toBe(false);
    expect(isDeferral("The client demo is on Friday then.")).toBe(false);
    expect(isDeferral("I'll send it out later.")).toBe(false);
  });
});
