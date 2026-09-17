import { generateText, NoObjectGeneratedError, Output } from "ai";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { ExtractionSchema, type Extraction } from "@/lib/extract/schema";
import { PRICING } from "@/lib/pricing";
import type { LlmCostSource, Transcript } from "@/lib/types";

/** An AI Gateway model id, e.g. "anthropic/claude-sonnet-5" or "openai/gpt-6-astra". */
export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "anthropic/claude-sonnet-5";
const MAX_ATTEMPTS = 2;
const NON_RETRYABLE_STATUS = [400, 401, 403, 404];

const extractionOutput = Output.object({ schema: ExtractionSchema });

export type LlmAttempt = {
  ok: boolean;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costSource: LlmCostSource;
  /** Provider and model that served the request as reported by AI Gateway; the requested id otherwise. */
  model: string;
  generationId: string | null;
  error?: string;
  raw: unknown;
};

export type GenerateRequest = {
  model: string;
  instructions: string;
  prompt: string;
  output: typeof extractionOutput;
  maxOutputTokens: number;
  maxRetries: number;
};

export type GenerateResult = {
  output: Extraction;
  finishReason: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
  providerMetadata: Record<string, unknown> | undefined;
  response: { modelId: string };
};

export type Generate = (request: GenerateRequest) => Promise<GenerateResult>;

const defaultGenerate: Generate = (request) => generateText(request);

export class ExtractionError extends Error {
  constructor(message: string, public attempts: LlmAttempt[]) {
    super(message);
    this.name = "ExtractionError";
  }
}

type GatewayMetadata = {
  cost?: string;
  generationId?: string;
  routing?: { finalProvider?: string; resolvedProviderApiModelId?: string };
};

/** List-price estimate for when AI Gateway reports no cost; "unknown" when the model is not in the table. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): { costUsd: number; costSource: LlmCostSource } {
  const price = PRICING.llmFallback.models[model];
  if (!price) return { costUsd: 0, costSource: "unknown" };
  return { costUsd: (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1e6, costSource: "estimated" };
}

function statusOf(e: unknown): number | undefined {
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : undefined;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function extractCommitments(
  transcript: Transcript,
  generate: Generate = defaultGenerate,
): Promise<{ extraction: Extraction; attempts: LlmAttempt[] }> {
  const attempts: LlmAttempt[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await generate({
        model: EXTRACT_MODEL,
        instructions: SYSTEM_PROMPT,
        prompt: renderTranscript(transcript),
        output: extractionOutput,
        maxOutputTokens: 16000,
        // Retries happen in this loop so that every paid call is recorded as an attempt.
        maxRetries: 0,
      });
      const inputTokens = res.usage.inputTokens ?? 0;
      const outputTokens = res.usage.outputTokens ?? 0;
      const gateway = (res.providerMetadata?.gateway ?? {}) as GatewayMetadata;
      const reported = gateway.cost != null ? Number(gateway.cost) : NaN;
      const routing = gateway.routing;
      attempts.push({
        ok: true,
        finishReason: res.finishReason,
        inputTokens,
        outputTokens,
        ...(Number.isFinite(reported)
          ? { costUsd: reported, costSource: "gateway" as const }
          : estimateCost(EXTRACT_MODEL, inputTokens, outputTokens)),
        model: routing?.finalProvider && routing.resolvedProviderApiModelId
          ? `${routing.finalProvider}/${routing.resolvedProviderApiModelId}`
          : res.response.modelId,
        generationId: gateway.generationId ?? null,
        raw: { output: res.output, finishReason: res.finishReason, usage: res.usage, providerMetadata: res.providerMetadata },
      });
      return { extraction: res.output, attempts };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        // Truncated or schema-invalid output still burned real tokens; the error carries no Gateway cost.
        const inputTokens = e.usage?.inputTokens ?? 0;
        const outputTokens = e.usage?.outputTokens ?? 0;
        attempts.push({
          ok: false,
          finishReason: e.finishReason ?? null,
          inputTokens,
          outputTokens,
          ...estimateCost(EXTRACT_MODEL, inputTokens, outputTokens),
          model: e.response?.modelId ?? EXTRACT_MODEL,
          generationId: null,
          error: `No valid structured output (finish reason: ${e.finishReason ?? "unknown"}): ${e.message}`,
          raw: { text: e.text ?? null, finishReason: e.finishReason ?? null, usage: e.usage ?? null },
        });
        continue;
      }
      // No response: nothing was billed.
      attempts.push({
        ok: false,
        finishReason: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        costSource: "gateway",
        model: EXTRACT_MODEL,
        generationId: null,
        error: errMsg(e),
        raw: null,
      });
      // Authentication, permission, unknown-model and request-shape errors will not fix themselves on retry.
      const status = statusOf(e);
      if (status != null && NON_RETRYABLE_STATUS.includes(status)) {
        throw new ExtractionError(`Extraction failed: ${errMsg(e)}`, attempts);
      }
    }
  }
  throw new ExtractionError(`Extraction failed after ${attempts.length} attempts`, attempts);
}
