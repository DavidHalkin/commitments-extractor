/** List prices used for per-operation cost estimates. Free tiers and credits are ignored on purpose. */
export const PRICING = {
  checkedAt: "2026-09-16",
  deepgram: {
    nova3PerMinute: 0.0043,
    aura2Per1kChars: 0.03,
    source: "https://deepgram.com/pricing",
    note: "Pay-as-you-go, pre-recorded, English; speaker diarization and smart formatting included.",
  },
  anthropic: {
    models: {
      "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
      "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
    } as Record<string, { inputPerMTok: number; outputPerMTok: number }>,
    source: "https://docs.anthropic.com/en/docs/about-claude/pricing",
  },
  cloudRun: {
    vcpuSecond: 0.000024,
    gibSecond: 0.0000025,
    perMillionRequests: 0.4,
    source: "https://cloud.google.com/run/pricing",
    note: "europe-west1 (Tier 1), request-based billing.",
  },
  gcs: {
    standardGbMonth: 0.02,
    classAPer1000: 0.005,
    classBPer1000: 0.0004,
    egressPerGb: 0.12,
    source: "https://cloud.google.com/storage/pricing",
    note: "Standard storage, europe-west1 regional bucket, premium tier internet egress.",
  },
} as const;
