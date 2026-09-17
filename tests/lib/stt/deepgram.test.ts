import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDeepgram, transcribeBytes, type DeepgramResponse } from "@/lib/stt/deepgram";

const raw: DeepgramResponse = {
  metadata: { duration: 7.5 },
  results: {
    utterances: [
      {
        start: 4.1, end: 6.0, transcript: "I'm Mark.", speaker: 1,
        words: [
          { word: "i'm", punctuated_word: "I'm", start: 4.1, end: 4.4, speaker: 1 },
          { word: "mark", punctuated_word: "Mark.", start: 4.5, end: 6.0, speaker: 1 },
        ],
      },
      {
        start: 0.2, end: 2.0, transcript: "Hi, I'm Anna.", speaker: 0,
        words: [
          { word: "hi", punctuated_word: "Hi,", start: 0.2, end: 0.5, speaker: 0 },
          { word: "i'm", punctuated_word: "I'm", start: 0.6, end: 0.9, speaker: 0 },
          { word: "anna", punctuated_word: "Anna.", start: 1.0, end: 2.0, speaker: 0 },
        ],
      },
    ],
  },
};

describe("normalizeDeepgram", () => {
  it("orders utterances by time, assigns ids and counts words per speaker", () => {
    const t = normalizeDeepgram(raw);
    expect(t.durationSec).toBe(7.5);
    expect(t.utterances.map((u) => [u.id, u.speaker, u.text])).toEqual([
      ["u1", 0, "Hi, I'm Anna."],
      ["u2", 1, "I'm Mark."],
    ]);
    expect(t.utterances[0].words[0]).toEqual({ word: "hi", punctuated: "Hi,", start: 0.2, end: 0.5 });
    expect(t.speakerStats).toEqual([{ speaker: 0, wordCount: 3 }, { speaker: 1, wordCount: 2 }]);
  });
});

describe("transcribeBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts bytes with the fixed query and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { transcript } = await transcribeBytes(new Uint8Array([1, 2, 3]), "audio/mpeg", "key");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=en&diarize=true&utterances=true&smart_format=true&punctuate=true",
    );
    expect(init.headers).toMatchObject({ Authorization: "Token key", "Content-Type": "audio/mpeg" });
    expect(transcript.utterances).toHaveLength(2);
  });

  it("throws with status on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })));
    await expect(transcribeBytes(new Uint8Array([1]), "audio/mpeg", "key")).rejects.toThrow("Deepgram 401");
  });
});

describe("normalizeDeepgram speaker re-segmentation", () => {
  const merged: DeepgramResponse = {
    metadata: { duration: 6 },
    results: {
      utterances: [
        {
          start: 1.0, end: 4.4, transcript: "Someone should book the room. Yes, before Tuesday.", speaker: 1,
          words: [
            { word: "someone", punctuated_word: "Someone", start: 1.0, end: 1.3, speaker: 1 },
            { word: "should", punctuated_word: "should", start: 1.4, end: 1.7, speaker: 1 },
            { word: "book", punctuated_word: "book", start: 1.8, end: 2.1, speaker: 1 },
            { word: "the", punctuated_word: "the", start: 2.2, end: 2.4, speaker: 1 },
            { word: "room", punctuated_word: "room.", start: 2.5, end: 2.8, speaker: 1 },
            { word: "yes", punctuated_word: "Yes,", start: 3.2, end: 3.4, speaker: 0 },
            { word: "before", punctuated_word: "before", start: 3.5, end: 3.9, speaker: 0 },
            { word: "tuesday", punctuated_word: "Tuesday.", start: 4.0, end: 4.4, speaker: 0 },
          ],
        },
      ],
    },
  };

  it("splits one utterance into a run per word-level speaker", () => {
    const t = normalizeDeepgram(merged);
    expect(t.utterances.map((u) => [u.id, u.speaker, u.text, u.start, u.end])).toEqual([
      ["u1", 1, "Someone should book the room.", 1.0, 2.8],
      ["u2", 0, "Yes, before Tuesday.", 3.2, 4.4],
    ]);
  });

  it("counts words per word-level speaker", () => {
    expect(normalizeDeepgram(merged).speakerStats).toEqual([
      { speaker: 0, wordCount: 3 },
      { speaker: 1, wordCount: 5 },
    ]);
  });

  it("keeps words without a speaker label in the current run", () => {
    const t = normalizeDeepgram({
      metadata: { duration: 3 },
      results: {
        utterances: [
          {
            start: 0.1, end: 1.2, transcript: "Okay then sure.", speaker: 2,
            words: [
              { word: "okay", punctuated_word: "Okay", start: 0.1, end: 0.4, speaker: 2 },
              { word: "then", punctuated_word: "then", start: 0.5, end: 0.8 },
              { word: "sure", punctuated_word: "sure.", start: 0.9, end: 1.2, speaker: 2 },
            ],
          },
        ],
      },
    });
    expect(t.utterances).toHaveLength(1);
    expect(t.utterances[0]).toMatchObject({ speaker: 2, text: "Okay then sure." });
  });
});

describe("normalizeDeepgram on recorded Deepgram output", () => {
  // Two utterances from run 20260917T180728Z where the diarizer merged both speakers into one utterance.
  const recorded = JSON.parse(
    readFileSync(new URL("../../fixtures/deepgram-merged-speakers.json", import.meta.url), "utf8"),
  ) as DeepgramResponse;

  it("separates each speaker's own sentences", () => {
    expect(normalizeDeepgram(recorded).utterances.map((u) => [u.speaker, u.text])).toEqual([
      [0, "First, we can also redo the landing page while we're at it."],
      [1, "Maybe later."],
      [1, "Someone needs to book the room for the demo."],
      [0, "Yes. Someone should book the room before next Tuesday."],
    ]);
  });
});

describe("normalizeDeepgram turn merging", () => {
  const twoParts = (gap: number): DeepgramResponse => ({
    metadata: { duration: 10 },
    results: {
      utterances: [
        {
          start: 1.0, end: 1.3, transcript: "Yes.", speaker: 0,
          words: [{ word: "yes", punctuated_word: "Yes.", start: 1.0, end: 1.3, speaker: 0 }],
        },
        {
          start: 1.3 + gap, end: 1.9 + gap, transcript: "Someone should book the room.", speaker: 0,
          words: [
            { word: "someone", punctuated_word: "Someone", start: 1.3 + gap, end: 1.5 + gap, speaker: 0 },
            { word: "should", punctuated_word: "should", start: 1.6 + gap, end: 1.7 + gap, speaker: 0 },
            { word: "book", punctuated_word: "book.", start: 1.8 + gap, end: 1.9 + gap, speaker: 0 },
          ],
        },
      ],
    },
  });

  it("joins one speaker's consecutive segments separated by a short pause", () => {
    const t = normalizeDeepgram(twoParts(0.2));
    expect(t.utterances.map((u) => [u.id, u.speaker, u.text])).toEqual([["u1", 0, "Yes. Someone should book."]]);
    expect(t.utterances[0].words).toHaveLength(4);
    expect(t.utterances[0].end).toBeCloseTo(2.1);
  });

  it("keeps segments apart across a pause long enough to end a turn", () => {
    expect(normalizeDeepgram(twoParts(1.5)).utterances).toHaveLength(2);
  });
});
