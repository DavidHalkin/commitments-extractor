import { describe, expect, it } from "vitest";
import {
  containsPhrase,
  findQuoteSpan,
  fuzzyContainsPhrase,
  levenshtein,
  normalize,
} from "@/lib/verify/text";

const words = (s: string) => s.split(" ").map((punctuated) => ({ punctuated }));

describe("normalize", () => {
  it("lowercases, drops apostrophes and punctuation, collapses spaces", () => {
    expect(normalize("  I'll write the API docs, by Wednesday! ")).toBe("ill write the api docs by wednesday");
    expect(normalize("It's done")).toBe("its done");
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
});
