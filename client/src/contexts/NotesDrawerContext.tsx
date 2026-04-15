import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

export type NotePayload = {
  title: string;
  content?: string;
  prompt?: string;
  resultUrl?: string;
  seed?: number;
  mode?: string;
  tags?: string[];
  sourceType?: "studio" | "thought-chain" | "orb" | "manual";
};

type NotesDrawerState = {
  isOpen: boolean;
  pendingPayload: NotePayload | null;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  saveToNotes: (payload: NotePayload) => void;
};

// ─── Context ───────────────────────────────────────────────────────────────

const NotesDrawerContext = createContext<NotesDrawerState | null>(null);

export function NotesDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<NotePayload | null>(null);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    setPendingPayload(null);
  }, []);
  const toggleDrawer = useCallback(() => setIsOpen(prev => !prev), []);

  const saveToNotes = useCallback((payload: NotePayload) => {
    setPendingPayload(payload);
    setIsOpen(true);
  }, []);

  const contextValue = useMemo(() => ({
    isOpen, pendingPayload, openDrawer, closeDrawer, toggleDrawer, saveToNotes,
  }), [isOpen, pendingPayload, openDrawer, closeDrawer, toggleDrawer, saveToNotes]);

  return (
    <NotesDrawerContext.Provider value={contextValue}>
      {children}
    </NotesDrawerContext.Provider>
  );
}

export function useNotesDrawer() {
  const ctx = useContext(NotesDrawerContext);
  if (!ctx) throw new Error("useNotesDrawer must be used within NotesDrawerProvider");
  return ctx;
}
