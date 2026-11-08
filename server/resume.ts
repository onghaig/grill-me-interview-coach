import { Timing, timeLimitSeconds } from "../prompts/timing.ts";

export interface ResumeContext {
  transcript: { role: string; text: string }[];
  code: string;
  codeLanguage: string;
  diagramText: string;
  elapsedSeconds: number;
  timing: Timing;
  /** Minutes since the interview was last saved. */
  minutesAway: number;
}

export interface LiveTurn {
  role: "user" | "model";
  parts: { text: string }[];
}

const MAX_TURNS = 40;
const MAX_CHARS = 1200;

/** What to tell the interviewer when someone comes back. */
export function resumeInstruction(ctx: ResumeContext, unanswered: boolean): string {
  const limit = timeLimitSeconds(ctx.timing);
  const timeLine =
    limit === null
      ? "There is no time limit."
      : limit - ctx.elapsedSeconds <= 0
      ? "The time is up, so wrap up politely."
      : `About ${Math.max(1, Math.round((limit - ctx.elapsedSeconds) / 60))} minutes remain.`;
  const away = ctx.minutesAway >= 2 ? ` after about ${Math.min(ctx.minutesAway, 600)} minutes away` : "";
  return (
    `[RESUME] The candidate is rejoining${away}. ${timeLine} ` +
    `In one short sentence welcome them back, then pick up exactly where you left off${unanswered ? " and respond to what they said last" : ""}. ` +
    "Do not repeat your opening, do not re-explain the problem, and do not mention a transcript or that you were given any notes. Keep it to two or three sentences."
  );
}

/**
 * Rebuilds the conversation for a new live session as plain text turns: recent transcript, the latest code and
 * whiteboard, and a final instruction to welcome the candidate back. Text is far cheaper than replaying audio.
 * Roles alternate and start with the user, which is what the live API expects.
 */
export function buildResumeTurns(ctx: ResumeContext): { turns: LiveTurn[]; unanswered: boolean } {
  const turns: LiveTurn[] = [];
  const add = (role: "user" | "model", text: string) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts[0].text += ` ${text}`;
    else turns.push({ role, parts: [{ text }] });
  };

  for (const t of ctx.transcript.slice(-MAX_TURNS)) {
    const text = String(t.text || "").trim().slice(0, MAX_CHARS);
    if (text) add(t.role === "user" ? "user" : "model", text);
  }
  if (turns.length && turns[0].role === "model") turns.unshift({ role: "user", parts: [{ text: "The interview is under way." }] });

  const unanswered = turns.length > 0 && turns[turns.length - 1].role === "user";
  const snapshot = [
    ctx.code.trim() ? `[CODE UPDATE] (${ctx.codeLanguage})\n${ctx.code.slice(0, 12_000)}` : "",
    ctx.diagramText.trim() ? `[DIAGRAM UPDATE]\n${ctx.diagramText.slice(0, 8000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const closing = [snapshot, resumeInstruction(ctx, unanswered)].filter(Boolean).join("\n\n");

  // If the candidate spoke last, their words stay in the same turn as the instruction
  add("user", closing);
  return { turns, unanswered };
}
