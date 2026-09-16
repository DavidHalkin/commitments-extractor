import { formatMs, formatUsd } from "@/lib/format";
import type { CostBreakdown, Stage, Usage } from "@/lib/types";

export type MetricsLike = {
  stageMs: Partial<Record<Stage, number>>;
  timeToResultMs: number | null;
  usage: Usage;
  cost: CostBreakdown | null;
};

const STAGES: Stage[] = ["file-check", "transcribe", "precheck", "extract", "verify"];

export function MetricsView({ metrics }: { metrics: MetricsLike }) {
  const { stageMs, timeToResultMs, usage, cost } = metrics;
  return (
    <details open>
      <summary>Speed and cost</summary>
      <div className="scroll">
        <table>
          <tbody>
            <tr><th>Time to result</th><td>{formatMs(timeToResultMs)} (upload + all stages)</td></tr>
            {STAGES.map((s) => <tr key={s}><th>{s}</th><td>{formatMs(stageMs[s])}</td></tr>)}
            <tr><th>Audio</th><td>{(usage.audioSeconds / 60).toFixed(2)} min</td></tr>
            <tr><th>Claude</th><td>{usage.claudeModel}: {usage.claudeInputTokens} in / {usage.claudeOutputTokens} out, {usage.claudeAttempts} attempt(s)</td></tr>
            {cost ? (
              <>
                <tr><th>Recognition</th><td>{formatUsd(cost.recognition)}</td></tr>
                <tr><th>Reasoning</th><td>{formatUsd(cost.reasoning)}</td></tr>
                <tr><th>Speech output</th><td>{formatUsd(cost.speech)} (the product does not synthesize speech)</td></tr>
                <tr><th>Storage 30 days + operations</th><td>{formatUsd(cost.storage + cost.storageOps)}</td></tr>
                <tr><th>Egress (one playback)</th><td>{formatUsd(cost.egress)}</td></tr>
                <tr><th>Cloud Run compute</th><td>{formatUsd(cost.compute)}</td></tr>
                <tr><th>Total per operation</th><td><strong>{formatUsd(cost.total)}</strong></td></tr>
                <tr><th>Per audio minute</th><td><strong>{formatUsd(cost.perAudioMinute)}</strong></td></tr>
              </>
            ) : (
              <tr><th>Cost</th><td className="muted">Not computed (run did not finish)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
