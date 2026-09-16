import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { renderTranscript, SYSTEM_PROMPT } from "@/lib/extract/prompt";
import { ExtractionSchema, type Extraction } from "@/lib/extract/schema";
import type { Transcript } from "@/lib/types";

export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "claude-sonnet-5";
const MAX_ATTEMPTS = 2;

export type ClaudeAttempt = {
  ok: boolean;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  raw: unknown;
};

export class ExtractionError extends Error {
  constructor(message: string, public attempts: ClaudeAttempt[]) {
    super(message);
    this.name = "ExtractionError";
  }
}

function isNonRetryable(e: unknown): e is APIError {
  return e instanceof Anthropic.APIError && e.status != null && [400, 401, 403, 404].includes(e.status);
}

export async function extractCommitments(
  transcript: Transcript,
  client: Anthropic = new Anthropic(),
): Promise<{ extraction: Extraction; attempts: ClaudeAttempt[] }> {
  const attempts: ClaudeAttempt[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: renderTranscript(transcript) }],
        output_config: { format: zodOutputFormat(ExtractionSchema) },
      });
      // Record usage first: even a truncated or schema-invalid response burned real tokens
      // and the caller (verifier, cost accounting) needs that regardless of parse outcome.
      const attempt: ClaudeAttempt = {
        ok: false,
        stopReason: res.stop_reason,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        raw: res,
      };
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) {
        attempt.error = `Empty response text (stop_reason: ${res.stop_reason})`;
      } else {
        try {
          const json: unknown = JSON.parse(text);
          const parsed = ExtractionSchema.safeParse(json);
          if (parsed.success) {
            attempt.ok = true;
            attempts.push(attempt);
            return { extraction: parsed.data, attempts };
          }
          attempt.error = `Schema validation failed: ${parsed.error.message}`;
        } catch (e) {
          attempt.error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      attempts.push(attempt);
    } catch (e) {
      const errorAttempt: ClaudeAttempt = {
        ok: false,
        stopReason: null,
        inputTokens: 0,
        outputTokens: 0,
        error: e instanceof Error ? e.message : String(e),
        raw: null,
      };
      attempts.push(errorAttempt);
      // Authentication, permission and request-shape errors will not fix themselves on retry.
      if (isNonRetryable(e)) throw new ExtractionError(`Extraction failed: ${errorAttempt.error}`, attempts);
    }
  }
  throw new ExtractionError(`Extraction failed after ${attempts.length} attempts`, attempts);
}
