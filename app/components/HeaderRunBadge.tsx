"use client";

import Link from "next/link";
import { currentStep, STEP_LABEL } from "@/app/components/progressModel";
import { useRunSession } from "@/app/components/RunSession";

/** Shows the run in progress from every page, so leaving the home page does not hide it. */
export function HeaderRunBadge() {
  const { busy, percent, steps } = useRunSession();
  if (!busy) return null;
  const step = currentStep(steps);
  return (
    <Link href="/" className="run-badge" aria-label={`${STEP_LABEL[step.name]}, ${percent} percent. Back to the run`}>
      <span className="run-badge-dot" aria-hidden="true" />
      <span aria-hidden="true">Working… {percent}%</span>
    </Link>
  );
}
