import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  SYSTEM_DESIGN_QUESTIONS,
  getInterviewerSystemInstruction,
  SystemDesignQuestion,
} from "./prompts/interviewer.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "15mb" }));
app.set("trust proxy", 1);

// Small in-memory rate limit for the endpoints that spend Gemini quota
const hits = new Map<string, number[]>();
function rateLimit(maxPerMinute: number): express.RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.every((t) => now - t > 60_000)) hits.delete(k);
}, 5 * 60_000).unref();
app.use(["/api/rubric", "/api/grade", "/api/behavioral"], rateLimit(20));

// Text models tried in order; falls through on overload/unavailable errors.
const TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
async function generateWithFallback(params: { contents: any; config?: any }) {
  let lastErr: unknown;
  for (const model of TEXT_MODELS) {
    try {
      return await ai.models.generateContent({ model, ...params });
    } catch (err) {
      lastErr = err;
      console.warn(`generateContent failed on ${model}:`, (err as any)?.status ?? err);
    }
  }
  throw lastErr;
}

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    apiVersion: "v1beta",
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
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
        "strongSignals": ["observable behaviours of a strong answer"],
        "weakSignals": ["observable behaviours of a weak answer"]
      }
    ],
    "mustCover": ["specific technical topics a strong candidate must address for THIS question"],
    "redFlags": ["specific mistakes that should count heavily against the candidate"]
  }
}
Rules: 5 to 6 categories whose weights are integers summing to exactly 100. Make every signal specific to this question, not generic. Categories by type:
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

app.post("/api/rubric", async (req, res) => {
  try {
    const userPrompt = String(req.body?.prompt || "").trim();
    if (!userPrompt) return res.status(400).json({ error: "Enter a question or topic first." });
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await generateWithFallback({
          contents: RUBRIC_PROMPT(userPrompt.slice(0, 4000)),
          config: { responseMimeType: "application/json" },
        });
        const question = normalizeRubricQuestion(JSON.parse(response.text || "{}"), userPrompt);
        return res.json({ question });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  } catch (error: any) {
    console.error("Rubric generation error:", error);
    res.status(500).json({ error: "Could not build a rubric: " + (error?.message || String(error)) });
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
      "followUps": ["2 or 3 probing follow-ups: the candidate's own role, the decision and trade-off, the measurable result, what they would change"],
      "anchor": "the specific resume item this is based on, or empty"
    }
  ],
  "questionNotes": "PRIVATE. For each competency: what a strong answer sounds like for this seniority, and the common weak patterns (all 'we', no metrics, no ownership, blame).",
  "rubric": {
    "categories": [{ "name": "category", "weight": number, "description": "what is assessed", "strongSignals": ["..."], "weakSignals": ["..."] }],
    "mustCover": ["competencies or principles that must come up with a real example"],
    "redFlags": ["specific behaviours that count heavily against the candidate"]
  }
}
Rules: 7 or 8 plannedQuestions, ordered, the first an easy warm-up about their background or current role. Cover every principle supplied (merge if there are more than eight); use their exact names for the competency field only. Never name a principle inside the question text itself, because a real interviewer asks about the situation, not the label. Anchor at least half of the questions on specific resume items and never invent resume facts. 5 to 7 rubric categories with integer weights summing to exactly 100: one per major principle or competency (group if many), plus "Structure and specificity of examples" (clear situation, personal actions, measurable result) and "Self-awareness and learning". Make every signal concrete for this candidate and these principles.`;

app.post("/api/behavioral", async (req, res) => {
  try {
    const resumeText = String(req.body?.resumeText || "").trim().slice(0, 20000);
    const principles = String(req.body?.principles || "").trim().slice(0, 8000);
    const role = String(req.body?.role || "").trim().slice(0, 1000);
    const pdf = req.body?.resumePdf as { data?: string; mimeType?: string } | undefined;
    const hasPdf = !!(pdf?.data && pdf.mimeType === "application/pdf" && pdf.data.length < 14_000_000);
    if (!resumeText && !hasPdf && !principles && !role) {
      return res.status(400).json({ error: "Add a resume, or the principles or role you want to be interviewed on." });
    }
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });

    const prompt = BEHAVIORAL_PROMPT({ resumeText, hasPdf, principles, role });
    const contents = hasPdf
      ? [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "application/pdf", data: pdf!.data! } }] }]
      : prompt;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await generateWithFallback({ contents, config: { responseMimeType: "application/json" } });
        const raw = JSON.parse(response.text || "{}");
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
    res.status(500).json({ error: "Could not prepare the interview: " + (error?.message || String(error)) });
  }
});

app.post("/api/grade", async (req, res) => {
  try {
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

    const transcriptFormatted = transcript
      .map((t: { role: string; text: string; time?: string }) => `[${t.role.toUpperCase()} - ${t.time || ''}]: ${t.text}`)
      .join("\n\n");

    const rubric = question?.rubric;
    const categoryTemplate = rubric
      ? rubric.categories
          .map(
            (c: any) => `    {
      "name": ${JSON.stringify(c.name)},
      "score": number (1-5),
      "feedback": "Evidence-based analysis against this category (weight ${c.weight}%)"
    }`
          )
          .join(",\n")
      : qType === "behavioral"
      ? ["Specificity & Structure of Examples", "Ownership & Personal Impact", "Results & Metrics", "Judgment & Trade-offs", "Self-Awareness & Learning", "Communication"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "Evidence-based analysis"\n    }`)
          .join(",\n")
      : qType === "coding"
      ? ["Problem Understanding & Clarification", "Approach & Algorithm Choice", "Correctness of Implementation", "Complexity Analysis", "Testing & Edge Cases", "Communication & Use of Hints"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "Evidence-based analysis"\n    }`)
          .join(",\n")
      : qType === "low_level_design"
      ? ["Requirements & Use Cases", "Entity & Relationship Modelling", "Class & Interface Design (SOLID, Patterns)", "Extensibility & Edge Cases", "Code Quality of Key Methods", "Communication & Drive"]
          .map((n) => `    {\n      "name": "${n}",\n      "score": number (1-5),\n      "feedback": "Evidence-based analysis"\n    }`)
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

    const gradingPrompt = `You are ${roleLine}.
Review the following ${qType === "behavioral" ? "behavioral" : qType === "coding" ? "coding" : qType === "low_level_design" ? "low-level design" : "system design"} interview performance and provide a comprehensive, realistic evaluation rubric.

QUESTION:
Title: ${question?.title || "System Design Question"}
Scale: ${question?.scale || "High Scale"}
Overview: ${question?.description || ""}

${rubricBlock}
INTERVIEW DURATION: ${Math.round((durationSeconds || 0) / 60)} minutes

LATEST WHITEBOARD DIAGRAM (EXCALIDRAW SERIALIZATION):
${diagramText || "(No diagram components created)"}

FINAL CODE IN THE EDITOR:
${codeText || "(No code written)"}
${qType === "behavioral" ? "This was a spoken behavioral interview: ignore the diagram and code sections. Grade on specific examples, the candidate\u0027s own actions (I versus we), measurable results, judgment and self-awareness, and credit only what the transcript shows." : ""}
${qType === "coding" ? "For coding, judge actual correctness and complexity of the final code, whether they tested it, and how many hints they needed." : ""}

INTERVIEW TRANSCRIPT:
${transcriptFormatted}

Evaluate the candidate rigorously and output valid JSON with the following structure:
{
  "overallVerdict": "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire",
  "totalScore": number (1-100),
  "summary": "2-3 sentences summarizing performance and decision rationale",
  "categoryScores": [
${categoryTemplate}
  ],
  "strengths": ["string", "string", "string"],
  "areasForImprovement": ["string", "string", "string"],
  "keyArchitecturalTradeoffs": ["string", "string"],
  "recommendedStudyTopics": ["string", "string"]
}`;

    if (apiKey) {
      const response = await generateWithFallback({
        contents: gradingPrompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const jsonText = response.text || "{}";
      const parsed = JSON.parse(jsonText);
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

    res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  } catch (error: any) {
    console.error("Grading error:", error);
    res.status(500).json({
      error: "Failed to grade interview: " + (error?.message || String(error)),
    });
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
const wss = new WebSocketServer({ server, path: "/ws/live" });

wss.on("connection", (clientWs: WebSocket) => {
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

  const cleanupSession = async () => {
    sessionGen++;
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
${conversationHistory.map((c) => (c.role === 'note' ? `(Background note, nobody said this aloud) ${c.text}` : `${c.role === 'user' ? 'Candidate' : 'Interviewer'}: ${c.text}`)).join('\n')}
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

      if (apiKey) {
        const response = await generateWithFallback({
          contents: promptContext,
        });

        const replyText = (response.text || "").replace(/\[[A-Z][A-Z _-]*(?::[^\]]*)?\]:?/g, "").trim();
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
      const msg = JSON.parse(rawMessage.toString());

      if (msg.type === "start") {
        await cleanupSession();

        pushToTalk = !!msg.pushToTalk;
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

        // Try connecting via Gemini Live API first if apiKey is set
        let liveConnected = false;
        if (apiKey) {
          // Attempt Live API connection
          const liveModelsToTry = ["gemini-3.1-flash-live-preview", "gemini-3.8-live", "gemini-2.5-flash-native-audio-latest"];
          for (const modelCandidate of liveModelsToTry) {
            try {
              liveSession = await ai.live.connect({
                model: modelCandidate,
                config: {
                  responseModalities: [Modality.AUDIO],
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
        const codeMsg = `[CODE UPDATE] (${msg.language || "code"})\n${latestCodeContext}`;
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: codeMsg }] }],
            turnComplete: false,
          });
        } else if (sessionMode === "conversational_engine" && isConnected) {
          conversationHistory.push({ role: "note", text: codeMsg });
        }
      } else if (msg.type === "diagram") {
        latestDiagramContext = msg.text;
        if (liveSession && sessionMode === "live_socket" && isConnected) {
          liveSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: `[DIAGRAM UPDATE]\n${msg.text}` }],
              },
            ],
            turnComplete: false,
          });
        } else if (sessionMode === "conversational_engine" && isConnected) {
          // Process diagram update
          conversationHistory.push({ role: "note", text: `[DIAGRAM UPDATE]\n${msg.text}` });
        }
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
}

startServer();
