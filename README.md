# Bar Raiser

Practice system design, low-level design, LeetCode-style and behavioral interviews against an AI interviewer you talk to out loud.

- Type any question. Gemini writes the problem and a hidden grading rubric. You see the rubric with your scorecard when the interview ends.
- Behavioral mode takes your resume (paste, PDF or text file) and the leadership principles or business info you want to be assessed on, then asks questions tied to your own experience.
- Voice interview over the Gemini Live API (hands-free or push-to-talk) with a whiteboard (Excalidraw), a code editor and the problem statement. The interviewer sees your diagram and your code.
- Every interview is saved to your account. Review it later or export the transcript, rubric, grading, code and whiteboard image as one Markdown file.

## How it works for users

- Sign up with an email and password. Interviews are stored per account in MongoDB.
- Bring your own API keys. Keys are stored only in the browser, sent with each request, and never stored or logged on the server.
  - The live voice interview always runs on Gemini, so a Gemini key is required (free from https://aistudio.google.com/apikey).
  - Question writing, rubrics, resume planning and grading can run on Gemini, OpenAI or Anthropic. Choose under Models and keys; optionally name a model (defaults: `gpt-4.1` for OpenAI, `claude-opus-5-5` for Anthropic).
  - Advanced: give each job its own provider and model, for example Gemini for writing questions and Claude for grading. Each provider you use needs its own key, and a missing key only affects the jobs that use it.
  - You can also pick which Gemini live model runs the spoken interview. The others are tried automatically if it is unavailable.
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

## Deploy on Railway (alternative)

1. Push this repo to GitHub and create a Railway project from it. `railway.json` sets the build, start command and the `/healthz` health check.
2. Add a MongoDB database to the project (Railway's MongoDB template, or a free MongoDB Atlas M0 cluster).
3. On the web service, set the variable `MONGODB_URI` to the connection string. Railway provides `PORT` itself.
4. Generate a public domain for the service. HTTPS is required (session cookies are `Secure` in production).

That is all the configuration there is. No Gemini key is set on the server.

## Deploy on Google Cloud Run (free tier)

Cloud Run runs the Docker image, supports WebSockets, and scales to zero, so you pay nothing while nobody is using it. Pair it with a free MongoDB Atlas M0 cluster (512 MB).

1. **Database.** Create a free M0 cluster at https://www.mongodb.com/cloud/atlas. Pick the Google Cloud provider and the `us-central1` region to match the service. Create a database user with a strong password, and under Network Access allow `0.0.0.0/0` (Cloud Run has no fixed outgoing address on the free setup, so the password is the protection). Copy the `mongodb+srv://...` connection string.
2. **Google Cloud.** Create a project with billing enabled (the free allowance still needs a card on file), then install the CLI and sign in:
   ```bash
   gcloud auth login
   ```
3. **Deploy.** From the repo root:
   ```bash
   MONGODB_URI='mongodb+srv://USER:PASSWORD@cluster.mongodb.net/' PROJECT_ID=your-project-id ./scripts/deploy-cloudrun.sh
   ```
   The script enables the needed services, stores the connection string in Secret Manager (not in the image or plain environment variables), builds the image with Cloud Build, and deploys it. It prints the HTTPS URL when done. Re-run the same command to deploy updates; `MONGODB_URI` is only needed the first time.

What the script sets, and why:
- `--timeout 3600`: a live interview is one long WebSocket request. The default of 5 minutes would cut interviews off.
- `--max-instances 3`: caps cost and keeps the per-instance rate limits meaningful.
- `--min-instances 0`: no cost while idle. The first visit after a quiet period takes a few seconds longer.
- `--region us-central1`: one of the regions covered by the Cloud Run free tier.

No Gemini key is set on the server: each user adds their own in the app.

## Token efficiency

The live voice model re-reads the whole conversation on every turn, so most of the cost comes from what accumulates in that conversation.

- Hands-free mode sends audio only while someone is speaking (with a short pre-roll and a 2 second tail so turn-taking still works), instead of streaming silence.
- Whiteboard and code snapshots are skipped when unchanged and sent at most once every 12 seconds per kind (the newest always goes out).
- Very long interviews use the Live API's sliding-window context compression, with thresholds high enough that a normal 30 minute interview is not trimmed.
- The interviewer's standing instructions carry only what it needs to steer (rubric category names, must-cover topics and red flags, not the full rubric).
- Grading sends a compact transcript (no timestamps), leaves out empty whiteboard and code sections, and asks for concise, evidence-based feedback.
- Generated rubrics and interview plans are capped (2 to 3 signals per category, short notes).

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
