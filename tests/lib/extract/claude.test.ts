import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ExtractionError, extractCommitments } from "@/lib/extract/claude";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]]);
const extraction: Extraction = { speakers: [], no_commitments_discussed: true, items: [] };

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce(r);
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const ok = {
  content: [{ type: "text", text: JSON.stringify(extraction) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 200 },
};
const truncated = {
  content: [{ type: "text", text: '{"speakers": [' }],
  stop_reason: "max_tokens",
  usage: { input_tokens: 1000, output_tokens: 16000 },
};
const schemaInvalid = {
  content: [{ type: "text", text: JSON.stringify({ speakers: "oops" }) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1200, output_tokens: 50 },
};

describe("extractCommitments", () => {
  it("returns the parsed extraction and token usage", async () => {
    const { client, create } = fakeClient([ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.extraction).toEqual(extraction);
    expect(result.attempts).toEqual([
      { ok: true, stopReason: "end_turn", inputTokens: 1000, outputTokens: 200, raw: ok },
    ]);
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages[0].content).toContain("[u1] Speaker 0");
    expect(body.output_config.format).toBeDefined();
  });

  it("retries once when the output is truncated, counting both attempts' token usage", async () => {
    const { client } = fakeClient([truncated, ok]);
    const result = await extractCommitments(transcript, client);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0].outputTokens).toBe(16000);
    expect(result.attempts[0].inputTokens).toBe(1000);
    expect(result.attempts[0].stopReason).toBe("max_tokens");
  });

  it("throws ExtractionError with attempts after two failures, preserving real token usage", async () => {
    const { client } = fakeClient([schemaInvalid, new Error("network down")]);
    const err = await extractCommitments(transcript, client).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    const attempts = (err as ExtractionError).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0].ok).toBe(false);
    expect(attempts[0].inputTokens).toBe(1200);
    expect(attempts[0].outputTokens).toBe(50);
    expect(attempts[0].error).toContain("validation");
    expect(attempts[1].error).toContain("network down");
  });

  it("stops retrying and rethrows immediately on a non-retryable APIError, keeping prior attempts", async () => {
    const authError = Anthropic.APIError.generate(401, { message: "Unauthorized" }, "Unauthorized", new Headers());
    const { client, create } = fakeClient([authError]);
    const err = await extractCommitments(transcript, client).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    const attempts = (err as ExtractionError).attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].error).toContain("Unauthorized");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
