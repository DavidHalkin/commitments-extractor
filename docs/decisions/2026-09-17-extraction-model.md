# Extraction model: `openai/gpt-5-mini` via Vercel AI Gateway

Date: 2026-09-17. Status: accepted. Replaces the default `anthropic/claude-sonnet-5` from
`docs/superpowers/specs/2026-09-17-vercel-ai-gateway-design.md` §2. The model stays a configuration
value (`EXTRACT_MODEL`), so switching back is a one-line change once paid credits exist.

## Context

- The Vercel team for this project is on the Hobby plan and uses only the monthly **$5 free
  AI Gateway credit** (balance checked through the Gateway credits endpoint on 2026-09-17: `$5`, nothing used).
- On the free tier AI Gateway serves a subset of models and rate-limits each model. Buying any
  credits moves the team to the paid tier and ends the monthly free credit.
- The extraction step needs: reliable JSON that matches `ExtractionSchema`, reasoning about the
  final state of each commitment (accepted, changed deadline, cancelled, never accepted), verbatim
  quotes, and enough output room for the event timeline (the code requests up to 16,000 tokens).

## What we checked (2026-09-17, one tiny request per model, spaced out)

| Model | Free tier result |
|---|---|
| `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4.5` | 403 "Free tier users do not have access to this model" |
| `spacexai/grok-4.6`, `minimax/minimax-m3`, `deepseek/deepseek-v3.2-thinking`, `zai/glm-5.3-flash`, `openai/gpt-5.4-mini` | 403, same message |
| `openai/gpt-5`, `google/gemini-2.5-pro`, `google/gemini-2.5-flash` | 429 on the first request; the rate-limit check runs before the access check (Grok 4.6 answered 429, later 403), so availability is unknown and they are unusable on this tier anyway |
| `openai/gpt-5-mini`, `openai/gpt-4.1-mini`, `openai/gpt-oss-120b`, `nvidia/nemotron-3-super-120b-a12b`, `meta/llama-4-maverick`, `anthropic/claude-3-haiku` | 200, served |

A third-party list of free-tier models dated 2026-09-02 (itsfree.ai) was out of date: five of its
twelve models were refused.

## Decision

Use `openai/gpt-5-mini` as the default `EXTRACT_MODEL`.

Why this one among the models that answered:

1. **Schema-enforced output.** OpenAI models support strict JSON-schema structured output natively;
   the AI SDK sends our zod schema with the request. Open-weight models (`gpt-oss-120b`, Nemotron)
   are served by third-party hosts where strict schema support varies, which means more invalid
   JSON and paid retries.
2. **Structured-output quality.** In the Structured Output Benchmark (arXiv 2604.25359) GPT-5 Mini
   scores 0.779 value accuracy against 0.795 for full GPT-5 — close to the flagship.
3. **Reasoning model.** Deciding the final state of a commitment across corrections is a reasoning
   problem, not a field-copying one.
4. **Room for output.** 400k context, 128k max output — well above the 16k the code requests.
5. **Schema already compatible.** `ExtractionSchema` has every field required and optional values
   as `.nullable()`, which OpenAI strict mode requires.

Alternatives kept in reserve (all answered on the free tier):

- `openai/gpt-oss-120b` — OpenAI's open-weight reasoning model; cheapest; weaker schema guarantees.
- `nvidia/nemotron-3-super-120b-a12b` — reasoning, 32k output.
- Not chosen: `meta/llama-4-maverick` (8,192 max output, below the requested 16,000);
  `anthropic/claude-3-haiku` (4,096 max output, old model).

## Cost

List prices from the AI Gateway model catalog (2026-09-17), per million tokens:

| Model | Input | Output |
|---|---|---|
| `openai/gpt-5-mini` | $0.25 | $2.00 |
| `openai/gpt-oss-120b` | $0.10 | $0.50 |
| `nvidia/nemotron-3-super-120b-a12b` | $0.15 | $0.65 |
| `anthropic/claude-sonnet-5` (previous default) | $2.00 | $10.00 |

Pre-measurement estimate for one test recording (~75 s of audio). The prompt (system prompt +
transcript) is about 1,250 tokens by character count; with the JSON schema attached, assume about
2,500 input tokens. Output: about 2,000 tokens of JSON plus up to about 3,000 reasoning tokens
(billed as output).

| | `gpt-5-mini` | `claude-sonnet-5` |
|---|---|---|
| Reasoning (LLM) per operation | ≈ $0.011 | ≈ $0.025 (no extended thinking) |
| Deepgram Nova-3, 1.26 min | $0.0054 | $0.0054 |
| API cost per operation | ≈ $0.016 | ≈ $0.030 |

These are estimates only. Real per-operation cost comes from `providerMetadata.gateway.cost` in
`npm run eval` results and the deployed demo's metrics panel, and replaces this table in
`DELIVERY.md`. At the estimate, the $5 monthly free credit covers roughly 450 extractions, but the
free tier's per-model rate limit, not the credit, is the practical ceiling for bursts (expect 429
responses when running the eval back to back).

## Consequences

- `EXTRACT_MODEL` default, `.env.example` and the LLM fallback price table use `openai/gpt-5-mini`.
- Eval and demo results are for GPT-5 Mini; `DELIVERY.md` names it as the product's reasoning model
  and states the free-tier constraint.
- Moving to paid credits later: set `EXTRACT_MODEL=anthropic/claude-sonnet-5` (or another model) and
  re-run `npm run eval -- --runs=3 --model=<id>` to compare.

Sources: [AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing),
[AI Gateway rate limits](https://vercel.com/docs/ai-gateway/rate-limits),
[AI Gateway models](https://vercel.com/ai-gateway/models),
[itsfree.ai free-tier list](https://itsfree.ai/provider/vercel-ai-gateway/),
[Structured Output Benchmark](https://arxiv.org/html/2604.25359v1).
