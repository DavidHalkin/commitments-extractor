import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { estimateCost, ExtractionError, extractCommitments, type Generate, type GenerateResult } from "@/lib/extract/llm";
import type { Extraction } from "@/lib/extract/schema";
import { makeTranscript } from "../../helpers/transcript";

const transcript = makeTranscript([[0, "Hi, I'm Anna."], [1, "I'm Mark."]]);
const extraction: Extraction = { speakers: [], no_commitments_discussed: true, items: [] };

function fakeGenerate(responses: (GenerateResult | Error)[]) {
  const generate = vi.fn<Generate>();
  for (const r of responses) {
    if (r instanceof Error) generate.mockRejectedValueOnce(r);
    else generate.mockResolvedValueOnce(r);
  }
  return generate;
}

const ok: GenerateResult = {
  output: extraction,
  finishReason: "stop",
  usage: { inputTokens: 1000, outputTokens: 200 },
  providerMetadata: {
    gateway: {
      cost: "0.004",
      generationId: "gen_1",
      routing: { finalProvider: "anthropic", resolvedProviderApiModelId: "claude-sonnet-5" },
    },
  },
  response: { modelId: "anthropic/claude-sonnet-5" },
};

const noGatewayMetadata: GenerateResult = { ...ok, providerMetadata: undefined };

function noObject(inputTokens: number, outputTokens: number, finishReason: "length" | "stop") {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text: '{"speakers": [',
    response: { id: "r1", timestamp: new Date(0), modelId: "anthropic/claude-sonnet-5" },
    usage: { inputTokens, outputTokens } as LanguageModelUsage,
    finishReason,
  });
}

describe("extractCommitments", () => {
  it("returns the extraction with Gateway-reported cost and the resolved provider", async () => {
    const generate = fakeGenerate([ok]);
    const result = await extractCommitments(transcript, generate);
    expect(result.extraction).toEqual(extraction);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      ok: true,
      finishReason: "stop",
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.004,
      costSource: "gateway",
      model: "anthropic/claude-sonnet-5",
      generationId: "gen_1",
    });
    const request = generate.mock.calls[0][0];
    expect(request.model).toBe("anthropic/claude-sonnet-5");
    expect(request.prompt).toContain("[u1] Speaker 0");
    expect(request.maxRetries).toBe(0);
    expect(request.output).toBeDefined();
  });

  it("estimates cost from tokens when the Gateway reports none", async () => {
    const result = await extractCommitments(transcript, fakeGenerate([noGatewayMetadata]));
    expect(result.attempts[0].costSource).toBe("estimated");
    expect(result.attempts[0].costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 9);
    expect(result.attempts[0].model).toBe("anthropic/claude-sonnet-5");
  });

  it("retries once when the output is truncated, counting both attempts' tokens", async () => {
    const result = await extractCommitments(transcript, fakeGenerate([noObject(1000, 16000, "length"), ok]));
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(result.attempts[0]).toMatchObject({ inputTokens: 1000, outputTokens: 16000, finishReason: "length", costSource: "estimated" });
    expect(result.attempts[0].costUsd).toBeCloseTo((1000 * 2 + 16000 * 10) / 1e6, 9);
  });

  it("throws ExtractionError with attempts after two failures, preserving real token usage", async () => {
    const err = await extractCommitments(transcript, fakeGenerate([noObject(1200, 50, "stop"), new Error("network down")])).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    const attempts = (err as ExtractionError).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ ok: false, inputTokens: 1200, outputTokens: 50 });
    expect(attempts[0].error).toContain("No valid structured output");
    expect(attempts[1]).toMatchObject({ ok: false, inputTokens: 0, costUsd: 0 });
    expect(attempts[1].error).toContain("network down");
  });

  it("stops immediately on a non-retryable status, keeping the attempt", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const generate = fakeGenerate([authError]);
    const err = await extractCommitments(transcript, generate).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).attempts).toHaveLength(1);
    expect((err as ExtractionError).attempts[0].error).toContain("Unauthorized");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries a rate-limited request", async () => {
    const rateLimited = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    const result = await extractCommitments(transcript, fakeGenerate([rateLimited, ok]));
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
  });
});

describe("estimateCost", () => {
  it("marks models missing from the price table as unknown", () => {
    expect(estimateCost("someone/unpriced-model", 1000, 1000)).toEqual({ costUsd: 0, costSource: "unknown" });
  });
});
