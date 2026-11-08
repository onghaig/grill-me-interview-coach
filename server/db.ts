import { MongoClient, Db, Collection } from "mongodb";

export interface UserDoc {
  _id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}
export interface SessionDoc {
  _id: string; // sha256 of the cookie token
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface InterviewSummary {
  id: string;
  savedAt: number;
  title: string;
  type: string;
  durationSeconds: number;
  score: number | null;
  verdict: string | null;
}
export interface InterviewDoc {
  _id: string; // `${userId}:${id}`
  userId: string;
  id: string;
  savedAt: number;
  summary: InterviewSummary;
  data: Record<string, unknown>;
}
export interface LeaseDoc {
  _id: string; // userId
  holder: string;
  expiresAt: Date;
}

let client: MongoClient | null = null;
let db: Db | null = null;
let memoryServer: { stop: () => Promise<unknown> } | null = null;

export async function connectDb(): Promise<void> {
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MONGODB_URI is required in production.");
    }
    // Local development without a database: start a throwaway in-memory MongoDB
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const mem = await MongoMemoryServer.create();
    memoryServer = mem;
    uri = mem.getUri();
    console.warn("MONGODB_URI is not set: using a temporary in-memory database. Data is lost on restart.");
  }
  client = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "barraiser");

  await Promise.all([
    users().createIndex({ email: 1 }, { unique: true }),
    sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    interviews().createIndex({ userId: 1, savedAt: -1 }),
    leases().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function closeDb(): Promise<void> {
  await client?.close().catch(() => {});
  await memoryServer?.stop().catch(() => {});
  client = null;
  db = null;
  memoryServer = null;
}

export async function pingDb(): Promise<boolean> {
  try {
    await db!.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

function need(): Db {
  if (!db) throw new Error("Database is not connected.");
  return db;
}
export const users = (): Collection<UserDoc> => need().collection<UserDoc>("users");
export const sessions = (): Collection<SessionDoc> => need().collection<SessionDoc>("sessions");
export const interviews = (): Collection<InterviewDoc> => need().collection<InterviewDoc>("interviews");
export const leases = (): Collection<LeaseDoc> => need().collection<LeaseDoc>("live_leases");

/**
 * One live interview per user, enforced in the database so it holds across several server instances.
 * A lease expires on its own if its holder dies without releasing it.
 */
export async function acquireLease(userId: string, holder: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const taken = await leases().updateOne({ _id: userId, expiresAt: { $lt: now } }, { $set: { holder, expiresAt } });
  if (taken.matchedCount > 0) return true;
  try {
    await leases().insertOne({ _id: userId, holder, expiresAt });
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false; // someone else holds a live lease
    throw err;
  }
}

export async function renewLease(userId: string, holder: string, ttlMs: number): Promise<boolean> {
  const r = await leases().updateOne({ _id: userId, holder }, { $set: { expiresAt: new Date(Date.now() + ttlMs) } });
  return r.matchedCount > 0;
}

export async function releaseLease(userId: string, holder: string): Promise<void> {
  await leases().deleteOne({ _id: userId, holder }).catch(() => {});
}
