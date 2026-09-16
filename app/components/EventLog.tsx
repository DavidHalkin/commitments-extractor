import { formatMs } from "@/lib/format";
import type { RunEvent } from "@/lib/types";

export function EventLog({ events }: { events: RunEvent[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Time (UTC)</th><th>Stage</th><th>Event</th><th>Duration</th><th>Details</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td>{e.at.slice(11, 19)}</td>
              <td>{e.stage}</td>
              <td className={e.type === "failed" || e.type === "rejected" ? "flag" : undefined}>{e.type}</td>
              <td>{e.durationMs != null ? formatMs(e.durationMs) : ""}</td>
              <td>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
