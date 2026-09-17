"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type OpenRequest = { key: string; nonce: number };

type TimelineLink = {
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  /** The last evidence moment picked on the timeline; rows that contain it open themselves. */
  openRequest: OpenRequest | null;
  /** Opens the enclosing collapsed group(s) for a moment's rows, then scrolls the first row into view once it has expanded. */
  openEvidence: (key: string) => void;
};

const TimelineLinkContext = createContext<TimelineLink>({
  activeKey: null,
  setActiveKey: () => {},
  openRequest: null,
  openEvidence: () => {},
});

/** Shares the hovered/focused evidence moment and "open the row for this moment" requests between the timeline and the report. */
export function TimelineLinkProvider({ children }: { children: ReactNode }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const openEvidence = useCallback((key: string) => {
    setOpenRequest((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }));
    const rows = document.querySelectorAll(`[data-evidence-keys~="${CSS.escape(key)}"]`);
    for (const row of rows) {
      const details = row.closest("details");
      if (details && !details.open) details.open = true;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      rows[0]?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    });
  }, []);
  const value = useMemo(() => ({ activeKey, setActiveKey, openRequest, openEvidence }), [activeKey, openRequest, openEvidence]);
  return <TimelineLinkContext.Provider value={value}>{children}</TimelineLinkContext.Provider>;
}

export function useTimelineLink(): TimelineLink {
  return useContext(TimelineLinkContext);
}
