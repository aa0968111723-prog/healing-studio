import { hashIntentSignature } from "./providerRouter";

interface IdempotentRecord {
  key: string;
  taskId?: string;
  planId?: string;
  traceId?: string;
  createdAt: number;
}

const store = new Map<string, IdempotentRecord>();
const TTL_MS = 90_000;

function prune() {
  const now = Date.now();
  for (const [k, v] of Array.from(store.entries())) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

export function buildOrbIdempotencyKey(input: {
  userId?: number;
  sessionId?: string;
  text: string;
  attachmentUrls?: string[];
}): string {
  return hashIntentSignature(input);
}

export function findDuplicateTask(key: string): IdempotentRecord | null {
  prune();
  return store.get(key) ?? null;
}

export function rememberTaskKey(key: string, value: Omit<IdempotentRecord, "key" | "createdAt">) {
  prune();
  const record: IdempotentRecord = {
    key,
    createdAt: Date.now(),
    ...value,
  };
  store.set(key, record);
  return record;
}

export function __unsafe_resetOrbIdempotencyForTests() {
  store.clear();
}
