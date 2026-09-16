import { formatMs } from "@/lib/format";
import type { RunEvent } from "@/lib/types";

export function EventLog({ events }: { events: RunEvent[] }) {
  return (
    <div className="scroll">
      <table className="data-table">
        <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Stage</th><th scope="col">Event</th><th scope="col" className="num">Duration</th><th scope="col">Details</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="nowrap">{e.at.slice(11, 19)}</td>
              <td>{e.stage}</td>
              <td className={e.type === "failed" || e.type === "rejected" ? "text-setaside" : undefined}>{e.type}</td>
              <td className="num">{e.durationMs != null ? formatMs(e.durationMs) : ""}</td>
              <td className="cell-detail">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
