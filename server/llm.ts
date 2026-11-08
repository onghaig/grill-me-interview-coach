import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export type Provider = "gemini" | "openai" | "anthropic";
export const PROVIDERS: Provider[] = ["gemini", "openai", "anthropic"];
export const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic" };

/** Used when the user does not name a model. Gemini uses its own fallback list below. */
export const DEFAULT_MODELS: Record<Exclude<Provider, "gemini">, string> = {
  openai: "gpt-4.1",
  anthropic: "claude-opus-5-5",
};
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash"];

export interface LlmConfig {
  provider: Provider;
  key: string;
  /** Optional model override chosen by the user. */
  model?: string;
}

export interface GenerateRequest {
  prompt: string;
  /** A resume PDF to read along with the prompt. */
  pdf?: { data: string; mimeType: string };
  /** The prompt asks for a JSON object; use the provider's JSON mode where there is one. */
  json?: boolean;
  /** Gemini only: schema that forces syntactically valid JSON. */
  geminiSchema?: unknown;
}

export class LlmError extends Error {
  status: number;
  provider: Provider;
  constructor(provider: Provider, status: number, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

export const MODEL_NAME_RE = /^[A-Za-z0-9._:/-]{1,80}$/;

const TIMEOUT_MS = 120_000;

async function generateGemini(cfg: LlmConfig, req: GenerateRequest): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: cfg.key, httpOptions: { apiVersion: "v1beta", headers: { "User-Agent": "bar-raiser" } } });
  const contents: any = req.pdf
    ? [{ role: "user", parts: [{ text: req.prompt }, { inlineData: { mimeType: req.pdf.mimeType, data: req.pdf.data } }] }]
    : req.prompt;
  const config = req.json ? { responseMimeType: "application/json", ...(req.geminiSchema ? { responseSchema: req.geminiSchema as any } : {}) } : undefined;

  const models = cfg.model ? [cfg.model, ...GEMINI_MODELS.filter((m) => m !== cfg.model)] : GEMINI_MODELS;
  let lastErr: unknown;
  for (const model of models) {
    try {
      const res = await ai.models.generateContent({ model, contents, config });
      return res.text || "";
    } catch (err) {
      lastErr = err;
      console.warn(`gemini ${model} failed:`, (err as any)?.status ?? err);
      // A bad key fails on every model, so stop early. Quotas are per model, so a 429 moves on to the next one
      const status = Number((err as any)?.status) || 0;
      if (status === 400 || status === 401 || status === 403) break;
    }
  }
  const e: any = lastErr;
  throw new LlmError("gemini", Number(e?.status) || 502, String(e?.message || e));
}

async function generateOpenAI(cfg: LlmConfig, req: GenerateRequest): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const content: any = req.pdf
    ? [
        { type: "text", text: req.prompt },
        { type: "file", file: { filename: "resume.pdf", file_data: `data:${req.pdf.mimeType};base64,${req.pdf.data}` } },
      ]
    : req.prompt;
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODELS.openai,
        messages: [{ role: "user", content }],
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    throw new LlmError("openai", 504, `Could not reach OpenAI: ${err?.message || err}`);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new LlmError("openai", res.status, String(body?.error?.message || `HTTP ${res.status}`));
  const choice = body?.choices?.[0];
  if (choice?.message?.refusal) throw new LlmError("openai", 422, `The model declined: ${choice.message.refusal}`);
  return String(choice?.message?.content || "");
}

async function generateAnthropic(cfg: LlmConfig, req: GenerateRequest): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.key, maxRetries: 1, timeout: TIMEOUT_MS });
  const model = cfg.model || DEFAULT_MODELS.anthropic;
  const content: Anthropic.ContentBlockParam[] = [
    // The document goes before the question that refers to it
    ...(req.pdf ? [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: req.pdf.data } }] : []),
    { type: "text", text: req.prompt },
  ];
  const system = req.json ? "Respond with a single valid JSON object and nothing else: no prose before or after it and no code fences." : undefined;
  const base = { model, max_tokens: 16000, system, output_config: { effort: "medium" as const }, messages: [{ role: "user" as const, content }] };

  let message: Anthropic.Message;
  try {
    try {
      // If the model's safety classifiers decline, let the API retry on a fallback model
      message = (await client.beta.messages.create({
        ...base,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any)) as unknown as Anthropic.Message;
    } catch (err) {
      // Some models or accounts do not accept the fallback beta: retry once as a plain request
      if (err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message)) {
        message = await client.messages.create(base as any);
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) throw new LlmError("anthropic", err.status ?? 502, err.message);
    throw new LlmError("anthropic", 504, `Could not reach Anthropic: ${err?.message || err}`);
  }
  if (message.stop_reason === "refusal") {
    throw new LlmError("anthropic", 422, "The model declined this request.");
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** One text generation call on whichever provider the user chose. Returns the model's text. */
export function generate(cfg: LlmConfig, req: GenerateRequest): Promise<string> {
  switch (cfg.provider) {
    case "openai":
      return generateOpenAI(cfg, req);
    case "anthropic":
      return generateAnthropic(cfg, req);
    default:
      return generateGemini(cfg, req);
  }
}

/** Pull a JSON object out of a model reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("The model did not return valid JSON.");
  }
}
