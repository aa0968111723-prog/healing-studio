import Replicate from "replicate";

/**
 * Cached Replicate SDK client keyed by auth token.
 * Avoids constructing a new Replicate instance on every API call
 * (each construction re-parses config and sets up HTTP internals).
 */
const clientCache = new Map<string, Replicate>();

export function getReplicateClient(token?: string): Replicate {
  const auth = token || process.env.REPLICATE_API_TOKEN || "";
  if (!auth) {
    throw new Error(
      "[ReplicateClient] No API token provided and REPLICATE_API_TOKEN is not set"
    );
  }

  let client = clientCache.get(auth);
  if (!client) {
    client = new Replicate({ auth });
    clientCache.set(auth, client);
  }
  return client;
}
