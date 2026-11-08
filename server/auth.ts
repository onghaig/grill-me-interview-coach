import crypto from "crypto";
import { promisify } from "util";
import type { Express, NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "http";
import { users, sessions } from "./db.ts";
import { rateLimit } from "./limits.ts";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const COOKIE = "br_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [v, saltB64, keyB64] = stored.split("$");
  if (v !== "s1" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, SCRYPT);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Used to spend the same time when the email is unknown
const DUMMY_HASH = `s1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req: Request): boolean {
  return process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const parts = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (isSecure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  await sessions().insertOne({
    _id: sha256(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MS),
  });
  return token;
}

/** Resolve the signed-in user from a cookie header (works for HTTP requests and WebSocket upgrades). */
export async function userFromCookieHeader(header: string | undefined): Promise<AuthUser | null> {
  const token = parseCookies(header)[COOKIE];
  if (!token || token.length > 200) return null;
  const session = await sessions().findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await users().findOne({ _id: session.userId });
  return user ? { id: user._id, email: user.email } : null;
}

export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function attachUser() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.user = (await userFromCookieHeader(req.headers.cookie)) || undefined;
    } catch (err) {
      console.error("attachUser failed:", err);
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please sign in." });
  next();
}

/** Reject cross-site state-changing requests (cookie auth plus SameSite=Lax is the first line, this is the second). */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !originAllowed(req)) {
    return res.status(403).json({ error: "Cross-site request blocked." });
  }
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function registerAuthRoutes(app: Express) {
  const byIp = rateLimit({ max: 12, windowMs: 60_000, key: (r) => `auth:${r.ip}`, message: "Too many attempts. Wait a minute." });
  const failures = new Map<string, { n: number; until: number }>();

  app.post("/api/auth/signup", byIp, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
      if (password.length < 8) return res.status(400).json({ error: "Use a password of at least 8 characters." });
      if (password.length > 200) return res.status(400).json({ error: "That password is too long (200 characters max)." });

      const id = crypto.randomUUID();
      try {
        await users().insertOne({ _id: id, email, passwordHash: await hashPassword(password), createdAt: new Date() });
      } catch (err: any) {
        if (err?.code === 11000) return res.status(409).json({ error: "An account with that email already exists." });
        throw err;
      }
      setSessionCookie(req, res, await createSession(id), SESSION_MS);
      res.status(201).json({ user: { id, email } });
    } catch (err) {
      console.error("signup failed:", err);
      res.status(500).json({ error: "Could not create the account. Try again." });
    }
  });

  app.post("/api/auth/login", byIp, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password || password.length > 200) return res.status(400).json({ error: "Enter your email and password." });

      const lock = failures.get(email);
      if (lock && lock.n >= 8 && lock.until > Date.now()) {
        return res.status(429).json({ error: "Too many failed sign-ins for this account. Try again in a few minutes." });
      }
      const user = await users().findOne({ email });
      const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok) {
        const n = (lock && lock.until > Date.now() ? lock.n : 0) + 1;
        failures.set(email, { n, until: Date.now() + 15 * 60_000 });
        return res.status(401).json({ error: "Wrong email or password." });
      }
      failures.delete(email);
      setSessionCookie(req, res, await createSession(user._id), SESSION_MS);
      res.json({ user: { id: user._id, email: user.email } });
    } catch (err) {
      console.error("login failed:", err);
      res.status(500).json({ error: "Could not sign in. Try again." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await sessions().deleteOne({ _id: sha256(token) }).catch(() => {});
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not signed in." });
    res.json({ user: req.user });
  });
}
