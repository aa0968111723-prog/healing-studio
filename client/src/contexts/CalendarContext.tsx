import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  title: string;
  description?: string;
  date: Date;
  sourceType?: "studio" | "orb" | "manual";
  resultUrl?: string;
  prompt?: string;
};

type CalendarState = {
  isOpen: boolean;
  pendingEvent: CalendarEvent | null;
  openCalendar: () => void;
  closeCalendar: () => void;
  addToCalendar: (event: CalendarEvent) => void;
};

// ─── Context ───────────────────────────────────────────────────────────────

const CalendarContext = createContext<CalendarState | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingEvent, setPendingEvent] = useState<CalendarEvent | null>(null);

  const openCalendar = useCallback(() => setIsOpen(true), []);
  const closeCalendar = useCallback(() => {
    setIsOpen(false);
    setPendingEvent(null);
  }, []);

  const addToCalendar = useCallback((event: CalendarEvent) => {
    setPendingEvent(event);
    setIsOpen(true);
  }, []);

  return (
    <CalendarContext.Provider value={{ isOpen, pendingEvent, openCalendar, closeCalendar, addToCalendar }}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used within CalendarProvider");
  return ctx;
}
