import { PRICING } from "@/lib/pricing";
import type { CostBreakdown, Usage } from "@/lib/types";

export function emptyUsage(model: string): Usage {
  return {
    audioSeconds: 0,
    claudeModel: model,
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
    claudeAttempts: 0,
    gcsClassA: 0,
    gcsClassB: 0,
    storedBytes: 0,
    retentionDays: 30,
    egressBytes: 0,
    cloudRunRequests: 0,
    cloudRunSeconds: 0,
    vcpu: 1,
    memoryGib: 1,
  };
}

const GIB = 1024 ** 3;

export function computeCost(u: Usage, p: typeof PRICING = PRICING): CostBreakdown {
  const model = p.anthropic.models[u.claudeModel];
  if (!model) throw new Error(`No pricing for model ${u.claudeModel}`);
  const recognition = (u.audioSeconds / 60) * p.deepgram.nova3PerMinute;
  const reasoning = (u.claudeInputTokens * model.inputPerMTok + u.claudeOutputTokens * model.outputPerMTok) / 1e6;
  const storage = (u.storedBytes / GIB) * p.gcs.standardGbMonth * (u.retentionDays / 30);
  const storageOps = (u.gcsClassA * p.gcs.classAPer1000 + u.gcsClassB * p.gcs.classBPer1000) / 1000;
  const egress = (u.egressBytes / GIB) * p.gcs.egressPerGb;
  const compute =
    u.cloudRunSeconds * (u.vcpu * p.cloudRun.vcpuSecond + u.memoryGib * p.cloudRun.gibSecond) +
    (u.cloudRunRequests / 1e6) * p.cloudRun.perMillionRequests;
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
