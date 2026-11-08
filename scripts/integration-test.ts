/* Starts the server on a spare port with a temporary in-memory MongoDB and checks auth, isolation, limits and the live lease. */
import { spawn } from "child_process";
import http from "http";
import WebSocket from "ws";

const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const FAKE_KEY = "AIzaFAKEKEYFORTESTINGONLY0123456789abcd";
let failed = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(extra)}`);
  if (!ok) failed++;
};

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as any, setCookie: set || "" };
  }
}

function openWs(cookie: string, origin?: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/live`, { headers: { cookie, ...(origin ? { origin } : {}) } });
    const msgs: any[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", () => resolve({ ws, msgs }));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


// ---- Mock model providers: record what the server sends and answer like the real APIs ----
const RUBRIC_JSON = {
  type: "system_design", title: "Design a cache", difficulty: "Hard", scale: "1M rps", description: "Design a cache.",
  suggestedRequirements: { functional: ["get"], nonFunctional: ["fast"] }, keyComponents: ["lru"], questionNotes: "notes",
  rubric: {
    categories: [
      { name: "Scoping", weight: 40, description: "d", strongSignals: ["a"], weakSignals: ["b"] },
      { name: "Design", weight: 60, description: "d", strongSignals: ["a"], weakSignals: ["b"] },
    ],
    mustCover: ["eviction"], redFlags: ["no ttl"],
  },
};
const BEHAVIORAL_JSON = {
  title: "Behavioral interview: Engineer", difficulty: "Hard", scale: "About 30 minutes", description: "Covers ownership.",
  candidateSummary: "Engineer.", questionNotes: "n",
  plannedQuestions: [1, 2, 3].map((i) => ({ competency: "Ownership", question: `Tell me about time ${i}`, followUps: ["why"], anchor: "" })),
  rubric: RUBRIC_JSON.rubric,
};
interface Seen { path: string; headers: http.IncomingHttpHeaders; body: any }
const seen: { openai: Seen[]; anthropic: Seen[] } = { openai: [], anthropic: [] };

function startMock(kind: "openai" | "anthropic", port: number): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      seen[kind].push({ path: req.url || "", headers: req.headers, body });
      const auth = String(req.headers.authorization || req.headers["x-api-key"] || "");
      const send = (status: number, obj: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (auth.includes("QUOTA")) return send(429, { error: { message: "rate limited", type: "rate_limit_error" }, type: "error" });
      if (auth.includes("BADKEY")) return send(401, { error: { message: "bad key", type: "authentication_error" }, type: "error" });
      if (kind === "anthropic" && auth.includes("REJECTBETA") && req.headers["anthropic-beta"]) {
        return send(400, { type: "error", error: { type: "invalid_request_error", message: "fallbacks is not supported for this model" } });
      }
      const prompt = JSON.stringify(body.messages || "");
      const reply = prompt.includes("behavioral interview for a candidate") || prompt.includes("Design a 30-minute behavioral") ? BEHAVIORAL_JSON : RUBRIC_JSON;
      const text = prompt.includes("Reply with the single word ok") ? "ok" : kind === "anthropic" ? "```json\n" + JSON.stringify(reply) + "\n```" : JSON.stringify(reply);
      if (kind === "openai") return send(200, { choices: [{ message: { role: "assistant", content: text } }] });
      return send(200, { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    });
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
}

async function main() {
  const mocks = [await startMock("openai", 3391), await startMock("anthropic", 3392)];
  const server = spawn("npx", ["tsx", "server.ts"], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI: "", GEN_RATE_LIMIT_PER_MIN: "500", NODE_ENV: "development", OPENAI_BASE_URL: "http://localhost:3391/v1", ANTHROPIC_BASE_URL: "http://localhost:3392" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE + "/healthz")).ok) break;
      } catch {}
      await sleep(500);
    }
    const health = await fetch(BASE + "/healthz").then((r) => r.json());
    check("healthz reports the database is up", health.ok === true, health);

    const a = new Client();
    const b = new Client();
    const anon = new Client();

    check("anonymous /api/auth/me is 401", (await anon.req("GET", "/api/auth/me")).status === 401);
    check("anonymous cannot generate", (await anon.req("POST", "/api/rubric", { prompt: "x" })).status === 401);
    check("anonymous cannot list interviews", (await anon.req("GET", "/api/interviews")).status === 401);

    const bad = await anon.req("POST", "/api/auth/signup", { email: "nope", password: "longenough1" });
    check("signup rejects a bad email", bad.status === 400, bad.json);
    const short = await anon.req("POST", "/api/auth/signup", { email: "x@y.com", password: "short" });
    check("signup rejects a short password", short.status === 400, short.json);

    const su = await a.req("POST", "/api/auth/signup", { email: "Alice@Example.com", password: "correct horse" });
    check("signup works", su.status === 201 && su.json.user?.email === "alice@example.com", su.json);
    check("session cookie is HttpOnly and SameSite=Lax", /HttpOnly/.test(su.setCookie) && /SameSite=Lax/.test(su.setCookie), su.setCookie);
    check("signed-in /me works", (await a.req("GET", "/api/auth/me")).json.user?.email === "alice@example.com");
    const dup = await anon.req("POST", "/api/auth/signup", { email: "alice@example.com", password: "another pass" });
    check("duplicate email is rejected", dup.status === 409, dup.json);
    check("wrong password is rejected", (await anon.req("POST", "/api/auth/login", { email: "alice@example.com", password: "wrong pass 1" })).status === 401);
    await b.req("POST", "/api/auth/signup", { email: "bob@example.com", password: "battery staple" });

    // Gemini key handling
    const nokey = await a.req("POST", "/api/rubric", { prompt: "design a cache" });
    check("generating without a key says so (400, no_key)", nokey.status === 400 && nokey.json.code === "no_key", nokey.json);

    // Size caps (checked before the key)
    const longResume = await a.req("POST", "/api/behavioral", { resumeText: "x".repeat(15_001) });
    check("resume text over the cap is 413", longResume.status === 413, longResume.json);
    const bigPdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(3 * 1024 * 1024 + 10)]).toString("base64");
    const pdfBig = await a.req("POST", "/api/behavioral", { resumePdf: { data: bigPdf, mimeType: "application/pdf" } });
    check("PDF over 3 MB is 413", pdfBig.status === 413, pdfBig.json);
    const notPdf = await a.req("POST", "/api/behavioral", { resumePdf: { data: Buffer.from("hello world, not a pdf").toString("base64"), mimeType: "application/pdf" } });
    check("a non-PDF with a PDF mime type is rejected", notPdf.status === 400, notPdf.json);
    const hugeBody = await a.req("POST", "/api/rubric", { prompt: "x".repeat(6 * 1024 * 1024) }, { "x-gemini-key": FAKE_KEY });
    check("a request body over 5 MB is refused", hugeBody.status === 413 || hugeBody.status === 400, hugeBody.status);


    // ---- Choosing a model provider ----
    const gk = { "x-gemini-key": FAKE_KEY };
    const oaiKey = "sk-test-openai-key-0123456789abcdef";
    const antKey = "sk-ant-test-key-0123456789abcdefghij";
    const unk = await a.req("POST", "/api/rubric", { prompt: "x" }, { ...gk, "x-llm-provider": "mistral" });
    check("an unknown provider is rejected", unk.status === 400, unk.json);
    const nolk = await a.req("POST", "/api/rubric", { prompt: "x" }, { ...gk, "x-llm-provider": "openai" });
    check("OpenAI without its key says so", nolk.status === 400 && nolk.json.code === "no_key" && /OpenAI/.test(nolk.json.error), nolk.json);
    const badModel = await a.req("POST", "/api/rubric", { prompt: "x" }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey, "x-llm-model": "bad model!" });
    check("a malformed model name is rejected", badModel.status === 400, badModel.json);

    const oai = await a.req("POST", "/api/rubric", { prompt: "Design a cache" }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey });
    const oaiSeen = seen.openai[seen.openai.length - 1];
    check("OpenAI: question is generated", oai.status === 200 && oai.json.question?.rubric?.categories?.length === 2, oai.json);
    check("OpenAI: weights are normalised to 100", oai.json.question?.rubric?.categories?.reduce((t: number, c: any) => t + c.weight, 0) === 100);
    check("OpenAI: sent to chat/completions with the user's key and the default model", oaiSeen?.path === "/v1/chat/completions" && oaiSeen.headers.authorization === `Bearer ${oaiKey}` && oaiSeen.body.model === "gpt-4.1", oaiSeen);
    check("OpenAI: JSON mode is on and the prompt carries the question", oaiSeen?.body.response_format?.type === "json_object" && JSON.stringify(oaiSeen.body.messages).includes("Design a cache"));
    check("OpenAI: the Gemini key is not sent to OpenAI", !JSON.stringify(oaiSeen).includes(FAKE_KEY));
    await a.req("POST", "/api/rubric", { prompt: "Design a cache" }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey, "x-llm-model": "gpt-5-mini" });
    check("OpenAI: a chosen model name is used", seen.openai[seen.openai.length - 1].body.model === "gpt-5-mini");

    const ant = await a.req("POST", "/api/rubric", { prompt: "Design a cache" }, { ...gk, "x-llm-provider": "anthropic", "x-llm-key": antKey });
    const antSeen = seen.anthropic[seen.anthropic.length - 1];
    check("Anthropic: question is generated from a fenced JSON reply", ant.status === 200 && ant.json.question?.rubric?.categories?.length === 2, ant.json);
    check("Anthropic: sends the user's key through the SDK and defaults to claude-opus-5-5", (antSeen?.headers["x-api-key"] === antKey || antSeen?.headers.authorization === `Bearer ${antKey}`) && antSeen.body.model === "claude-opus-5-5", antSeen?.headers);
    check("Anthropic: asks for JSON only and sets effort", /JSON/.test(String(antSeen?.body.system)) && antSeen?.body.output_config?.effort === "medium");
    check("Anthropic: refusal fallback is requested", antSeen?.body.fallbacks === "default" && String(antSeen.headers["anthropic-beta"]).includes("server-side-fallback"), antSeen?.body.fallbacks);
    const before = seen.anthropic.length;
    const rej = await a.req("POST", "/api/rubric", { prompt: "Design a cache" }, { ...gk, "x-llm-provider": "anthropic", "x-llm-key": "sk-ant-REJECTBETA-0123456789abcdef" });
    check("Anthropic: retries without the fallback beta if it is rejected", rej.status === 200 && seen.anthropic.length - before === 2 && !seen.anthropic[seen.anthropic.length - 1].headers["anthropic-beta"], { status: rej.status, calls: seen.anthropic.length - before });

    // Resume PDF handling per provider
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200)]).toString("base64");
    const bo = await a.req("POST", "/api/behavioral", { resumePdf: { data: pdf, mimeType: "application/pdf" }, principles: "Ownership" }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey });
    const boSeen = seen.openai[seen.openai.length - 1];
    check("OpenAI: behavioral interview with a PDF resume", bo.status === 200 && bo.json.question?.plannedQuestions?.length === 3, bo.json);
    check("OpenAI: the PDF goes in as a file part", Array.isArray(boSeen.body.messages[0].content) && boSeen.body.messages[0].content.some((p: any) => p.type === "file" && p.file.file_data.startsWith("data:application/pdf;base64,")));
    const ba = await a.req("POST", "/api/behavioral", { resumePdf: { data: pdf, mimeType: "application/pdf" }, principles: "Ownership" }, { ...gk, "x-llm-provider": "anthropic", "x-llm-key": antKey });
    const baSeen = seen.anthropic[seen.anthropic.length - 1];
    check("Anthropic: behavioral interview with a PDF resume", ba.status === 200 && ba.json.question?.plannedQuestions?.length === 3, ba.json);
    check("Anthropic: the PDF is a document block placed before the text", baSeen.body.messages[0].content[0].type === "document" && baSeen.body.messages[0].content[0].source.media_type === "application/pdf" && baSeen.body.messages[0].content[1].type === "text");

    // Grading goes through the chosen provider too
    const gr = await a.req("POST", "/api/grade", { question: { title: "Design a cache", type: "system_design" }, transcript: [{ role: "user", text: "hi" }], durationSeconds: 60 }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey });
    const grSeen = seen.openai[seen.openai.length - 1];
    check("grading sends a compact transcript without timestamps", /Candidate: hi/.test(JSON.stringify(grSeen.body.messages)) && !/\d{1,2}:\d{2}:\d{2}/.test(JSON.stringify(grSeen.body.messages)), grSeen.body.messages);
    check("grading omits empty whiteboard and code sections", !/WHITEBOARD|FINAL CODE/.test(JSON.stringify(grSeen.body.messages)));
    void gr;

    // Timing reaches the grader
    await a.req("POST", "/api/grade", { question: { title: "Design a cache", type: "system_design" }, transcript: [{ role: "user", text: "hi" }], durationSeconds: 600, timing: { mode: "practice" } }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey });
    const prSeen = JSON.stringify(seen.openai[seen.openai.length - 1].body.messages);
    check("grading is told a practice session was untimed", /untimed practice session/.test(prSeen) && /Do not judge pacing/.test(prSeen));
    await a.req("POST", "/api/grade", { question: { title: "Design a cache", type: "system_design" }, transcript: [{ role: "user", text: "hi" }], durationSeconds: 600, timing: { mode: "timed", minutes: 45 } }, { ...gk, "x-llm-provider": "openai", "x-llm-key": oaiKey });
    check("grading is told the length of a timed interview", /timed 45 minute interview/.test(JSON.stringify(seen.openai[seen.openai.length - 1].body.messages)));

    // Errors are explained per provider
    const q429 = await a.req("POST", "/api/rubric", { prompt: "x" }, { ...gk, "x-llm-provider": "openai", "x-llm-key": "sk-QUOTA-0123456789abcdef0123" });
    check("OpenAI quota error is explained", q429.status === 429 && q429.json.code === "key_quota" && /OpenAI/.test(q429.json.error), q429.json);
    const a401 = await a.req("POST", "/api/rubric", { prompt: "x" }, { ...gk, "x-llm-provider": "anthropic", "x-llm-key": "sk-ant-BADKEY-0123456789abcdef" });
    check("Anthropic bad-key error is explained", a401.json.code === "key_invalid" && /Anthropic/.test(a401.json.error), a401.json);

    // Key check endpoint per provider
    const kc = await a.req("POST", "/api/key/check", { provider: "openai", apiKey: oaiKey });
    check("key check works for OpenAI", kc.status === 200 && kc.json.ok === true, kc.json);
    const kcb = await a.req("POST", "/api/key/check", { provider: "anthropic", apiKey: "sk-ant-BADKEY-0123456789abcdef" });
    check("key check rejects a bad Anthropic key with a clear message", kcb.status === 400 && /Anthropic rejected/.test(kcb.json.error), kcb.json);
    const kcq = await a.req("POST", "/api/key/check", { provider: "openai", apiKey: "sk-QUOTA-0123456789abcdef0123" });
    check("key check treats a quota error as a valid key", kcq.status === 200 && !!kcq.json.warning, kcq.json);

    // Cross-site writes
    const xsite = await a.req("POST", "/api/interviews/iv_1700000000000", {}, { origin: "https://evil.example" });
    check("cross-site POST is blocked", xsite.status === 403, xsite.status);

    // Saved interviews
    const iv = {
      savedAt: Date.now(),
      question: { title: "Design a cache", type: "system_design" },
      transcript: [{ id: "1", role: "user", text: "hi", timestamp: "10:00" }],
      diagramText: "",
      code: "",
      codeLanguage: "Python",
      durationSeconds: 600,
      scorecard: { totalScore: 77, overallVerdict: "Hire" },
    };
    const id = "iv_1700000000001";
    const put = await a.req("PUT", `/api/interviews/${id}`, { ...iv, timing: { mode: "practice" } });
    check("save interview", put.status === 200 && put.json.summary?.score === 77, put.json);
    check("bad interview id is rejected", (await a.req("PUT", "/api/interviews/..%2F..", iv)).status === 400);
    const list = await a.req("GET", "/api/interviews");
    check("list shows the interview", list.json.interviews?.length === 1 && list.json.interviews[0].title === "Design a cache", list.json);
    const full = (await a.req("GET", `/api/interviews/${id}`)).json.interview;
    check("get returns the full record", full?.transcript?.length === 1);
    check("the saved record keeps its timing", full?.timing?.mode === "practice", full?.timing);
    check("another user cannot read it", (await b.req("GET", `/api/interviews/${id}`)).status === 404);
    check("another user's list is empty", (await b.req("GET", "/api/interviews")).json.interviews?.length === 0);
    check("another user cannot delete it", ((await b.req("DELETE", `/api/interviews/${id}`)), (await a.req("GET", `/api/interviews/${id}`)).status === 200));

    // In-progress interviews (pause / rejoin / refresh)
    const lsId = "ls_1700000000001";
    const ls = {
      status: "active",
      question: { id: "tinyurl", title: "Design TinyURL", type: "system_design" },
      timing: { mode: "normal" },
      voice: "Sulafat",
      phase: "design",
      phaseLabel: "Design",
      elapsedSeconds: 125,
      transcript: [{ id: "1", role: "user", text: "hello", timestamp: "10:00" }],
      code: "print(1)",
      codeLanguage: "Python",
      diagramText: "A->B",
      scene: [{ id: "e1", type: "rectangle" }],
    };
    check("unauthenticated live-session list is refused", (await new Client().req("GET", "/api/live-sessions")).status === 401);
    check("save live session", (await a.req("PUT", `/api/live-sessions/${lsId}`, ls)).status === 200);
    check("bad live session id is rejected", (await a.req("PUT", "/api/live-sessions/..%2Fx", ls)).status === 400);
    check("invalid live session body is rejected", (await a.req("PUT", `/api/live-sessions/ls_1700000000002`, { question: {} })).status === 400);
    const lsList = (await a.req("GET", "/api/live-sessions")).json.sessions;
    check("live session list shows it", lsList?.length === 1 && lsList[0].status === "active" && lsList[0].elapsedSeconds === 125 && lsList[0].turns === 1, lsList);
    const lsFull = (await a.req("GET", `/api/live-sessions/${lsId}`)).json;
    check("live session restores code, diagram, scene and phase", lsFull.code === "print(1)" && lsFull.diagramText === "A->B" && lsFull.scene?.length === 1 && lsFull.phase === "design", lsFull);
    await a.req("POST", `/api/live-sessions/${lsId}`, { ...ls, status: "paused", elapsedSeconds: 200 });
    const lsPaused = (await a.req("GET", `/api/live-sessions/${lsId}`)).json;
    check("a later save (beacon POST) pauses it and keeps one record", lsPaused.status === "paused" && lsPaused.elapsedSeconds === 200 && (await a.req("GET", "/api/live-sessions")).json.sessions.length === 1, lsPaused);
    check("another user cannot read a live session", (await b.req("GET", `/api/live-sessions/${lsId}`)).status === 404);
    check("another user's live list is empty", (await b.req("GET", "/api/live-sessions")).json.sessions?.length === 0);
    await b.req("DELETE", `/api/live-sessions/${lsId}`);
    check("another user cannot delete it", (await a.req("GET", `/api/live-sessions/${lsId}`)).status === 200);
    for (let i = 2; i <= 5; i++) await a.req("PUT", `/api/live-sessions/ls_170000000000${i}`, ls);
    check("sixth in-progress interview is refused", (await a.req("PUT", `/api/live-sessions/ls_1700000000009`, ls)).status === 409);
    for (let i = 1; i <= 5; i++) await a.req("DELETE", `/api/live-sessions/ls_170000000000${i}`);
    check("discard removes it", (await a.req("GET", "/api/live-sessions")).json.sessions?.length === 0);

    // WebSocket auth
    const un = await openWs("");
    await sleep(100);
    un.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(800);
    check("unauthenticated WebSocket is refused", un.msgs.some((m) => m.code === "unauthorized"), un.msgs);
    const cross = await openWs(a.cookie, "https://evil.example");
    cross.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(800);
    check("cross-site WebSocket is refused", cross.msgs.some((m) => m.code === "unauthorized"), cross.msgs);

    // Live interview cap
    const w1 = await openWs(a.cookie);
    w1.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: "bad" }));
    await sleep(500);
    check("starting without a valid key says no_key", w1.msgs.some((m) => m.code === "no_key"), w1.msgs);
    w1.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(2500);
    check("first live interview starts", w1.msgs.some((m) => m.type === "status" && m.status === "connected"), w1.msgs);

    const w2 = await openWs(a.cookie);
    w2.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(1500);
    check("a second live interview for the same user is refused", w2.msgs.some((m) => m.code === "live_limit"), w2.msgs);

    const w3 = await openWs(b.cookie);
    w3.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(2500);
    check("a different user can run one at the same time", w3.msgs.some((m) => m.type === "status" && m.status === "connected"), w3.msgs);

    w1.ws.close();
    await sleep(1200);
    w2.ws.send(JSON.stringify({ type: "start", questionId: "tinyurl", apiKey: FAKE_KEY }));
    await sleep(2500);
    check("after the first ends, the lease is free again", w2.msgs.some((m) => m.type === "status" && m.status === "connected"), w2.msgs);
    w2.ws.close();
    w3.ws.close();

    // Logout
    await a.req("POST", "/api/auth/logout");
    check("logout ends the session", (await a.req("GET", "/api/auth/me")).status === 401);
    await sleep(200);
  } finally {
    server.kill("SIGINT");
    await sleep(2000);
    server.kill("SIGKILL");
    mocks.forEach((m) => m.close());
  }
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  if (failed) console.log("\n--- server log ---\n" + log.slice(-3000));
  process.exit(failed ? 1 : 0);
}
main();
