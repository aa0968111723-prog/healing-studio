import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AssetForInsert = {
  id: number;
  title: string;
  fileUrl: string;
  assetType: string;
  mimeType?: string | null;
};

type InsertCallback = (asset: AssetForInsert) => void;

type AssetsDrawerState = {
  isOpen: boolean;
  insertCallback: InsertCallback | null;
  openDrawer: (onInsert?: InsertCallback) => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

// ─── Context ───────────────────────────────────────────────────────────────

const AssetsDrawerContext = createContext<AssetsDrawerState | null>(null);

export function AssetsDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [insertCallback, setInsertCallback] = useState<InsertCallback | null>(null);

  const openDrawer = useCallback((onInsert?: InsertCallback) => {
    if (onInsert) {
      // Store as a wrapped setter to avoid useState treating function as updater
      setInsertCallback(() => onInsert);
    }
    setIsOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    setInsertCallback(null);
  }, []);

  const toggleDrawer = useCallback(() => setIsOpen(prev => !prev), []);

  const contextValue = useMemo(
    () => ({ isOpen, insertCallback, openDrawer, closeDrawer, toggleDrawer }),
    [isOpen, insertCallback, openDrawer, closeDrawer, toggleDrawer]
  );

  return (
    <AssetsDrawerContext.Provider value={contextValue}>
      {children}
    </AssetsDrawerContext.Provider>
  );
}

export function useAssetsDrawer() {
  const ctx = useContext(AssetsDrawerContext);
  if (!ctx)
    throw new Error("useAssetsDrawer must be used within AssetsDrawerProvider");
  return ctx;
}
