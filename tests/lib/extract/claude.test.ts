import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ExtractionError, extractCommitments } from "@/lib/extract/claude";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]]);
const extraction: Extraction = { speakers: [], no_commitments_discussed: true, items: [] };

function fakeClient(responses: unknown[]) {
  const parse = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce(r);
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

const ok = { parsed_output: extraction, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } };
const truncated = { parsed_output: null, stop_reason: "max_tokens", usage: { input_tokens: 1000, output_tokens: 16000 } };

describe("extractCommitments", () => {
  it("returns the parsed extraction and token usage", async () => {
    const { client, parse } = fakeClient([ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.extraction).toEqual(extraction);
    expect(result.attempts).toEqual([
      { ok: true, stopReason: "end_turn", inputTokens: 1000, outputTokens: 200, raw: ok },
    ]);
    const body = parse.mock.calls[0][0];
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages[0].content).toContain("[u1] Speaker 0");
    expect(body.output_config.format).toBeDefined();
  });

  it("retries once when the output is not parsed, counting both attempts", async () => {
    const { client } = fakeClient([truncated, ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0].outputTokens).toBe(16000);
  });

  it("throws ExtractionError with attempts after two failures", async () => {
    const { client } = fakeClient([truncated, new Error("invalid JSON")]);
    const err = await extractCommitments(transcript, client).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).attempts).toHaveLength(2);
    expect((err as ExtractionError).attempts[1].error).toContain("invalid JSON");
  });
});
