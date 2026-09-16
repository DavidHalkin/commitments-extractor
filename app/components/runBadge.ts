import type { Tone } from "@/app/components/reportModel";
import type { Run } from "@/lib/types";

/** History status vocabulary: done / needs clarification / declined / no commitments / rejected / failed / in-flight statuses. */
export function runBadge(run: Run): string {
  if (run.status !== "done") return run.status;
  if (run.reportStatus == null || run.reportStatus === "ok") return "done";
  return run.reportStatus.replaceAll("_", " ");
}

export function runTone(run: Run): Tone {
  if (run.status === "rejected" || run.status === "failed") return "setaside";
  if (run.status !== "done") return "neutral";
  switch (run.reportStatus) {
    case "needs_clarification":
      return "unsettled";
    case "declined":
      return "setaside";
    case "no_commitments":
      return "neutral";
    default:
      return "agreed";
  }
}
