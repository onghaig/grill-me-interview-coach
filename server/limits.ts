import type { Request, RequestHandler } from "express";

/** Small in-memory sliding-window limiter. Per instance: fine for one server, swap for Redis when scaling out. */
export function rateLimit(opts: {
  max: number;
  windowMs?: number;
  key: (req: Request) => string;
  message?: string;
}): RequestHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
  }, Math.max(windowMs, 60_000)).unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = opts.key(req);
    const recent = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (recent.length >= opts.max) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: opts.message || "Too many requests. Wait a minute and try again." });
    }
    recent.push(now);
    hits.set(k, recent);
    next();
  };
}
