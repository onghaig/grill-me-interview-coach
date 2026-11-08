import type { Express } from "express";
import { liveSessions, LiveSessionDoc } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { rateLimit } from "./limits.ts";
import { normalizeTiming } from "../prompts/timing.ts";

const ID_RE = /^ls_\d{10,16}$/;
const MAX_PER_USER = 5;
const MAX_SCENE_CHARS = 900_000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const PHASES = ["clarify", "estimate", "design", "deep_dive", "wrap_up"];

/** Keep only the fields an in-progress interview needs, with size limits. */
export function sanitizeSession(b: any): { status: "active" | "paused"; data: Record<string, unknown> } | null {
  if (!b || typeof b !== "object") return null;
  if (!b.question || typeof b.question !== "object" || !b.question.title) return null;
  if (!Array.isArray(b.transcript) || b.transcript.length > 2000) return null;

  let scene: unknown[] | undefined;
  if (Array.isArray(b.scene) && b.scene.length <= 3000) {
    const elements = b.scene.filter((e: any) => e && typeof e === "object");
    // A drawing that is too large to store is dropped rather than failing the whole save
    if (JSON.stringify(elements).length <= MAX_SCENE_CHARS) scene = elements;
  }

  return {
    status: b.status === "paused" ? "paused" : "active",
    data: {
      question: b.question,
      timing: normalizeTiming(b.timing),
      voice: String(b.voice || "").slice(0, 30),
      phase: PHASES.includes(b.phase) ? b.phase : "clarify",
      phaseLabel: String(b.phaseLabel || "").slice(0, 60),
      elapsedSeconds: Math.max(0, Math.min(86_400, Math.round(Number(b.elapsedSeconds) || 0))),
      transcript: b.transcript.map((t: any) => ({
        id: String(t.id || ""),
        role: t.role === "user" ? "user" : "interviewer",
        text: String(t.text || "").slice(0, 8000),
        timestamp: String(t.timestamp || ""),
      })),
      code: String(b.code || "").slice(0, 40_000),
      codeLanguage: String(b.codeLanguage || "Python").slice(0, 30),
      diagramText: String(b.diagramText || "").slice(0, 40_000),
      scene,
    },
  };
}

export async function loadLiveSession(userId: string, id: string): Promise<LiveSessionDoc | null> {
  if (!ID_RE.test(id)) return null;
  return liveSessions().findOne({ _id: `${userId}:${id}` });
}

export function registerLiveSessionRoutes(app: Express) {
  // Autosave runs every few seconds while an interview is live, so allow plenty of room
  const limit = rateLimit({ max: 90, key: (r) => `sessions:${r.user?.id || r.ip}`, message: "Saving too quickly. Wait a moment." });

  app.get("/api/live-sessions", requireAuth, async (req, res) => {
    const docs = await liveSessions().find({ userId: req.user!.id }).sort({ updatedAt: -1 }).limit(MAX_PER_USER).toArray();
    res.json({
      sessions: docs.map((d) => ({
        id: d.id,
        status: d.status,
        title: d.title,
        type: d.type,
        updatedAt: d.updatedAt,
        elapsedSeconds: d.data.elapsedSeconds ?? 0,
        timing: d.data.timing,
        turns: Array.isArray(d.data.transcript) ? d.data.transcript.length : 0,
      })),
    });
  });

  app.get("/api/live-sessions/:id", requireAuth, async (req, res) => {
    const doc = await loadLiveSession(req.user!.id, String(req.params.id));
    if (!doc) return res.status(404).json({ error: "That interview is no longer saved." });
    res.json({ id: doc.id, status: doc.status, updatedAt: doc.updatedAt, ...doc.data });
  });

  // PUT for normal autosave; POST so the browser can also save as the page closes (navigator.sendBeacon only does POST)
  const save = async (req: any, res: any) => {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return res.status(400).json({ error: "Invalid session id." });
    const clean = sanitizeSession(req.body);
    if (!clean) return res.status(400).json({ error: "Invalid session data." });

    const userId = req.user!.id;
    const _id = `${userId}:${id}`;
    const existing = await liveSessions().findOne({ _id }, { projection: { createdAt: 1 } });
    if (!existing && (await liveSessions().countDocuments({ userId })) >= MAX_PER_USER) {
      return res.status(409).json({ error: `You can have ${MAX_PER_USER} interviews in progress at once. Finish or discard one first.` });
    }
    const now = Date.now();
    await liveSessions().replaceOne(
      { _id },
      {
        userId,
        id,
        status: clean.status,
        title: String((clean.data.question as any).title || "Interview").slice(0, 200),
        type: String((clean.data.question as any).type || "system_design"),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        expiresAt: new Date(now + KEEP_MS),
        data: clean.data,
      },
      { upsert: true }
    );
    res.json({ ok: true, updatedAt: now });
  };
  app.put("/api/live-sessions/:id", requireAuth, limit, save);
  app.post("/api/live-sessions/:id", requireAuth, limit, save);

  app.delete("/api/live-sessions/:id", requireAuth, async (req, res) => {
    await liveSessions().deleteOne({ _id: `${req.user!.id}:${req.params.id}` });
    res.json({ ok: true });
  });
}
