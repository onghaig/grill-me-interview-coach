import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import {
  SYSTEM_DESIGN_QUESTIONS,
  getInterviewerSystemInstruction,
  SystemDesignQuestion,
} from "./prompts/interviewer.ts";

import crypto from "crypto";
import { connectDb, closeDb, pingDb, acquireLease, renewLease, releaseLease } from "./server/db.ts";
import {
  attachUser,
  requireAuth,
  sameOriginOnly,
  registerAuthRoutes,
  userFromCookieHeader,
  originAllowed,
  AuthUser,
} from "./server/auth.ts";
import { registerInterviewRoutes } from "./server/interviews.ts";
import { rateLimit } from "./server/limits.ts";
import { generate, extractJson, LlmConfig, LlmError, Provider, PROVIDERS, PROVIDER_LABEL, MODEL_NAME_RE } from "./server/llm.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
// 5 MB covers a 3 MB PDF (base64) plus the rest of the request
app.use(express.json({ limit: "5mb" }));

app.get("/healthz", async (_req, res) => {
  const db = await pingDb();
  res.status(db ? 200 : 503).json({ ok: db, db });
});

app.use(sameOriginOnly);
app.use(attachUser());
registerAuthRoutes(app);
registerInterviewRoutes(app);

/** Limits on what a user can send us. The same numbers are enforced in the browser. */
const LIMITS = {
  resumeChars: 15_000,
  pdfBytes: 3 * 1024 * 1024,
  principlesChars: 6_000,
  roleChars: 500,
  promptChars: 4_000,
};

// Each user brings their own API keys. They are used for the request and never stored or logged.
function validKey(k: unknown): k is string {
  return typeof k === "string" && k.length >= 20 && k.length <= 300 && !/\s/.test(k);
}
function makeAi(key: string) {
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: { apiVersion: "v1beta", headers: { "User-Agent": "bar-raiser" } },
  });
}
const header = (req: express.Request, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Which model runs question writing, rubrics and grading. Live voice always uses Gemini, so a Gemini key is
 * always required; the text provider can be Gemini, OpenAI or Anthropic.
 */
function llmFromRequest(req: express.Request, res: express.Response): LlmConfig | null {
  const geminiKey = header(req, "x-gemini-key");
  if (!validKey(geminiKey)) {
    res.status(400).json({ error: "Add your Gemini API key first (Account menu, Models and keys).", code: "no_key" });
    return null;
  }
  const provider = (header(req, "x-llm-provider") || "gemini") as Provider;
  if (!PROVIDERS.includes(provider)) {
    res.status(400).json({ error: "Unknown model provider." });
    return null;
  }
  const model = header(req, "x-llm-model") || undefined;
  if (model && !MODEL_NAME_RE.test(model)) {
    res.status(400).json({ error: "That model name has characters that are not allowed." });
    return null;
  }
  if (provider === "gemini") return { provider, key: geminiKey, model };
  const key = header(req, "x-llm-key");
  if (!validKey(key)) {
    res.status(400).json({ error: `Add your ${PROVIDER_LABEL[provider]} API key first (Account menu, Models and keys).`, code: "no_key" });
    return null;
  }
  return { provider, key, model };
}
const perUser = rateLimit({ max: 20, key: (r) => `gen:${r.user?.id || r.ip}` });

/** Turn a model-provider failure into something a user can act on, instead of a wall of JSON. */
function sendLlmError(res: express.Response, what: string, err: any) {
  const provider: Provider = err instanceof LlmError ? err.provider : "gemini";
  const label = PROVIDER_LABEL[provider];
  let status = Number(err?.status) || 0;
  if (!status) {
    try {
      status = Number(JSON.parse(String(err?.message || "{}"))?.error?.code) || 0;
    } catch {
      /* not JSON */
    }
  }
  console.error(`${what} failed on ${provider} (${status || "unknown"}):`, String(err?.message || err).slice(0, 300));
  let message: string;
  let code = "llm_error";
  if (status === 429) {
    code = "key_quota";
    message = `Your ${label} API key has hit a quota or rate limit. Free keys have daily limits, so try again later or use a key with billing enabled.`;
  } else if (status === 401 || status === 403) {
    code = "key_invalid";
    message = `${label} rejected your API key. Open the account menu, choose Models and keys, and check it.`;
  } else if (status === 404) {
    code = "model_not_found";
    message = `${label} does not recognise the model name you chose. Open Models and keys and fix or clear it.`;
  } else if (status === 400 && provider === "gemini") {
    code = "key_invalid";
    message = "Google rejected your Gemini API key. Open the account menu, choose Models and keys, and check it.";
  } else if (status === 503 || status === 500 || status === 529) {
    message = `${what} failed because ${label} is overloaded right now. Try again in a minute.`;
  } else if (status === 422) {
    message = `${label} declined this request. Try rewording the question.`;
  } else {
    message = `${what} failed: ${String(err?.message || err).slice(0, 200)}`;
  }
  res.status(status === 429 ? 429 : 502).json({ error: message, code });
}

app.post("/api/key/check", requireAuth, perUser, async (req, res) => {
  const provider = (req.body?.provider || "gemini") as Provider;
  const key = req.body?.apiKey;
  const model = typeof req.body?.model === "string" && req.body.model ? req.body.model.trim() : undefined;
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: "Unknown model provider." });
  const label = PROVIDER_LABEL[provider];
  if (!validKey(key)) return res.status(400).json({ error: `That does not look like a ${label} API key.` });
  if (model && !MODEL_NAME_RE.test(model)) return res.status(400).json({ error: "That model name has characters that are not allowed." });
  try {
    await generate({ provider, key, model }, { prompt: "Reply with the single word ok." });
    res.json({ ok: true });
  } catch (err: any) {
    const status = Number(err?.status) || 0;
    if (status === 429) {
      return res.json({ ok: true, warning: `That ${label} key is out of quota right now. It looks valid, so it has been saved.` });
    }
    const msg =
      status === 401 || status === 403 || (status === 400 && provider === "gemini")
        ? `${label} rejected that key. Check that you copied it correctly${provider === "gemini" ? " and that the Gemini API is enabled for it" : ""}.`
        : status === 404
        ? `${label} does not recognise the model name "${model || "(default)"}". Clear the model field to use the default.`
        : `Could not check the ${label} key: ${String(err?.message || err).slice(0, 160)}`;
    res.status(400).json({ error: msg });
  }
});

// API: list questions
app.get("/api/questions", (_req, res) => {
  res.json({ questions: SYSTEM_DESIGN_QUESTIONS });
});

// API: grade interview
const RUBRIC_PROMPT = (userPrompt: string) => `You are a Principal Engineer who designs system design interviews.
A candidate wants to practice on this topic or question:

"""
${userPrompt}
"""

First decide which kind of interview this is:
- "system_design": large-scale distributed systems (services, scaling, storage, availability).
- "low_level_design": object-oriented / class design (e.g. parking lot, elevator, chess, LRU cache as a class, library management, design patterns, SOLID, machine coding).
- "coding": algorithms and data structures, LeetCode style (arrays, strings, trees, graphs, DP, two pointers, a problem name or number like "LeetCode 146" or "two sum"). For a LeetCode problem name or number, reconstruct the problem faithfully.
Then turn it into a well-scoped interview question and a grading rubric. Output ONLY valid JSON:
{
  "type": "system_design" | "low_level_design" | "coding",
  "title": "short question title, e.g. Design a rate limiter",
  "difficulty": "Medium" | "Hard" | "Very Hard",
  "scale": "system_design: concrete scale numbers. low_level_design: scope/size of the domain (e.g. 3 floors, 4 vehicle types). coding: input constraints only (e.g. n up to 10^5). Do NOT state the expected time or space complexity, the candidate must work that out",
  "description": "The problem statement given to the candidate, written in Markdown. Start with 1-3 plain sentences. Use \`inline code\` for identifiers and values and **bold** sparingly. coding: after the statement add a '**Example 1**' line followed by a fenced code block with Input / Output (and a one-line explanation), a second example if useful, then a '**Constraints**' line followed by a bullet list. low_level_design: after the statement add a '**Requirements**' line followed by a bullet list of 4-6 concrete requirements. system_design: statement only, plus a '**Requirements**' bullet list only if the user supplied some. Never include the solution.",
  "suggestedRequirements": { "functional": ["..."], "nonFunctional": ["..."] },
  "keyComponents": ["components a strong design usually includes"],
  "questionNotes": "private interviewer notes. system_design: key tradeoffs, numbers, pitfalls. low_level_design: expected entities, relationships, fitting patterns, extension scenarios, concurrency concerns. coding: the optimal solution and its time/space complexity, the brute force, a 3-step hint ladder, tricky edge cases and common bugs",
  "rubric": {
    "categories": [
      {
        "name": "category name",
        "weight": number,
        "description": "what is being assessed",
        "strongSignals": ["2-3 observable behaviours of a strong answer"],
        "weakSignals": ["2-3 observable behaviours of a weak answer"]
      }
    ],
    "mustCover": ["4-6 specific technical topics a strong candidate must address for THIS question"],
    "redFlags": ["3-5 specific mistakes that should count heavily against the candidate"]
  }
}
Rules: 5 to 6 categories whose weights are integers summing to exactly 100. Make every signal specific to this question, not generic. Keep every field short: one sentence per description, notes under 150 words. Categories by type:
- system_design: requirements/scoping, estimation, high-level architecture, deep dive on the hardest part of THIS problem, communication/trade-offs.
- low_level_design: requirements & use cases, entity and relationship modelling, class/interface design (SOLID, patterns used appropriately), extensibility under a new requirement, code quality of the key methods, concurrency/error handling, communication.
- coding: problem understanding & clarifying questions, approach & algorithm choice, correctness of the implementation, complexity analysis, testing (dry run, edge cases), code quality, communication and handling of hints. If the input is vague, pick the most sensible well-known interpretation.`;

function normalizeRubricQuestion(raw: any, userPrompt: string) {
  const strArr = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  const cats = (Array.isArray(raw?.rubric?.categories) ? raw.rubric.categories : [])
    .filter((c: any) => c && c.name)
    .map((c: any) => ({
      name: String(c.name),
      weight: Math.max(1, Number(c.weight) || 1),
      description: String(c.description || ""),
      strongSignals: strArr(c.strongSignals),
      weakSignals: strArr(c.weakSignals),
    }));
  if (cats.length < 2) throw new Error("Model returned an unusable rubric.");
  const total = cats.reduce((a: number, c: any) => a + c.weight, 0);
  let acc = 0;
  cats.forEach((c: any, i: number) => {
    c.weight = i === cats.length - 1 ? 100 - acc : Math.round((c.weight / total) * 100);
    acc += c.weight;
  });
  const difficulty = ["Medium", "Hard", "Very Hard"].includes(raw.difficulty) ? raw.difficulty : "Hard";
  const type = ["system_design", "low_level_design", "coding", "behavioral"].includes(raw.type) ? raw.type : "system_design";
  return {
    id: "custom-" + Date.now(),
    type,
    title: String(raw.title || userPrompt.slice(0, 80)),
    difficulty,
    scale: String(raw.scale || "Large scale"),
    description: String(raw.description || userPrompt),
    suggestedRequirements: {
      functional: strArr(raw.suggestedRequirements?.functional),
      nonFunctional: strArr(raw.suggestedRequirements?.nonFunctional),
    },
    keyComponents: strArr(raw.keyComponents),
    questionNotes: String(raw.questionNotes || "Probe on scaling and failure modes."),
    rubric: {
      categories: cats,
      mustCover: strArr(raw.rubric?.mustCover),
      redFlags: strArr(raw.rubric?.redFlags),
    },
  };
}

app.post("/api/rubric", requireAuth, perUser, async (req, res) => {
  try {
    const userPrompt = String(req.body?.prompt || "").trim();
    if (!userPrompt) return res.status(400).json({ error: "Enter a question or topic first." });
    if (userPrompt.length > LIMITS.promptChars) return res.status(413).json({ error: `Keep the question under ${LIMITS.promptChars} characters.` });
    const llm = llmFromRequest(req, res);
    if (!llm) return;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await generate(llm, { prompt: RUBRIC_PROMPT(userPrompt), json: true });
        const question = normalizeRubricQuestion(extractJson(text), userPrompt);
        return res.json({ question });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  } catch (error: any) {
    console.error("Rubric generation error:", error);
    sendLlmError(res, "Building the question", error);
  }
});

const BEHAVIORAL_PROMPT = (opts: { resumeText: string; hasPdf: boolean; principles: string; role: string }) => `You are a hiring manager and bar raiser who runs behavioral interviews.
Design a 30-minute behavioral interview for a candidate.

${opts.role ? `Role or company context from the candidate:\n"""\n${opts.role}\n"""\n` : ""}
${opts.principles ? `Leadership principles, values or business information the interview must assess:\n"""\n${opts.principles}\n"""\n` : "No principles were supplied, so assess common senior-engineer leadership competencies (ownership, dealing with ambiguity, conflict, influencing without authority, raising the bar, delivering results, learning from failure).\n"}
${opts.resumeText ? `Candidate resume:\n"""\n${opts.resumeText}\n"""\n` : opts.hasPdf ? "The candidate's resume is attached as a PDF.\n" : "No resume was supplied, so write questions that do not depend on a specific resume.\n"}
Output ONLY valid JSON:
{
  "title": "Behavioral interview: short role/company or theme, e.g. Behavioral interview: Senior Engineer at Acme",
  "difficulty": "Medium" | "Hard",
  "scale": "e.g. About 30 minutes, 6 to 8 stories",
  "description": "Markdown. 2 sentences on what this interview covers, then a '**Focus areas**' line followed by a bullet list of the competencies or principles that will be assessed. Do NOT list the questions.",
  "candidateSummary": "PRIVATE. 3-5 sentences summarising the candidate's background from the resume: roles, years, notable projects with any numbers, seniority. Only facts in the resume. Empty string if no resume.",
  "plannedQuestions": [
    {
      "competency": "exact principle or competency name this question assesses",
      "question": "an open question that asks for ONE specific past example, phrased the way a person would say it aloud",
      "followUps": ["2 probing follow-ups: the candidate's own role and decision, and the measurable result"],
      "anchor": "the specific resume item this is based on, or empty"
    }
  ],
  "questionNotes": "PRIVATE. Under 150 words: what a strong answer sounds like at this seniority, and the common weak patterns (all 'we', no metrics, no ownership, blame).",
  "rubric": {
    "categories": [{ "name": "category", "weight": number, "description": "one sentence: what is assessed", "strongSignals": ["2-3 items"], "weakSignals": ["2-3 items"] }],
    "mustCover": ["competencies or principles that must come up with a real example"],
    "redFlags": ["specific behaviours that count heavily against the candidate"]
  }
}
Rules: 7 or 8 plannedQuestions, ordered, the first an easy warm-up about their background or current role. Cover every principle supplied (merge if there are more than eight); use their exact names for the competency field only. Never name a principle inside the question text itself, because a real interviewer asks about the situation, not the label. Anchor at least half of the questions on specific resume items and never invent resume facts. 5 to 7 rubric categories with integer weights summing to exactly 100: one per major principle or competency (group if many), plus "Structure and specificity of examples" (clear situation, personal actions, measurable result) and "Self-awareness and learning". Make every signal concrete for this candidate and these principles.`;

const STR = { type: Type.STRING };
const STR_LIST = { type: Type.ARRAY, items: STR };
// A response schema makes Gemini return syntactically valid JSON, which long prompts otherwise sometimes break
const BEHAVIORAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: STR,
    difficulty: STR,
    scale: STR,
    description: STR,
    candidateSummary: STR,
    plannedQuestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { competency: STR, question: STR, followUps: STR_LIST, anchor: STR },
        required: ["competency", "question", "followUps"],
      },
    },
    questionNotes: STR,
    rubric: {
      type: Type.OBJECT,
      properties: {
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { name: STR, weight: { type: Type.INTEGER }, description: STR, strongSignals: STR_LIST, weakSignals: STR_LIST },
            required: ["name", "weight", "description", "strongSignals", "weakSignals"],
          },
        },
        mustCover: STR_LIST,
        redFlags: STR_LIST,
      },
      required: ["categories", "mustCover", "redFlags"],
    },
  },
  required: ["title", "description", "plannedQuestions", "questionNotes", "rubric"],
};

app.post("/api/behavioral", requireAuth, perUser, async (req, res) => {
  try {
    const resumeText = String(req.body?.resumeText || "").trim();
    const principles = String(req.body?.principles || "").trim();
    const role = String(req.body?.role || "").trim();
    const pdf = req.body?.resumePdf as { data?: string; mimeType?: string } | undefined;

    if (resumeText.length > LIMITS.resumeChars)
      return res.status(413).json({ error: `Your resume text is over the ${LIMITS.resumeChars.toLocaleString()} character limit. Trim it to the most recent roles.` });
    if (principles.length > LIMITS.principlesChars)
      return res.status(413).json({ error: `The principles text is over ${LIMITS.principlesChars.toLocaleString()} characters.` });
    if (role.length > LIMITS.roleChars) return res.status(413).json({ error: `Keep the role under ${LIMITS.roleChars} characters.` });

    let hasPdf = false;
    if (pdf?.data) {
      if (pdf.mimeType !== "application/pdf" || !/^[A-Za-z0-9+/=]+$/.test(pdf.data)) {
        return res.status(400).json({ error: "The resume must be a PDF or plain text." });
      }
      const bytes = Buffer.from(pdf.data, "base64");
      if (bytes.length > LIMITS.pdfBytes)
        return res.status(413).json({ error: `That PDF is over the ${LIMITS.pdfBytes / 1024 / 1024} MB limit. Paste the text of your resume instead.` });
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "That file is not a valid PDF." });
      hasPdf = true;
    }
    if (!resumeText && !hasPdf && !principles && !role) {
      return res.status(400).json({ error: "Add a resume, or the principles or role you want to be interviewed on." });
    }
    const llm = llmFromRequest(req, res);
    if (!llm) return;

    const prompt = BEHAVIORAL_PROMPT({ resumeText, hasPdf, principles, role });

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await generate(llm, {
          prompt,
          pdf: hasPdf ? { data: pdf!.data!, mimeType: "application/pdf" } : undefined,
          json: true,
          geminiSchema: BEHAVIORAL_SCHEMA,
        });
        const raw = extractJson(text);
        const question: any = normalizeRubricQuestion({ ...raw, type: "behavioral" }, role || principles || "Behavioral interview");
        const planned = (Array.isArray(raw.plannedQuestions) ? raw.plannedQuestions : [])
          .filter((q: any) => q && q.question)
          .slice(0, 10)
          .map((q: any) => ({
            competency: String(q.competency || "General"),
            question: String(q.question),
            followUps: (Array.isArray(q.followUps) ? q.followUps : []).map((f: any) => String(f)).slice(0, 4),
            anchor: q.anchor ? String(q.anchor) : "",
          }));
        if (planned.length < 3) throw new Error("Model returned too few interview questions.");
        question.plannedQuestions = planned;
        const summary = String(raw.candidateSummary || "").trim();
        if (summary) question.questionNotes = `Candidate background (from the resume): ${summary}\n\n${question.questionNotes}`;
        question.scale = String(raw.scale || "About 30 minutes, 6 to 8 stories");
        return res.json({ question });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  } catch (error: any) {
    console.error("Behavioral generation error:", error);
    sendLlmError(res, "Preparing the interview", error);
  }
});

app.post("/api/grade", requireAuth, perUser, async (req, res) => {
  try {
    const llm = llmFromRequest(req, res);
    if (!llm) return;
    const { question, transcript, diagramText, codeText, durationSeconds } = req.body;
    const qType: string = question?.type || "system_design";
    const roleLine =
      qType === "behavioral"
        ? "a hiring manager and Bar Raiser who grades behavioral interviews strictly on evidence"
        : qType === "coding"
        ? "a Staff Software Engineer and Bar Raiser running algorithms and data structures coding interviews"
        : qType === "low_level_design"
        ? "a Principal Engineer and Bar Raiser specialising in object-oriented / low-level design interviews"
        : "a Principal Distributed Systems Architect and Bar Raiser at a top tier tech company (FAANG)";

    if (!transcript || transcript.length === 0) {
      return res.status(400).json({ error: "No transcript provided to grade." });
    }

    // No timestamps or banner formatting: they cost tokens and carry no grading signal
    const transcriptFormatted = (Array.isArray(transcript) ? transcript : [])
      .map((t: { role: string; text: string }) => `${t.role === "user" ? "Candidate" : "Interviewer"}: ${String(t.text || "").trim()}`)
      .join("\n");

    const rubric = question?.rubric;
    const categoryTemplate = rubric
      ? rubric.categories
          .map(
            (c: any) => `    {
      "name": ${JSON.stringify(c.name)},
      "score": number (1-5),
      "feedback": "1-2 sentences of evidence (weight ${c.weight}%)"
    }`
          )
          .join(",\n")
      : qType === "behavioral"
      ? ["Specificity & Structure of Examples", "Ownership & Personal Impact", "Results & Metrics", "Judgment & Trade-offs", "Self-Awareness & Learning", "Communication"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "1-2 sentences of evidence"\n    }`)
          .join(",\n")
      : qType === "coding"
      ? ["Problem Understanding & Clarification", "Approach & Algorithm Choice", "Correctness of Implementation", "Complexity Analysis", "Testing & Edge Cases", "Communication & Use of Hints"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "1-2 sentences of evidence"\n    }`)
          .join(",\n")
      : qType === "low_level_design"
      ? ["Requirements & Use Cases", "Entity & Relationship Modelling", "Class & Interface Design (SOLID, Patterns)", "Extensibility & Edge Cases", "Code Quality of Key Methods", "Communication & Drive"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "1-2 sentences of evidence"\n    }`)
          .join(",\n")
      : `    {
      "name": "Requirement Clarification & Scoping",
      "score": number (1-5),
      "feedback": "Analysis of functional/non-functional scoping"
    },
    {
      "name": "Back-of-Envelope Estimation",
      "score": number (1-5),
      "feedback": "Analysis of capacity, QPS, storage math"
    },
    {
      "name": "High-Level Architecture & Diagramming",
      "score": number (1-5),
      "feedback": "Analysis of data flow, components, whiteboard usage"
    },
    {
      "name": "Deep Dive & Bottleneck Mitigation",
      "score": number (1-5),
      "feedback": "Analysis of scaling, caching, sharding, single points of failure"
    },
    {
      "name": "Communication & Drive",
      "score": number (1-5),
      "feedback": "Analysis of trade-off articulation and structure"
    }`;
    const rubricBlock = rubric
      ? `
GRADING RUBRIC (grade strictly against this; scores are 1-5 where 3 is meets the bar):
${rubric.categories
  .map(
    (c: any) =>
      `- ${c.name} (${c.weight}%): ${c.description}\n    Strong: ${(c.strongSignals || []).join("; ")}\n    Weak: ${(c.weakSignals || []).join("; ")}`
  )
  .join("\n")}
Must-cover topics: ${(rubric.mustCover || []).join("; ")}
Red flags: ${(rubric.redFlags || []).join("; ")}
In your feedback, say which must-cover topics were hit or missed and call out any red flags that occurred. Only give credit for what is in the transcript or diagram.
`
      : "";

    const kind = qType === "behavioral" ? "behavioral" : qType === "coding" ? "coding" : qType === "low_level_design" ? "low-level design" : "system design";
    const showDiagram = qType !== "behavioral" && !!String(diagramText || "").trim();
    const showCode = qType !== "behavioral" && !!String(codeText || "").trim();
    const typeNote =
      qType === "behavioral"
        ? "This was a spoken behavioral interview. Grade on specific examples, the candidate's own actions (I versus we), measurable results, judgment and self-awareness, and credit only what the transcript shows."
        : qType === "coding"
        ? "Judge the correctness and complexity of the final code, whether they tested it, and how many hints they needed."
        : "";

    const gradingPrompt = `You are ${roleLine}. Grade this ${kind} interview strictly on evidence.

QUESTION: ${question?.title || "Interview question"}
${question?.scale ? `Scope: ${question.scale}\n` : ""}${question?.description ? `${question.description}\n` : ""}${rubricBlock}Duration: ${Math.round((durationSeconds || 0) / 60)} minutes.
${typeNote}
${showDiagram ? `\nWHITEBOARD (text serialization of the final diagram):\n${diagramText}\n` : ""}${showCode ? `\nFINAL CODE:\n${codeText}\n` : ""}
TRANSCRIPT:
${transcriptFormatted}

Reply with JSON only, in this shape. Be concise but specific: cite evidence from the transcript, never generic praise.
{
  "overallVerdict": "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire",
  "totalScore": number (1-100),
  "summary": "2-3 sentences: performance and the decision rationale",
  "categoryScores": [
${categoryTemplate}
  ],
  "strengths": ["2-3 items, one sentence each"],
  "areasForImprovement": ["2-3 items, one sentence each"],
  "keyArchitecturalTradeoffs": ["up to 2 trade-offs the candidate discussed or should have; empty if none apply"],
  "recommendedStudyTopics": ["2-3 short topic names"]
}`;

    {
      const parsed = extractJson(await generate(llm, { prompt: gradingPrompt, json: true }));
      if (rubric && Array.isArray(parsed.categoryScores)) {
        let weighted = 0;
        let weightSum = 0;
        parsed.categoryScores = parsed.categoryScores.map((cs: any) => {
          const match = rubric.categories.find((c: any) => c.name === cs.name);
          const w = match?.weight ?? 0;
          const score = Math.max(1, Math.min(5, Number(cs.score) || 1));
          weighted += (score / 5) * w;
          weightSum += w;
          return { ...cs, score, weight: w };
        });
        if (weightSum > 0) parsed.totalScore = Math.round((weighted / weightSum) * 100);
      }
      return res.json(parsed);
    }

  } catch (error: any) {
    console.error("Grading error:", error);
    sendLlmError(res, "Grading", error);
  }
});

// The opening turn is the one place the interviewer talks at length
function kickoffInstruction(q: SystemDesignQuestion): string {
  if (q.type === "behavioral") {
    const first = q.plannedQuestions?.[0];
    return `[START OF INTERVIEW] The candidate has just joined the call. Open the behavioral interview like a real interviewer, in this order, as natural speech:
1. Greet them warmly and say you're glad they could make it. Introduce yourself in a few words as their interviewer for today.
2. In one or two sentences, explain the format: about thirty minutes, a conversation about their past experience, you'll ask for specific examples, and it's fine to take a moment to think.
3. If the private notes contain a candidate background, say naturally that you've had a look at their background and mention one concrete thing from it. Do not recite their resume.
4. Then ask exactly this FIRST question, in natural spoken words but keeping its meaning and every specific in it (company, project, numbers), and stop. Do not substitute a different question. ${first ? `First question: "${first.question}"${first.anchor ? ` (based on: ${first.anchor})` : ""}` : "Ask a friendly warm-up about their current role and background."}

Hard rules for this opening:
- Do NOT mention a whiteboard, code, an editor or a screen. There is none in this interview.
- Do NOT name, list or hint at any leadership principles, values or competencies. Never say the word "principles".
- Say in step 3 that you looked over their background, with one specific from the notes, before asking the question.
- Do NOT ask whether they have questions before starting and do NOT ask what they want to cover. Your last sentence is the first question.
- Do NOT invent anything about their schedule, the company or how they got here. Only use facts from the private notes.
Speak for roughly 15 to 30 seconds, friendly and unhurried.

Interview focus (private reference): ${q.title}. ${q.description}`;
  }
  const kind =
    q.type === "coding"
      ? "coding interview"
      : q.type === "low_level_design"
      ? "low-level design interview"
      : "system design interview";
  const exampleLine =
    q.type === "coding"
      ? "Walk through one small example out loud (input and expected output), but do not hint at the approach."
      : q.type === "low_level_design"
      ? "Mention the main things the system has to do, in a sentence or two, without naming classes or patterns."
      : "Mention the scale in plain spoken numbers, but do not propose any components.";
  return `[START OF INTERVIEW] The candidate has just joined the call. Open the ${kind} like a real interviewer, in this order, as natural speech:
1. Greet them warmly and say you're glad they could make it. Introduce yourself in a few words as their interviewer for today.
2. In one sentence, explain the format: about thirty minutes, they can talk through their thinking, and they have a whiteboard and a code editor, and you can see both.
3. Explain the problem in your own words, conversationally, like you're describing it to a colleague. Do not read it verbatim and do not use lists. ${exampleLine}
4. Finish by inviting them to ask any clarifying questions before they start, and ask what they'd like to pin down first.
This opening is the one exception to the short-turns rule: speak for roughly 20 to 40 seconds, but keep it flowing and friendly, and never reveal the solution.

The problem (private reference, rephrase it naturally): ${q.title}. ${q.description}
Scale or constraints: ${q.scale}`;
}

const server = http.createServer(app);

// Setup WebSocket server for Gemini Live & Voice session
const wss = new WebSocketServer({ server, path: "/ws/live", maxPayload: 1024 * 1024 });

const LEASE_MS = 60_000;

wss.on("connection", (clientWs: WebSocket, req) => {
  // Authenticate from the session cookie. Messages wait for this before doing anything.
  const authReady: Promise<AuthUser | null> = originAllowed(req)
    ? userFromCookieHeader(req.headers.cookie).catch(() => null)
    : Promise.resolve(null);
  let ai: GoogleGenAI | null = null;
  let llmCfg: LlmConfig | null = null;
  let userId: string | null = null;
  let leaseHolder: string | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const sendJson = (o: object) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(o));
  };

  let liveSession: any = null;
  let isConnected = false;
  let sessionMode: "live_socket" | "conversational_engine" = "conversational_engine";
  let currentQuestion: SystemDesignQuestion = SYSTEM_DESIGN_QUESTIONS[0];
  // "note" entries are background context (whiteboard, code, timer), never something the candidate said
  let conversationHistory: Array<{ role: "user" | "model" | "note"; text: string }> = [];
  // Private guidance from the evaluator; used once on the next turn and never quoted
  let coachNotes: string[] = [];
  let latestDiagramContext = "";
  let currentPhase = "Clarify requirements";
  let pushToTalk = false;
  let sessionGen = 0;
  let latestCodeContext = "";

  // Whiteboard and code snapshots are appended to the live conversation, and the model re-reads the whole
  // conversation on every turn. So skip identical snapshots and send at most one per kind every 12 seconds
  // (the newest one always goes out last).
  const CONTEXT_GAP_MS = 12_000;
  const lastContext: Record<string, { sent: string; at: number }> = {};
  const contextTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
  const pushContext = (kind: "diagram" | "code", raw: string, formatted: string) => {
    const last = lastContext[kind] || (lastContext[kind] = { sent: "", at: 0 });
    if (raw === last.sent) return;
    const deliver = () => {
      last.sent = raw;
      last.at = Date.now();
      if (liveSession && sessionMode === "live_socket" && isConnected) {
        liveSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: formatted }] }], turnComplete: false });
      } else if (sessionMode === "conversational_engine" && isConnected) {
        // Keep only the latest snapshot of each kind in the text history
        conversationHistory = conversationHistory.filter((c) => !(c.role === "note" && c.text.startsWith(`[${kind.toUpperCase()} UPDATE]`)));
        conversationHistory.push({ role: "note", text: formatted });
      }
    };
    clearTimeout(contextTimers[kind]);
    const wait = last.at + CONTEXT_GAP_MS - Date.now();
    if (wait <= 0) deliver();
    else contextTimers[kind] = setTimeout(deliver, wait);
  };

  const cleanupSession = async () => {
    sessionGen++;
    for (const k of Object.keys(contextTimers)) clearTimeout(contextTimers[k]);
    for (const k of Object.keys(lastContext)) delete lastContext[k];
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (userId && leaseHolder) {
      const holder = leaseHolder;
      leaseHolder = null;
      await releaseLease(userId, holder);
    }
    if (liveSession) {
      try {
        await liveSession.close();
      } catch (err) {}
      liveSession = null;
    }
    isConnected = false;
    conversationHistory = [];
    coachNotes = [];
  };

  // Helper to generate a conversational turn using Gemini 3.8 Flash
  const generateInterviewerTurn = async (userPrompt: string, isKickoff = false, isEvent = false) => {
    try {
      const systemInstruction = getInterviewerSystemInstruction(currentQuestion);
      const coachGuidance = coachNotes.length
        ? `\nPrivate guidance from the evaluator. Act on it in your own words at this turn. Never quote it, never mention an evaluator or coach:\n${coachNotes.map((n) => `- ${n}`).join('\n')}\n`
        : '';
      coachNotes = [];

      const promptContext = `System Instruction:
${systemInstruction}

Current Phase: ${currentPhase}
Latest Whiteboard Diagram Context:
${latestDiagramContext || "(Candidate has not drawn any components yet)"}
Latest Code In Editor:
${latestCodeContext || "(No code yet)"}

Conversation History:
${conversationHistory.slice(-16).map((c) => (c.role === 'note' ? `(Background note, nobody said this aloud) ${c.text}` : `${c.role === 'user' ? 'Candidate' : 'Interviewer'}: ${c.text}`)).join('\n')}
${coachGuidance}
${isEvent ? 'Latest event (not spoken by the candidate):' : 'Latest Candidate Input:'}
${userPrompt}

Remember:
- Speak briefly: 1-3 sentences per turn, unless this is the [START OF INTERVIEW] opening, which should be a friendly 20-40 second introduction. You are the interviewer, not a lecturer.
- If candidate asked a question or shared ideas, respond directly and ask a probing follow-up.
- If candidate updated the whiteboard diagram, refer to their drawn shapes and arrows naturally.
- Never give away the design.
- Never say bracketed tags or system wording out loud. Speak only as the interviewer.
Interviewer Spoken Response:`;

      if (llmCfg) {
        const reply = await generate(llmCfg, { prompt: promptContext });
        const replyText = reply.replace(/\[[A-Z][A-Z _-]*(?::[^\]]*)?\]:?/g, "").trim();
        if (replyText) {
          conversationHistory.push({ role: "model", text: replyText });
          clientWs.send(
            JSON.stringify({
              type: "output_transcript",
              text: replyText,
            })
          );
          clientWs.send(JSON.stringify({ type: "turn_complete" }));
          return;
        }
      }

      // Contextual fallback response if API key is not yet set
      let fallbackReply = "";
      if (isKickoff) {
        fallbackReply = `Hi, welcome, and thanks for joining. I'll be your interviewer today. We've got about thirty minutes, so feel free to think out loud, and use the whiteboard or the code editor, since I can see both. Today's problem is: ${currentQuestion.title}. ${currentQuestion.description.replace(/[*`#]/g, "")} Before you dive in, what questions do you have, or what would you like to pin down first?`;
      } else if (latestDiagramContext && !conversationHistory.some(c => c.text.includes('whiteboard') || c.text.includes('diagram'))) {
        fallbackReply = `Looking at your whiteboard diagram, I see your components laid out. Can you walk me through the end-to-end lifecycle of a request from the client?`;
      } else if (currentPhase.toLowerCase().includes('estimate')) {
        fallbackReply = `That sounds reasonable. Now let's move into back-of-the-envelope estimation. Given the scale of ${currentQuestion.scale}, what are your read and write QPS numbers, and how much storage do we need?`;
      } else if (currentPhase.toLowerCase().includes('deep')) {
        fallbackReply = `Let's drill into the failure modes. What happens if your cache layer suffers a partition failure or network outage? How do we prevent thundering herd on the database?`;
      } else {
        fallbackReply = `Good point. How does this architecture handle high availability across multiple regions, and what trade-offs are you making regarding consistency?`;
      }

      conversationHistory.push({ role: "model", text: fallbackReply });
      clientWs.send(
        JSON.stringify({
          type: "output_transcript",
          text: fallbackReply,
        })
      );
      clientWs.send(JSON.stringify({ type: "turn_complete" }));
    } catch (err: any) {
      console.error("Error generating interviewer turn:", err);
      const safeReply = `Understood. Can you walk me through the trade-offs in your choice of storage and data partitioning?`;
      clientWs.send(
        JSON.stringify({
          type: "output_transcript",
          text: safeReply,
        })
      );
      clientWs.send(JSON.stringify({ type: "turn_complete" }));
    }
  };

  clientWs.on("message", async (rawMessage) => {
    try {
      const user = await authReady;
      if (!user) {
        sendJson({ type: "error", code: "unauthorized", error: "Please sign in again." });
        clientWs.close(4401, "unauthorized");
        return;
      }
      userId = user.id;
      const msg = JSON.parse(rawMessage.toString());

      if (msg.type === "start") {
        await cleanupSession();

        pushToTalk = !!msg.pushToTalk;

        const key = typeof msg.apiKey === "string" ? msg.apiKey.trim() : "";
        if (!validKey(key)) {
          sendJson({ type: "error", code: "no_key", error: "Add your Gemini API key first (Account menu, Models and keys)." });
          return;
        }
        ai = makeAi(key); // live voice is always Gemini

        // The text fallback (used only if the live voice connection is unavailable) follows the user's provider choice
        const wanted: Provider = PROVIDERS.includes(msg.llm?.provider) ? msg.llm.provider : "gemini";
        const wantedModel = typeof msg.llm?.model === "string" && MODEL_NAME_RE.test(msg.llm.model) ? msg.llm.model : undefined;
        if (wanted === "gemini") {
          llmCfg = { provider: "gemini", key, model: wantedModel };
        } else if (validKey(msg.llm?.key)) {
          llmCfg = { provider: wanted, key: msg.llm.key, model: wantedModel };
        } else {
          sendJson({ type: "error", code: "no_key", error: `Add your ${PROVIDER_LABEL[wanted]} API key first (Account menu, Models and keys).` });
          return;
        }

        // One live interview per account, across all tabs, devices and server instances
        const holder = crypto.randomUUID();
        if (!(await acquireLease(user.id, holder, LEASE_MS))) {
          sendJson({
            type: "error",
            code: "live_limit",
            error: "You already have a live interview running. End it, or close the other tab, then try again.",
          });
          return;
        }
        leaseHolder = holder;
        heartbeat = setInterval(async () => {
          if (!leaseHolder) return;
          const ok = await renewLease(user.id, leaseHolder, LEASE_MS).catch(() => true);
          if (!ok) {
            sendJson({ type: "status", status: "closed", message: "This interview was ended because it was started somewhere else." });
            cleanupSession();
          }
        }, 20_000);
        const gen = sessionGen;
        const questionId = msg.questionId;
        const found = SYSTEM_DESIGN_QUESTIONS.find((q) => q.id === questionId);
        if (found) {
          currentQuestion = found;
        } else if (msg.customQuestion) {
          const cq = msg.customQuestion;
          currentQuestion = {
            id: cq.id || "custom",
            title: cq.title || "Custom System Design",
            difficulty: cq.difficulty || "Hard",
            scale: cq.scale || "10M DAU",
            description: cq.description || "",
            suggestedRequirements: cq.suggestedRequirements || { functional: [], nonFunctional: [] },
            keyComponents: cq.keyComponents || [],
            questionNotes: cq.questionNotes || "Probe on scaling and failure modes.",
            rubric: cq.rubric,
          };
        }

        const systemInstruction = getInterviewerSystemInstruction(currentQuestion);

        // Try connecting via Gemini Live API first
        let liveConnected = false;
        {
          // Attempt Live API connection
          const liveModelsToTry = ["gemini-3.1-flash-live-preview", "gemini-3.8-live", "gemini-2.5-flash-native-audio-latest"];
          for (const modelCandidate of liveModelsToTry) {
            try {
              liveSession = await ai!.live.connect({
                model: modelCandidate,
                config: {
                  responseModalities: [Modality.AUDIO],
                  // Long interviews: once the conversation is large, drop the oldest turns instead of re-reading all of it
                  // on every reply. The thresholds are high so a normal 30 minute interview keeps its full context.
                  contextWindowCompression: { triggerTokens: "90000", slidingWindow: { targetTokens: "50000" } },
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: msg.voice || "Sulafat",
                      },
                    },
                  },
                  systemInstruction,
                  inputAudioTranscription: {},
                  outputAudioTranscription: {},
                  realtimeInputConfig: pushToTalk
                    ? {
                        // Push-to-talk: the client marks the start/end of each turn explicitly.
                        automaticActivityDetection: { disabled: true },
                      }
                    : {
                        automaticActivityDetection: {
                          endOfSpeechSensitivity: "END_SENSITIVITY_LOW" as any,
                          silenceDurationMs: 1400,
                        },
                      },
                },
                callbacks: {
                  onopen: () => {
                    isConnected = true;
                    sessionMode = "live_socket";
                    clientWs.send(
                      JSON.stringify({
                        type: "status",
                        status: "connected",
                        mode: "live_socket",
                        message: `Live voice session active with ${modelCandidate}`,
                      })
                    );
                  },
                  onmessage: (liveMsg: any) => {
                    const serverContent = liveMsg.serverContent;
                    if (!serverContent) return;

                    // Model audio output
                    if (serverContent.modelTurn?.parts) {
                      for (const part of serverContent.modelTurn.parts) {
                        if (part.inlineData?.data) {
                          clientWs.send(
                            JSON.stringify({
                              type: "audio",
                              data: part.inlineData.data,
                            })
                          );
                        }
                      }
                    }

                    // User speech transcription
                    if (serverContent.inputTranscription?.text) {
                      clientWs.send(
                        JSON.stringify({
                          type: "input_transcript",
                          text: serverContent.inputTranscription.text,
                          isFinal: true,
                        })
                      );
                    } else if (serverContent.interimInputTranscription?.text) {
                      clientWs.send(
                        JSON.stringify({
                          type: "input_transcript",
                          text: serverContent.interimInputTranscription.text,
                          isFinal: false,
                        })
                      );
                    }

                    // Interviewer speech transcription
                    if (serverContent.outputTranscription?.text) {
                      clientWs.send(
                        JSON.stringify({
                          type: "output_transcript",
                          text: serverContent.outputTranscription.text,
                        })
                      );
                    }

                    // Interrupted
                    if (serverContent.interrupted) {
                      clientWs.send(JSON.stringify({ type: "interrupted" }));
                    }

                    // Turn complete
                    if (serverContent.turnComplete) {
                      clientWs.send(JSON.stringify({ type: "turn_complete" }));
                    }
                  },
                  onerror: (err: any) => {
                    console.warn(`Live session error on ${modelCandidate}:`, err?.message || err);
                  },
                  onclose: () => {
                    // Only tell the client if Gemini dropped on its own (not our own cleanup/restart)
                    if (gen !== sessionGen) return;
                    isConnected = false;
                    if (clientWs.readyState === WebSocket.OPEN) {
                      clientWs.send(
                        JSON.stringify({ type: "status", status: "closed", message: "The voice session ended unexpectedly." })
                      );
                    }
                  },
                },
              });

              liveConnected = true;
              break;
            } catch (err: any) {
              console.warn(`Live API connect attempt failed for ${modelCandidate}:`, err?.message || err);
            }
          }
        }

        if (liveConnected && liveSession) {
          isConnected = true;
          sessionMode = "live_socket";
          if (msg.kickoff !== false) {
            liveSession.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: kickoffInstruction(currentQuestion),
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          }
        } else {
          // Switch to conversational AI engine with spoken browser voice
          isConnected = true;
          sessionMode = "conversational_engine";
          clientWs.send(
            JSON.stringify({
              type: "status",
              status: "connected",
              mode: "conversational_engine",
              message: "Senior Staff Interviewer connected with Spoken Voice output",
            })
          );

          // Deliver opening prompt
          await generateInterviewerTurn(
            kickoffInstruction(currentQuestion),
            true
          );
        }
      } else if (msg.type === "audio") {
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        }
      } else if (msg.type === "audio_end") {
        // The client stopped sending audio because the mic went quiet; flush anything the model has buffered
        if (liveSession && sessionMode === "live_socket" && isConnected && !pushToTalk) {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        }
      } else if (msg.type === "ptt_start") {
        if (liveSession && sessionMode === "live_socket" && isConnected && pushToTalk) {
          liveSession.sendRealtimeInput({ activityStart: {} });
        }
      } else if (msg.type === "ptt_end") {
        if (liveSession && sessionMode === "live_socket" && isConnected && pushToTalk) {
          liveSession.sendRealtimeInput({ activityEnd: {} });
        }
      } else if (msg.type === "code") {
        latestCodeContext = String(msg.text || "").slice(0, 12000);
        pushContext("code", latestCodeContext, `[CODE UPDATE] (${msg.language || "code"})\n${latestCodeContext}`);
      } else if (msg.type === "diagram") {
        latestDiagramContext = String(msg.text || "").slice(0, 8000);
        pushContext("diagram", latestDiagramContext, `[DIAGRAM UPDATE]\n${latestDiagramContext}`);
      } else if (msg.type === "coach") {
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: `[COACH]: ${msg.text}` }],
              },
            ],
            turnComplete: false,
          });
        } else if (sessionMode === "conversational_engine" && isConnected) {
          // Held for the next turn, same as the live path: no immediate reply and not logged as candidate speech
          coachNotes.push(String(msg.text));
        }
      } else if (msg.type === "phase_advance") {
        currentPhase = msg.label || msg.phase;
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: `[PHASE TIMER UPDATE]: Candidate has transitioned to the "${currentPhase}" phase.` }],
              },
            ],
            turnComplete: false,
          });
        } else if (sessionMode === "conversational_engine" && isConnected) {
          conversationHistory.push({ role: "note", text: `[PHASE TIMER UPDATE]: Moved to phase ${currentPhase}` });
          await generateInterviewerTurn(`The timer moved the interview to the "${currentPhase}" phase. Say so naturally, like a real interviewer.`, false, true);
        }
      } else if (msg.type === "user_text") {
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: msg.text }],
              },
            ],
            turnComplete: true,
          });
        } else if (sessionMode === "conversational_engine" && isConnected) {
          conversationHistory.push({ role: "user", text: msg.text });
          await generateInterviewerTurn(msg.text);
        }
      } else if (msg.type === "stop") {
        await cleanupSession();
        clientWs.send(
          JSON.stringify({
            type: "status",
            status: "closed",
            message: "Interview ended by user.",
          })
        );
      }
    } catch (err: any) {
      console.error("WebSocket message handling error:", err);
    }
  });

  clientWs.on("close", () => {
    cleanupSession();
  });
});

// Vite or Static handling
async function startServer() {
  await connectDb();
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`> Bar Raiser server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: end live sessions so their leases are released before the database closes
  const shutdown = async () => {
    console.log("Shutting down...");
    for (const c of wss.clients) c.close(1001, "server restarting");
    server.close();
    await new Promise((r) => setTimeout(r, 1500));
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
