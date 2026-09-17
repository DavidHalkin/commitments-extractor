import type { Usage } from "@/lib/types";

export type Meter = { startedAt: number; cpu: NodeJS.CpuUsage };

export function startMeter(): Meter {
  return { startedAt: Date.now(), cpu: process.cpuUsage() };
}

/**
 * Charges one function invocation: wall time drives provisioned memory, process CPU time drives Active CPU.
 * The CPU figure includes other requests the same instance served meanwhile; demo traffic is sequential.
 */
export function chargeInvocation(
  usage: Usage,
  meter: Meter,
  now: number = Date.now(),
  cpuSinceStart: NodeJS.CpuUsage = process.cpuUsage(meter.cpu),
): void {
  usage.fnInvocations += 1;
  usage.fnWallSeconds += (now - meter.startedAt) / 1000;
  usage.fnCpuSeconds += (cpuSinceStart.user + cpuSinceStart.system) / 1e6;
}
