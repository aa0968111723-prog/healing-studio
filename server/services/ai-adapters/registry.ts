import type { AIAdapter } from "./types";

const adapters = new Map<string, AIAdapter>();

export function registerAdapter(adapter: AIAdapter): void {
  adapters.set(adapter.provider, adapter);
}

export function getAdapter(provider: string): AIAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new Error(`AI adapter not registered: ${provider}`);
  }
  return adapter;
}

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}
