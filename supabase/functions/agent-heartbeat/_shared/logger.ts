// AIDV-392: Shared structured JSON logger for all Edge Functions
export type LogLevel = 'info' | 'warn' | 'error';

export function log(
  level: LogLevel,
  event: string,
  ctx: Record<string, unknown> = {}
): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    requestId: ctx.requestId ?? 'unknown',
    ...ctx,
  }));
}

export function makeRequestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function timedQuery<T>(
  fn: () => Promise<T>,
  requestId: string,
  queryName: string
): Promise<T> {
  const start = Date.now();
  return fn().then((result) => {
    log('info', 'db_query_complete', { requestId, queryName, durationMs: Date.now() - start });
    return result;
  }).catch((err) => {
    log('error', 'db_query_error', { requestId, queryName, durationMs: Date.now() - start, error: String(err) });
    throw err;
  });
}
