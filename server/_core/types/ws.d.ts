declare module "ws" {
  export class WebSocketServer {
    constructor(opts: any);
    on(event: string, cb: (...args: any[]) => void): void;
  }
  export default class WebSocket {
    close(code?: number, reason?: string): void;
    send(data: any): void;
    on(event: string, cb: (...args: any[]) => void): void;
  }
}
