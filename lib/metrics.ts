import { PRICING } from "@/lib/pricing";
import type { CostBreakdown, Usage } from "@/lib/types";

export function emptyUsage(model: string): Usage {
  return {
    audioSeconds: 0,
    llmModel: model,
    llmResolvedModel: null,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmAttempts: 0,
    llmCostUsd: 0,
    llmCostSource: "gateway",
    blobAdvancedOps: 0,
    blobSimpleOps: 0,
    storedBytes: 0,
    retentionDays: 30,
    blobTransferBytes: 0,
    fnInvocations: 0,
    fnWallSeconds: 0,
    fnCpuSeconds: 0,
    fnMemoryGb: PRICING.vercelFunctions.memoryGb,
  };
}

const GB = 1024 ** 3;

export function computeCost(u: Usage, p: typeof PRICING = PRICING): CostBreakdown {
  const { vercelFunctions: fn, vercelBlob: blob, vercelCdn: cdn } = p;
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  // Summed per attempt in lib/extract/llm.ts: Gateway-reported where available, list-price estimate otherwise.
  const reasoning = u.llmCostUsd;
  const storage = (u.storedBytes / GB) * blob.storageGbMonth * (u.retentionDays / 30);
  const storageOps =
    (u.blobAdvancedOps * blob.advancedOpsPerMillion + u.blobSimpleOps * (blob.simpleOpsPerMillion + cdn.edgeRequestsPerMillion)) / 1e6;
  // Reads bypass or miss the CDN cache (useCache: false, first playback), so Fast Origin Transfer applies too.
  const egress = (u.blobTransferBytes / GB) * (blob.dataTransferPerGb + cdn.fastOriginTransferPerGb);
  const compute =
    (u.fnCpuSeconds / 3600) * fn.activeCpuPerHour +
    (u.fnWallSeconds / 3600) * u.fnMemoryGb * fn.memoryGbHour +
    (u.fnInvocations / 1e6) * fn.invocationsPerMillion;
  const total = recognition + reasoning + storage + storageOps + egress + compute;
  const minutes = u.audioSeconds / 60;
  return {
    recognition,
    reasoning,
    speech: 0,
    storage,
    storageOps,
    egress,
    compute,
    total,
    perAudioMinute: minutes > 0 ? total / minutes : null,
  };
}
