/**
 * Decides which microphone chunks are worth sending in hands-free mode.
 *
 * - Silence is not sent (the live model bills for audio and re-reads it on later turns).
 * - While the interviewer is speaking, its own voice leaks from the speakers into the mic. The model hears that
 *   as the candidate talking and stops mid-sentence. So during its speech the gate learns how loud that echo is
 *   and only opens for something clearly louder, such as a real attempt to talk over it.
 */
export interface MicGateOptions {
  /** Level (0-100) that counts as speech when nothing else is going on. */
  quietThreshold: number;
  /** Minimum level that counts as speech while the interviewer is talking. */
  speakingFloor: number;
  /** While the interviewer talks, speech must exceed echo level times this, plus the margin below. */
  echoMultiplier: number;
  echoMargin: number;
  prerollMs: number;
  hangoverMs: number;
  /** When the interviewer starts talking, wait this long (measuring the echo) before trusting any input. */
  learnMs: number;
  /** While the interviewer talks, keep the gate open only this long after the last loud chunk. */
  speakingHangoverMs: number;
}

export const DEFAULT_GATE: MicGateOptions = {
  quietThreshold: 4,
  speakingFloor: 20,
  echoMultiplier: 2,
  echoMargin: 8,
  prerollMs: 450,
  hangoverMs: 2000,
  learnMs: 500,
  speakingHangoverMs: 250,
};

export class MicGate<T> {
  private opts: MicGateOptions;
  private lastLoudAt = -Infinity;
  private streaming = false;
  private echoLevel = 0;
  private wasSpeaking = false;
  private speakingSince = 0;
  private preroll: { at: number; chunk: T }[] = [];

  constructor(opts: Partial<MicGateOptions> = {}) {
    this.opts = { ...DEFAULT_GATE, ...opts };
  }

  /** The level a chunk must reach to count as speech right now. */
  threshold(interviewerSpeaking: boolean): number {
    const o = this.opts;
    return interviewerSpeaking ? Math.max(o.speakingFloor, this.echoLevel * o.echoMultiplier + o.echoMargin) : o.quietThreshold;
  }

  /**
   * Feed one chunk. Returns the chunks to send now (including any pre-roll that is released when speech starts)
   * and whether the stream just went quiet, so the caller can tell the server to flush.
   */
  push(chunk: T, volume: number, now: number, interviewerSpeaking: boolean): { send: T[]; ended: boolean } {
    if (interviewerSpeaking && !this.wasSpeaking) this.speakingSince = now;
    this.wasSpeaking = interviewerSpeaking;
    const learning = interviewerSpeaking && now - this.speakingSince < this.opts.learnMs;

    // Learn the echo level only while the gate is closed, so the candidate's own speech does not raise it.
    // Learn quickly at the start of the interviewer's speech and trust nothing until it is measured.
    if (!this.streaming) {
      if (interviewerSpeaking) this.echoLevel += (volume - this.echoLevel) * (learning ? 0.4 : 0.05);
      else this.echoLevel *= 0.9;
    }
    if (!learning && volume >= this.threshold(interviewerSpeaking)) this.lastLoudAt = now;

    // The tail after the candidate's speech is long, but not while the interviewer is replying: it would
    // carry the start of the reply's echo straight back to the model.
    const hangover = interviewerSpeaking ? this.opts.speakingHangoverMs : this.opts.hangoverMs;
    if (now - this.lastLoudAt < hangover) {
      const send: T[] = [];
      if (!this.streaming) {
        this.streaming = true;
        for (const p of this.preroll) send.push(p.chunk);
        this.preroll = [];
      }
      send.push(chunk);
      return { send, ended: false };
    }

    const ended = this.streaming;
    this.streaming = false;
    this.preroll.push({ at: now, chunk });
    while (this.preroll.length && now - this.preroll[0].at > this.opts.prerollMs) this.preroll.shift();
    return { send: [], ended };
  }
}
