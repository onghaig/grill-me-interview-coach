/* Starts the server on a spare port with a temporary in-memory MongoDB and checks auth, isolation, limits and the live lease. */
import { spawn } from "child_process";
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

async function main() {
  const server = spawn("npx", ["tsx", "server.ts"], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI: "", NODE_ENV: "development" },
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
    const put = await a.req("PUT", `/api/interviews/${id}`, iv);
    check("save interview", put.status === 200 && put.json.summary?.score === 77, put.json);
    check("bad interview id is rejected", (await a.req("PUT", "/api/interviews/..%2F..", iv)).status === 400);
    const list = await a.req("GET", "/api/interviews");
    check("list shows the interview", list.json.interviews?.length === 1 && list.json.interviews[0].title === "Design a cache", list.json);
    check("get returns the full record", (await a.req("GET", `/api/interviews/${id}`)).json.interview?.transcript?.length === 1);
    check("another user cannot read it", (await b.req("GET", `/api/interviews/${id}`)).status === 404);
    check("another user's list is empty", (await b.req("GET", "/api/interviews")).json.interviews?.length === 0);
    check("another user cannot delete it", ((await b.req("DELETE", `/api/interviews/${id}`)), (await a.req("GET", `/api/interviews/${id}`)).status === 200));

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
  }
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  if (failed) console.log("\n--- server log ---\n" + log.slice(-3000));
  process.exit(failed ? 1 : 0);
}
main();
