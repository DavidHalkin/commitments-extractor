import Anthropic from "@anthropic-ai/sdk";
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

export async function extractCommitments(
  transcript: Transcript,
  client: Anthropic = new Anthropic(),
): Promise<{ extraction: Extraction; attempts: ClaudeAttempt[] }> {
  const attempts: ClaudeAttempt[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const res = await client.messages.parse({
        model: EXTRACT_MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: renderTranscript(transcript) }],
        output_config: { format: zodOutputFormat(ExtractionSchema) },
      });
      const attempt: ClaudeAttempt = {
        ok: res.parsed_output != null,
        stopReason: res.stop_reason,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        raw: res,
      };
      if (!attempt.ok) attempt.error = `No parsed output (stop_reason: ${res.stop_reason})`;
      attempts.push(attempt);
      if (res.parsed_output) return { extraction: res.parsed_output, attempts };
    } catch (e) {
      // Authentication, permission and request-shape errors will not fix themselves on retry.
      if (e instanceof Anthropic.APIError && e.status != null && [400, 401, 403, 404].includes(e.status)) throw e;
      attempts.push({
        ok: false,
        stopReason: null,
        inputTokens: 0,
        outputTokens: 0,
        error: e instanceof Error ? e.message : String(e),
        raw: null,
      });
    }
  }
  throw new ExtractionError(`Extraction failed after ${attempts.length} attempts`, attempts);
}
