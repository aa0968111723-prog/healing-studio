declare module "tough-cookie" {
  // Compatibility shim for legacy DefinitelyTyped packages (e.g. @types/request)
  // that expect a named CookieJar type export on the module root.
  export interface Cookie {}
  export interface CookieJar {}
  export namespace CookieJar {
    interface SetCookieOptions {}
  }
}
