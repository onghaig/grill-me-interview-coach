# Software Engineering Technical Interview Coach

Practice system design, low-level design and LeetCode-style interviews against an AI interviewer you talk to out loud.

- Type any question. Gemini decides what kind it is, writes the problem and a weighted grading rubric, and you review it before starting.
- Voice interview over the Gemini Live API (hands-free or push-to-talk), with a whiteboard (Excalidraw), a syntax-highlighted code editor and the problem statement side by side. The interviewer sees both your diagram and your code.
- At the end you get a scorecard graded against the rubric that was generated for your question.

## Run locally

Requires Node 20+ and a Gemini API key.

```bash
npm install
echo 'GEMINI_API_KEY="your-key"' > .env
npm run dev        # http://localhost:3000
```

## Production

```bash
npm run build      # builds the client into dist/
npm start          # serves dist/ and the API/WebSocket on $PORT (default 3000)
```

Set `GEMINI_API_KEY` as an environment variable on the host. The key stays on the server and is never sent to the browser.
`/api/rubric` and `/api/grade` are rate limited to 20 requests per minute per IP.

## Layout

- `server.ts` Express API (`/api/rubric`, `/api/grade`), Gemini Live WebSocket bridge (`/ws/live`)
- `prompts/interviewer.ts` question types, built-in questions, interviewer persona
- `src/` React client (home screen, interview panel, whiteboard, code editor, scorecard)
