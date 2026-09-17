/** List prices used for per-operation cost estimates. Free tiers and credits are ignored on purpose. */
export const PRICING = {
  checkedAt: "2026-09-17",
  deepgram: {
    nova3PerMinute: 0.0043,
    aura2Per1kChars: 0.03,
    source: "https://deepgram.com/pricing",
    note: "Pay-as-you-go, pre-recorded, English; speaker diarization and smart formatting included.",
  },
  llmFallback: {
    models: {
      "openai/gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
      "anthropic/claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "anthropic/claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
    } as Record<string, { inputPerMTok: number; outputPerMTok: number }>,
    source: "https://vercel.com/ai-gateway/models",
    note: "Used only when AI Gateway reports no cost for a generation. AI Gateway adds no markup to provider list prices.",
  },
  vercelFunctions: {
    activeCpuPerHour: 0.128,
    memoryGbHour: 0.0106,
    invocationsPerMillion: 0.6,
    memoryGb: 2,
    source: "https://vercel.com/docs/functions/usage-and-pricing",
    note: "Fluid compute in iad1, default 2 GB / 1 vCPU. Active CPU is not billed while waiting on I/O; provisioned memory is.",
  },
  vercelBlob: {
    storageGbMonth: 0.023,
    simpleOpsPerMillion: 0.4,
    advancedOpsPerMillion: 5,
    dataTransferPerGb: 0.05,
    source: "https://vercel.com/docs/pricing/regional-pricing/iad1",
    note: "Private store in iad1. put and list are advanced operations, reads are simple operations, del is free.",
  },
  vercelCdn: {
    edgeRequestsPerMillion: 2,
    fastOriginTransferPerGb: 0.06,
    source: "https://vercel.com/docs/pricing/regional-pricing/iad1",
    note: "Every blob read is an edge request; uncached reads also pay Fast Origin Transfer.",
  },
} as const;
