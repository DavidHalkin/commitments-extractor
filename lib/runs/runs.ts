import { LIMITS } from "@/lib/limits";
import { emptyUsage } from "@/lib/metrics";
import { chargeInvocation, startMeter } from "@/lib/runs/meter";
import { getStore } from "@/lib/store";
import type { ObjectStore } from "@/lib/store/store";
import type { Run, RunEvent, Stage, UploadTarget } from "@/lib/types";

export const RUN_ID_RE = /^\d{8}T\d{6}Z-[a-z0-9]{6}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newRunId(now: Date = new Date(), random: () => number = Math.random): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = Array.from({ length: 6 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
  return `${ts}-${suffix}`;
}

export function addEvent(run: Run, stage: Stage, type: RunEvent["type"], detail: string, durationMs?: number): void {
  run.events.push({
    at: new Date().toISOString(),
    stage,
    type,
    detail,
    ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}),
  });
}

export type JsonName = "transcript.json" | "report.json" | "raw/deepgram.json" | "raw/llm.json";
type WriteOpts = { counted?: boolean };

const decode = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

type LegacyUsage = {
  audioSeconds: number;
  claudeModel: string;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeAttempts: number;
  gcsClassA: number;
  gcsClassB: number;
  storedBytes: number;
  retentionDays: number;
  egressBytes: number;
  cloudRunRequests: number;
  cloudRunSeconds: number;
  memoryGib: number;
};

/**
 * Runs stored before the Vercel/AI Gateway migration use Cloud Run/GCS/Claude usage fields.
 * Map them to the current fields so history pages and retries keep working; their stored cost is left as computed then.
 */
function readRun(bytes: Uint8Array): Run {
  const run = decode(bytes) as Run;
  if (!("claudeModel" in run.usage)) return run;
  const old = run.usage as unknown as LegacyUsage;
  run.usage = {
    audioSeconds: old.audioSeconds,
    llmModel: old.claudeModel,
    llmResolvedModel: null,
    llmInputTokens: old.claudeInputTokens,
    llmOutputTokens: old.claudeOutputTokens,
    llmAttempts: old.claudeAttempts,
    // The old pipeline priced tokens from its own list-price table.
    llmCostUsd: run.cost?.reasoning ?? 0,
    llmCostSource: "estimated",
    blobAdvancedOps: old.gcsClassA,
    blobSimpleOps: old.gcsClassB,
    storedBytes: old.storedBytes,
    retentionDays: old.retentionDays,
    blobTransferBytes: old.egressBytes,
    fnInvocations: old.cloudRunRequests,
    fnWallSeconds: old.cloudRunSeconds,
    // Not measured before the migration.
    fnCpuSeconds: 0,
    fnMemoryGb: old.memoryGib,
  };
  return run;
}

export class Runs {
  constructor(private store: ObjectStore = getStore()) {}

  audioKey(id: string): string {
    return `runs/${id}/audio`;
  }

  async create(file: { name: string; sizeBytes: number; declaredType: string }, model: string): Promise<{ run: Run; upload: UploadTarget }> {
    const meter = startMeter();
    const run: Run = {
      id: newRunId(),
      createdAt: new Date().toISOString(),
      file: { ...file, detectedFormat: null, mime: null, durationSec: null, hasVideo: null },
      status: "created",
      failedStage: null,
      stageStartedAt: null,
      rejection: null,
      reportStatus: null,
      events: [],
      stageMs: {},
      usage: emptyUsage(model),
      timeToResultMs: null,
      cost: null,
    };
    addEvent(run, "upload", "started", `Upload URL issued for ${file.name} (${file.sizeBytes} bytes)`);
    const upload = await this.store.uploadTarget(this.audioKey(run.id), "application/octet-stream", LIMITS.maxBytes);
    chargeInvocation(run.usage, meter);
    await this.save(run);
    return { run, upload };
  }

  async get(id: string): Promise<Run | null> {
    if (!RUN_ID_RE.test(id)) return null;
    const bytes = await this.store.get(`runs/${id}/run.json`);
    if (!bytes) return null;
    const run = readRun(bytes);
    run.usage.blobSimpleOps += 1;
    return run;
  }

  async save(run: Run, opts: WriteOpts = {}): Promise<void> {
    if (opts.counted !== false) run.usage.blobAdvancedOps += 1;
    await this.store.put(`runs/${run.id}/run.json`, JSON.stringify(run, null, 2), "application/json");
  }

  async putJson(run: Run, name: JsonName, value: unknown, opts: WriteOpts = {}): Promise<void> {
    const body = JSON.stringify(value);
    if (opts.counted !== false) {
      run.usage.blobAdvancedOps += 1;
      run.usage.storedBytes += Buffer.byteLength(body);
    }
    await this.store.put(`runs/${run.id}/${name}`, body, "application/json");
  }

  async getJson<T>(id: string, name: JsonName): Promise<T | null> {
    if (!RUN_ID_RE.test(id)) return null;
    const bytes = await this.store.get(`runs/${id}/${name}`);
    return bytes ? (decode(bytes) as T) : null;
  }

  async getAudio(run: Run): Promise<Uint8Array | null> {
    run.usage.blobSimpleOps += 1;
    return this.store.get(this.audioKey(run.id));
  }

  async list(limit = 50): Promise<Run[]> {
    const ids = (await this.store.listDirs("runs/"))
      .filter((id) => RUN_ID_RE.test(id))
      .sort()
      .reverse()
      .slice(0, limit);
    const loaded = await Promise.all(ids.map((id) => this.store.get(`runs/${id}/run.json`)));
    return loaded.filter((b): b is Uint8Array => b != null).map(readRun);
  }

  async delete(id: string): Promise<boolean> {
    if (!RUN_ID_RE.test(id)) return false;
    await this.store.deletePrefix(`runs/${id}/`);
    return true;
  }

  audioDownloadUrl(id: string): Promise<string | null> {
    return this.store.downloadUrl(this.audioKey(id));
  }
}
