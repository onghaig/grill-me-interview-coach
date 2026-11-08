import type { Express, Request, Response } from "express";
import { libraryQuestions } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { LIBRARY, LIBRARY_BY_ID, LibraryEntry } from "../prompts/library.ts";
import type { CodingSpec } from "../prompts/interviewer.ts";

const SVG_MAX = 20_000;
const BAD_SVG = /<script|<foreignObject|<style|<image|<iframe|\son\w+\s*=|javascript:|href\s*=|data:/i;

/** A model-written picture is only kept if it is plain shapes and text. It is shown through an <img>, so it cannot run code either way. */
export function cleanSvg(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s) || s.length > SVG_MAX || BAD_SVG.test(s)) return undefined;
  if (!/xmlns=/.test(s.slice(0, 200))) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/i.test(s.slice(0, 400))) return undefined;
  return s;
}

const KINDS = ["plain", "list", "tree"];

/** Keep the runnable part of a coding question only if it is complete and sensible. */
export function cleanCoding(raw: any): CodingSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const mode = raw.mode === "design" ? "design" : raw.mode === "function" ? "function" : "none";
  const starterCode = String(raw.starterCode || "").slice(0, 4000);
  if (mode === "none") return { mode, entry: "", argKinds: [], returnKind: "plain", starterCode, tests: [] };
  const entry = String(raw.entry || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(entry)) return { mode: "none", entry: "", argKinds: [], returnKind: "plain", starterCode, tests: [] };
  const tests = (Array.isArray(raw.tests) ? raw.tests : [])
    .filter((t: any) => t && typeof t.input === "string" && typeof t.expected === "string" && t.input.length <= 2000 && t.expected.length <= 2000)
    .slice(0, 14)
    .map((t: any) => ({ input: t.input, expected: t.expected, ...(t.hidden ? { hidden: true } : {}) }));
  if (tests.length < 2) return { mode: "none", entry: "", argKinds: [], returnKind: "plain", starterCode, tests: [] };
  const argKinds = (Array.isArray(raw.argKinds) ? raw.argKinds : []).map((k: any) => (KINDS.includes(k) ? k : "plain")).slice(0, 8);
  const returnKind = [...KINDS, "arg0"].includes(raw.returnKind) ? raw.returnKind : "plain";
  return { mode, entry, argKinds, returnKind, unordered: !!raw.unordered, starterCode, tests };
}

export const EXTRA_CODING = `
Additional required fields for this question (add them to the same JSON object):
  "diagramSvg": "A small SVG picture that helps explain the problem: for example a linked list, a tree, a grid, a graph or an array with a pointer drawn as boxes and arrows, matching Example 1. Plain <svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 480 160\\"> with only rect, circle, line, path, polygon and text elements and inline fill/stroke attributes. Use stroke=\\"#94a3b8\\" for lines and boxes, fill=\\"none\\" for boxes, and fill=\\"#e2e8f0\\" for text with font-size 14. No scripts, styles, images or links. Empty string if a picture would not help.",
  "coding": {
    "mode": "\\"function\\" when the task is one function, \\"design\\" when the task is a class with operations (LRU Cache, Min Stack, Trie), \\"none\\" when it cannot be tested with plain data (cycles or random pointers),",
    "entry": "the function name in snake_case Python (for example two_sum), or the class name for design questions",
    "argKinds": ["one per argument: \\"plain\\", \\"list\\" (the input is a Python list that becomes a singly linked list of ListNode(val, next)) or \\"tree\\" (the input is a level-order list with None for gaps that becomes TreeNode(val, left, right))"],
    "returnKind": "\\"plain\\", \\"list\\", \\"tree\\", or \\"arg0\\" when the function changes its first argument in place and returns nothing (the test then compares that argument)",
    "unordered": "true only when the statement allows the answer in any order",
    "starterCode": "Python starter code with the exact signature and a docstring-free body of 'pass'. Define no helper classes except for design questions. ListNode and TreeNode are provided by the runner, so do not define them",
    "tests": [{ "input": "mode function: the call arguments written as Python source, comma separated, for example: [2, 7, 11, 15], 9. mode design: two Python lists, the operation names then their arguments, for example: [\\"LRUCache\\", \\"put\\", \\"get\\"], [[2], [1, 1], [1]]", "expected": "the expected return value as a Python literal, for example [0, 1]. mode design: the list of return values, using None for operations that return nothing", "hidden": "false for the first three tests (they match the examples in the statement), true for the rest" }]
  }
Give 8 to 10 tests: the examples, then edge cases (empty or single element, duplicates, negatives, the largest realistic input). Every expected value must be exactly right: work each one out carefully, and prefer small inputs you can verify by hand. The statement must be original: your own wording, your own scenario and your own numbers in the examples, solving the same underlying task. Do not copy any website's text.`;

export const EXTRA_DESIGN = `
Additional required field (add it to the same JSON object):
  "diagramSvg": "A small SVG picture that frames the problem, for example the main actors and the data flow between them as labelled boxes and arrows, WITHOUT giving away the architecture a candidate should produce. Plain <svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 480 200\\"> with only rect, circle, line, path, polygon and text elements and inline fill/stroke attributes. Use stroke=\\"#94a3b8\\" for lines and boxes, fill=\\"none\\" for boxes, and fill=\\"#e2e8f0\\" for text with font-size 14. No scripts, styles, images or links. Empty string if a picture would not help."
The statement must be original and in your own words.`;

export interface LibraryDeps {
  llmFromRequest: (req: Request, res: Response) => any | null;
  sendLlmError: (res: Response, what: string, err: unknown) => void;
  perUser: any;
  /** Builds the prompt for one catalog entry, calls the model, and returns the finished question. */
  generate: (llm: any, entry: LibraryEntry) => Promise<Record<string, unknown>>;
}

export function registerLibraryRoutes(app: Express, deps: LibraryDeps) {
  app.get("/api/library", requireAuth, async (_req, res) => {
    const cached = await libraryQuestions().find({}, { projection: { _id: 1 } }).toArray();
    res.json({ entries: LIBRARY, cached: cached.map((c) => c._id) });
  });

  app.post("/api/library/:id", requireAuth, async (req, res, next) => {
    const entry = LIBRARY_BY_ID[String(req.params.id)];
    if (!entry) return res.status(404).json({ error: "That question is not in the library." });
    // A question someone already opened costs no tokens and needs no key
    const hit = await libraryQuestions().findOne({ _id: entry.id });
    if (hit) return res.json({ question: hit.question, cached: true });
    next();
  }, deps.perUser, async (req: Request, res: Response) => {
    const entry = LIBRARY_BY_ID[String(req.params.id)];
    try {
      const llm = deps.llmFromRequest(req, res);
      if (!llm) return;
      const question = await deps.generate(llm, entry);
      // If two people opened it at the same moment, keep the first one stored so everyone sees the same question
      await libraryQuestions().updateOne({ _id: entry.id }, { $setOnInsert: { question, createdAt: Date.now() } }, { upsert: true });
      const stored = await libraryQuestions().findOne({ _id: entry.id });
      res.json({ question: stored?.question ?? question, cached: false });
    } catch (err) {
      console.error("Library generation error:", err);
      deps.sendLlmError(res, "Writing the question", err);
    }
  });
}
