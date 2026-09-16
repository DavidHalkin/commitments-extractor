import { describe, expect, it, vi } from "vitest";
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
    vi.unstubAllGlobals();
  });

  it("throws with status on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })));
    await expect(transcribeBytes(new Uint8Array([1]), "audio/mpeg", "key")).rejects.toThrow("Deepgram 401");
    vi.unstubAllGlobals();
  });
});
