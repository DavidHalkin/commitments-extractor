import type { Tone } from "@/app/components/reportModel";

/** A small square in a status colour followed by its label. The label carries the meaning; colour only repeats it. */
export function StatusMark({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`status-mark tone-${tone}`}>
      <span className="status-mark-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
