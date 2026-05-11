/**
 * IntentCardContext.tsx - Manages intent card history and favorites for quick reuse
 *
 * Features:
 * - Saves recent intent card selections
 * - Allows marking cards as favorites
 * - Provides quick access to frequently used options
 * - Persists to localStorage with 30-day retention
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { IntentOption } from "@/lib/intentOptions";

interface IntentCardHistoryEntry {
  option: IntentOption;
  timestamp: number;
  usageCount: number;
  lastUsed: number;
  isFavorite: boolean;
}

interface IntentCardContextValue {
  // History management
  history: IntentCardHistoryEntry[];
  addToHistory: (option: IntentOption) => void;
  clearHistory: () => void;

  // Favorites
  favorites: IntentCardHistoryEntry[];
  toggleFavorite: (pickText: string) => void;

  // Recently used
  recentOptions: IntentCardHistoryEntry[];

  // Most used
  frequentOptions: IntentCardHistoryEntry[];
}

const IntentCardContext = createContext<IntentCardContextValue | undefined>(undefined);

const STORAGE_KEY = "orb-intent-card-history";
const STORAGE_VERSION = "v1";
const MAX_HISTORY_SIZE = 50;
const RETENTION_DAYS = 30;

interface StorageData {
  version: string;
  history: IntentCardHistoryEntry[];
  savedAt: number;
}

function loadFromStorage(): IntentCardHistoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const data: StorageData = JSON.parse(stored);

    // Check version
    if (data.version !== STORAGE_VERSION) return [];

    // Check expiry (30 days)
    const now = Date.now();
    const ageMs = now - data.savedAt;
    const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs > retentionMs) return [];

    return data.history || [];
  } catch (err) {
    console.warn("Failed to load intent card history:", err);
    return [];
  }
}

function saveToStorage(history: IntentCardHistoryEntry[]): void {
  try {
    const data: StorageData = {
      version: STORAGE_VERSION,
      history,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Failed to save intent card history:", err);
  }
}

export function IntentCardProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<IntentCardHistoryEntry[]>([]);

  // Load from storage on mount
  useEffect(() => {
    setHistory(loadFromStorage());
  }, []);

  // Save to storage whenever history changes
  useEffect(() => {
    if (history.length > 0) {
      saveToStorage(history);
    }
  }, [history]);

  const addToHistory = useCallback((option: IntentOption) => {
    setHistory((prev) => {
      const now = Date.now();
      const existing = prev.find((e) => e.option.pickText === option.pickText);

      if (existing) {
        // Update existing entry
        return prev
          .map((e) =>
            e.option.pickText === option.pickText
              ? { ...e, usageCount: e.usageCount + 1, lastUsed: now }
              : e
          )
          .sort((a, b) => b.lastUsed - a.lastUsed);
      } else {
        // Add new entry
        const newEntry: IntentCardHistoryEntry = {
          option,
          timestamp: now,
          usageCount: 1,
          lastUsed: now,
          isFavorite: false,
        };

        // Keep only MAX_HISTORY_SIZE most recent entries
        const updated = [newEntry, ...prev].slice(0, MAX_HISTORY_SIZE);
        return updated;
      }
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const toggleFavorite = useCallback((pickText: string) => {
    setHistory((prev) =>
      prev.map((e) =>
        e.option.pickText === pickText ? { ...e, isFavorite: !e.isFavorite } : e
      )
    );
  }, []);

  // Compute derived state
  const favorites = history.filter((e) => e.isFavorite);

  const recentOptions = [...history]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, 10);

  const frequentOptions = [...history]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 10);

  const value: IntentCardContextValue = {
    history,
    addToHistory,
    clearHistory,
    favorites,
    toggleFavorite,
    recentOptions,
    frequentOptions,
  };

  return <IntentCardContext.Provider value={value}>{children}</IntentCardContext.Provider>;
}

export function useIntentCardHistory(): IntentCardContextValue {
  const context = useContext(IntentCardContext);
  if (!context) {
    throw new Error("useIntentCardHistory must be used within IntentCardProvider");
  }
  return context;
}
