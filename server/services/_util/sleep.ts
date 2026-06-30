/** Shared sleep helper — eliminates duplicate `new Promise(r => setTimeout(r, ms))` across services. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
