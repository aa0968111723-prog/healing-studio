import type { NextFunction, Request, Response } from "express";

/**
 * Returns the maximum nesting depth of container values (objects/arrays).
 * Primitives at leaves do not contribute depth. Early-exits at `limit`.
 *   measureDepth({})            → 0
 *   measureDepth({ a: { b:1 }}) → 1
 *   measureDepth([[[1]]])       → 2
 */
function measureDepth(value: unknown, limit = 32): number {
  if (typeof value !== "object" || value === null) return 0;
  let max = 0;
  for (const v of Object.values(value as object)) {
    if (typeof v === "object" && v !== null) {
      const d = 1 + measureDepth(v, limit);
      if (d > max) {
        max = d;
        if (max >= limit) return max;
      }
    }
  }
  return max;
}

/** Reject requests whose parsed JSON body exceeds `maxDepth` nesting levels. */
export function jsonDepthGuard(maxDepth = 32): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (req.body !== undefined && measureDepth(req.body, maxDepth) >= maxDepth) {
      res.status(400).json({ error: "Request body exceeds maximum nesting depth" });
      return;
    }
    next();
  };
}

export { measureDepth as _measureDepthForTest };
