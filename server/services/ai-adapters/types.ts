export type AdapterProxyRequest = {
  pathWithQuery: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
};

export interface AIAdapter {
  provider: string;
  proxy(req: AdapterProxyRequest): Promise<Response>;
}
