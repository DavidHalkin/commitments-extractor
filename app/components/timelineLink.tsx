"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type TimelineLink = { activeKey: string | null; setActiveKey: (key: string | null) => void };

const TimelineLinkContext = createContext<TimelineLink>({ activeKey: null, setActiveKey: () => {} });

/** Shares the hovered/focused evidence moment between the recording timeline and the report. */
export function TimelineLinkProvider({ children }: { children: ReactNode }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const value = useMemo(() => ({ activeKey, setActiveKey }), [activeKey]);
  return <TimelineLinkContext.Provider value={value}>{children}</TimelineLinkContext.Provider>;
}

export function useTimelineLink(): TimelineLink {
  return useContext(TimelineLinkContext);
}
