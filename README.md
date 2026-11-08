# Bar Raiser

Practice system design, low-level design, LeetCode-style and behavioral interviews against an AI interviewer you talk to out loud.

- Type any question. Gemini writes the problem and a hidden grading rubric. You see the rubric with your scorecard when the interview ends.
- Behavioral mode takes your resume (paste, PDF or text file) and the leadership principles or business info you want to be assessed on, then asks questions tied to your own experience.
- Voice interview over the Gemini Live API (hands-free or push-to-talk) with a whiteboard (Excalidraw), a code editor and the problem statement. The interviewer sees your diagram and your code.
- Every interview is saved to your account. Review it later or export the transcript, rubric, grading, code and whiteboard image as one Markdown file.

## How it works for users

- Sign up with an email and password. Interviews are stored per account in MongoDB.
- Bring your own Gemini API key (free from https://aistudio.google.com/apikey). It is stored only in the browser, sent with each request, and never stored or logged on the server.
- One live interview at a time per account. Starting a second one (another tab or device) is refused until the first ends.
- Limits: resume text 15,000 characters, resume PDF 3 MB, text file 200 KB, principles 6,000 characters.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `MONGODB_URI` set, the dev server starts a temporary in-memory MongoDB, so there is nothing else to install. Data is lost when it stops. To keep data, point `MONGODB_URI` at a local or Atlas database (see `.env.example`).

```bash
npm test                  # unit tests
npm run test:integration  # starts the server and checks auth, isolation, limits and the live-interview cap
npm run lint              # typecheck
```

## Deploy on Railway

1. Push this repo to GitHub and create a Railway project from it. `railway.json` sets the build, start command and the `/healthz` health check.
2. Add a MongoDB database to the project (Railway's MongoDB template, or a free MongoDB Atlas M0 cluster).
3. On the web service, set the variable `MONGODB_URI` to the connection string. Railway provides `PORT` itself.
4. Generate a public domain for the service. HTTPS is required (session cookies are `Secure` in production).

That is all the configuration there is. No Gemini key is set on the server.

## Scaling notes

- The app servers are stateless apart from live interview WebSockets. Accounts, sessions, interviews and the one-live-interview lease are all in MongoDB, so you can run several instances.
- Rate limits (auth attempts, generation requests per user) are in memory per instance. With several instances, move them to Redis.
- Each live interview holds one WebSocket and one Gemini Live session on its instance. Size instances by concurrent live interviews.

## Layout

- `server.ts` Express API, Gemini calls, WebSocket bridge for live interviews
- `server/` database, accounts and sessions, saved interviews, rate limiting
- `prompts/interviewer.ts` question types, built-in questions, interviewer persona
- `src/` React client
- `scripts/integration-test.ts` end-to-end server checks
