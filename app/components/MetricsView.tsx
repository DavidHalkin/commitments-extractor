import { formatMs, formatUsd } from "@/lib/format";
import type { CostBreakdown, LlmCostSource, Stage, Usage } from "@/lib/types";

export type MetricsLike = {
  stageMs: Partial<Record<Stage, number>>;
  timeToResultMs: number | null;
  usage: Usage;
  cost: CostBreakdown | null;
};

const COST_SOURCE_NOTE: Record<LlmCostSource, string> = {
  gateway: "reported by AI Gateway",
  estimated: "partly estimated from tokens at list price",
  unknown: "incomplete: model missing from the price table",
};

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "file-check", label: "File check" },
  { stage: "transcribe", label: "Transcription" },
  { stage: "precheck", label: "Precheck" },
  { stage: "extract", label: "Extraction" },
  { stage: "verify", label: "Verification" },
];

export function MetricsView({ metrics }: { metrics: MetricsLike }) {
  const { stageMs, timeToResultMs, usage, cost } = metrics;
  return (
    <details className="section-details">
      <summary>Speed and cost</summary>
      <div className="scroll">
        <table className="data-table kv-table">
          <tbody>
            <tr><th scope="row">Time to result</th><td className="num">{formatMs(timeToResultMs)}</td><td className="muted">upload and all stages</td></tr>
            {STAGES.map(({ stage, label }) => (
              <tr key={stage}><th scope="row">{label}</th><td className="num">{formatMs(stageMs[stage])}</td><td /></tr>
            ))}
            <tr><th scope="row">Audio</th><td className="num">{(usage.audioSeconds / 60).toFixed(2)} min</td><td /></tr>
            <tr>
              <th scope="row">LLM</th>
              <td className="num">{usage.llmInputTokens} in, {usage.llmOutputTokens} out</td>
              <td className="muted">{usage.llmResolvedModel ?? usage.llmModel} via AI Gateway, {usage.llmAttempts} attempt(s)</td>
            </tr>
            {cost ? (
              <>
                <tr className="kv-group-start"><th scope="row">Recognition</th><td className="num">{formatUsd(cost.recognition)}</td><td /></tr>
                <tr><th scope="row">Reasoning</th><td className="num">{formatUsd(cost.reasoning)}</td><td className="muted">{COST_SOURCE_NOTE[usage.llmCostSource]}</td></tr>
                <tr><th scope="row">Speech output</th><td className="num">{formatUsd(cost.speech)}</td><td className="muted">the product does not synthesize speech</td></tr>
                <tr><th scope="row">Blob storage 30 days and operations</th><td className="num">{formatUsd(cost.storage + cost.storageOps)}</td><td /></tr>
                <tr><th scope="row">Blob transfer</th><td className="num">{formatUsd(cost.egress)}</td><td className="muted">read for transcription and one playback</td></tr>
                <tr><th scope="row">Vercel compute</th><td className="num">{formatUsd(cost.compute)}</td><td className="muted">{usage.fnInvocations} invocations, {usage.fnCpuSeconds.toFixed(2)} s CPU, {usage.fnWallSeconds.toFixed(1)} s wall</td></tr>
                <tr className="kv-total"><th scope="row">Total per operation</th><td className="num">{formatUsd(cost.total)}</td><td /></tr>
                <tr className="kv-total"><th scope="row">Per audio minute</th><td className="num">{formatUsd(cost.perAudioMinute)}</td><td /></tr>
              </>
            ) : (
              <tr><th scope="row">Cost</th><td className="muted" colSpan={2}>Not computed (run did not finish)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
