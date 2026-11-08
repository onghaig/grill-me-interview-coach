import type { Express } from "express";
import { interviews, InterviewSummary } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { normalizeTiming } from "../prompts/timing.ts";

const ID_RE = /^iv_\d{10,16}$/;
const MAX_PER_USER = 200;
const MAX_IMAGE_CHARS = 1_600_000;

function summarize(id: string, d: any): InterviewSummary {
  return {
    id,
    savedAt: Number(d.savedAt) || Date.now(),
    title: String(d.question?.title || "Interview").slice(0, 200),
    type: String(d.question?.type || "system_design"),
    durationSeconds: Number(d.durationSeconds) || 0,
    score: d.scorecard && Number.isFinite(Number(d.scorecard.totalScore)) ? Number(d.scorecard.totalScore) : null,
    verdict: d.scorecard?.overallVerdict ? String(d.scorecard.overallVerdict) : null,
  };
}

/** Keep only the fields the app uses, with sane size limits. */
function sanitize(id: string, b: any): Record<string, unknown> | null {
  if (!b || typeof b !== "object") return null;
  if (!b.question || typeof b.question !== "object" || !b.question.title) return null;
  if (!Array.isArray(b.transcript) || b.transcript.length > 2000) return null;
  const image =
    typeof b.whiteboardImage === "string" && b.whiteboardImage.startsWith("data:image/png;base64,") && b.whiteboardImage.length < MAX_IMAGE_CHARS
      ? b.whiteboardImage
      : undefined;
  return {
    id,
    savedAt: Number(b.savedAt) || Date.now(),
    question: b.question,
    transcript: b.transcript.map((t: any) => ({
      id: String(t.id || ""),
      role: t.role === "user" ? "user" : "interviewer",
      text: String(t.text || "").slice(0, 8000),
      timestamp: String(t.timestamp || ""),
    })),
    diagramText: String(b.diagramText || "").slice(0, 40000),
    whiteboardImage: image,
    code: String(b.code || "").slice(0, 40000),
    codeLanguage: String(b.codeLanguage || "Python").slice(0, 30),
    durationSeconds: Math.max(0, Number(b.durationSeconds) || 0),
    timing: normalizeTiming(b.timing),
    scorecard: b.scorecard && typeof b.scorecard === "object" ? b.scorecard : null,
  };
}

export function registerInterviewRoutes(app: Express) {
  app.get("/api/interviews", requireAuth, async (req, res) => {
    const docs = await interviews()
      .find({ userId: req.user!.id })
      .project<{ summary: InterviewSummary }>({ summary: 1 })
      .sort({ savedAt: -1 })
      .limit(MAX_PER_USER)
      .toArray();
    res.json({ interviews: docs.map((d) => d.summary) });
  });

  app.get("/api/interviews/:id", requireAuth, async (req, res) => {
    const doc = await interviews().findOne({ _id: `${req.user!.id}:${req.params.id}` });
    if (!doc) return res.status(404).json({ error: "Interview not found." });
    res.json({ interview: doc.data });
  });

  app.put("/api/interviews/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    if (!ID_RE.test(id)) return res.status(400).json({ error: "Invalid interview id." });
    const data = sanitize(id, req.body);
    if (!data) return res.status(400).json({ error: "Invalid interview data." });

    const _id = `${req.user!.id}:${id}`;
    const exists = await interviews().findOne({ _id }, { projection: { _id: 1 } });
    if (!exists && (await interviews().countDocuments({ userId: req.user!.id })) >= MAX_PER_USER) {
      return res.status(409).json({ error: `You have reached the limit of ${MAX_PER_USER} saved interviews. Delete some first.` });
    }
    const summary = summarize(id, data);
    await interviews().replaceOne(
      { _id },
      { userId: req.user!.id, id, savedAt: summary.savedAt, summary, data },
      { upsert: true }
    );
    res.json({ summary });
  });

  app.delete("/api/interviews/:id", requireAuth, async (req, res) => {
    await interviews().deleteOne({ _id: `${req.user!.id}:${req.params.id}` });
    res.json({ ok: true });
  });
}
