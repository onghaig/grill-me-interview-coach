/**
 * Interview timing, shared by the server (what the interviewer is told) and the app (the timer and phase labels).
 * Timed interviews have a countdown and the interviewer keeps to the clock. Practice mode has neither.
 */
export type Timing = { mode: 'timed'; minutes: 30 | 45 } | { mode: 'practice' };

export const DEFAULT_TIMING: Timing = { mode: 'timed', minutes: 30 };

export const TIMING_OPTIONS: { id: string; label: string; detail: string; timing: Timing }[] = [
  { id: 'timed-30', label: 'Normal interview', detail: '30 minutes, with a timer', timing: { mode: 'timed', minutes: 30 } },
  { id: 'timed-45', label: 'Extended interview', detail: '45 minutes, with a timer', timing: { mode: 'timed', minutes: 45 } },
  { id: 'practice', label: 'Practice mode', detail: 'No timer, no pressure', timing: { mode: 'practice' } },
];

export const timingId = (t: Timing): string => (t.mode === 'practice' ? 'practice' : `timed-${t.minutes}`);

/** Accepts anything (stored settings, a WebSocket message) and returns a valid Timing. */
export function normalizeTiming(raw: unknown): Timing {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { mode?: unknown; minutes?: unknown };
  if (o.mode === 'practice') return { mode: 'practice' };
  if (o.mode === 'timed' && (o.minutes === 30 || o.minutes === 45)) return { mode: 'timed', minutes: o.minutes };
  return DEFAULT_TIMING;
}

/** Seconds on the clock, or null when there is no time limit. */
export const timeLimitSeconds = (t: Timing): number | null => (t.mode === 'practice' ? null : t.minutes * 60);

/** The base phase lengths add up to 30 minutes; scale them for longer interviews. Null in practice mode. */
export function scaledPhaseMinutes(baseMinutes: number, t: Timing): number | null {
  if (t.mode === 'practice') return null;
  return Math.round(((baseMinutes * t.minutes) / 30) * 2) / 2;
}

const WORDS: Record<number, string> = { 30: 'thirty', 45: 'forty-five' };

/** A phrase the interviewer can use when describing the format out loud. */
export function timingPhrase(t: Timing): string {
  return t.mode === 'practice' ? 'no time limit, so they can take as long as they need' : `about ${WORDS[t.minutes]} minutes`;
}

/** Short description for the grader. */
export function gradingTimingNote(t: Timing): string {
  return t.mode === 'practice'
    ? 'This was an untimed practice session. Do not judge pacing or time management.'
    : `This was a timed ${t.minutes} minute interview.`;
}

/** Silent timer messages the app sends to the interviewer in timed mode. */
export function timerMessage(remainingSeconds: number): string | null {
  if (remainingSeconds <= 0) return '[TIMER UPDATE]: Time is up. Close the interview politely and thank the candidate.';
  if (remainingSeconds <= 60) return '[TIMER UPDATE]: Less than a minute remains. Wrap up now.';
  if (remainingSeconds <= 300) return '[TIMER UPDATE]: About five minutes remain. Move toward wrapping up at the next natural moment.';
  return null;
}
