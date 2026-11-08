import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Play, Send, Square } from 'lucide-react';
import { InterviewerFace } from './InterviewerFace';
import { TranscriptEntry } from '../types';
import { SystemDesignQuestion } from '../../prompts/interviewer';
import { Timing } from '../../prompts/timing';

interface BehavioralInterviewProps {
  question: SystemDesignQuestion;
  isInterviewActive: boolean;
  isConnecting: boolean;
  transcripts: TranscriptEntry[];
  isInterviewerSpeaking: boolean;
  isPushToTalk: boolean;
  isSpacePressed: boolean;
  micVolume: number;
  hasMicrophone: boolean;
  /** Null in practice mode, which has no time limit. */
  remainingSeconds: number | null;
  elapsedSeconds: number;
  timing: Timing;
  onStart: () => void;
  onEnd: () => void;
  onSendText: (text: string) => void;
  onPttPress: () => void;
  onPttRelease: () => void;
  getAudioLevel: () => number;
  onGoHome: () => void;
}

const formatTimer = (total: number) => {
  const t = Math.max(0, total);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Behavioral mode: no whiteboard or code, just the interviewer full screen with the conversation under its face. */
export function BehavioralInterview({
  question,
  isInterviewActive,
  isConnecting,
  transcripts,
  isInterviewerSpeaking,
  isPushToTalk,
  isSpacePressed,
  micVolume,
  hasMicrophone,
  remainingSeconds,
  elapsedSeconds,
  onStart,
  onEnd,
  onSendText,
  onPttPress,
  onPttRelease,
  getAudioLevel,
  onGoHome,
}: BehavioralInterviewProps) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const candidateTalking = isPushToTalk ? isSpacePressed : micVolume > 15;
  const listening = isInterviewActive && !isInterviewerSpeaking && candidateTalking;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcripts]);

  const status = !isInterviewActive
    ? isConnecting
      ? 'Joining the call...'
      : 'Ready when you are'
    : isInterviewerSpeaking
    ? 'Speaking'
    : candidateTalking
    ? 'Listening'
    : isPushToTalk
    ? 'Hold Space to answer'
    : 'Your turn';

  const send = () => {
    if (!text.trim()) return;
    onSendText(text);
    setText('');
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800/80">
        <div className="min-w-0 flex items-center gap-4">
          {!isInterviewActive && !isConnecting && (
            <button onClick={onGoHome} className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
              &larr; Home
            </button>
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Bar Raiser · Behavioral</div>
            <div className="text-sm font-medium truncate">{question.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span
            className={`font-mono text-sm tabular-nums ${remainingSeconds !== null && remainingSeconds < 300 ? 'text-rose-400' : 'text-slate-300'}`}
            aria-label={remainingSeconds === null ? 'Time elapsed' : 'Time remaining'}
          >
            {formatTimer(remainingSeconds === null ? elapsedSeconds : remainingSeconds)}
            {remainingSeconds === null && <span className="ml-2 text-[10px] text-slate-500 uppercase">practice</span>}
          </span>
          {isInterviewActive && (
            <button
              onClick={onEnd}
              className="px-3.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5 fill-white" /> End and grade
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col items-center">
        <div className="shrink-0 w-full flex flex-col items-center pt-4">
          <div className="h-[40vh] min-h-[200px] max-h-[420px] aspect-[100/110]">
            <InterviewerFace getLevel={getAudioLevel} speaking={isInterviewerSpeaking} listening={listening} />
          </div>
          <div className="mt-2 text-sm text-slate-400 h-5" aria-live="polite">
            {status}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 w-full overflow-y-auto mt-3">
          <div className="max-w-2xl mx-auto px-6 pb-6 space-y-4 select-text">
            {transcripts.length === 0 && (
              <p className="text-center text-sm text-slate-500 pt-6">
                {isInterviewActive || isConnecting
                  ? 'The conversation will appear here.'
                  : 'Press start to join. Your interviewer will greet you and ask the first question.'}
              </p>
            )}
            {transcripts.map((t) => {
              const mine = t.role === 'user';
              return (
                <div key={t.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] font-mono text-slate-500 mb-1">
                    {mine ? 'You' : 'Interviewer'} · {t.timestamp}
                  </span>
                  <div
                    className={`max-w-[88%] rounded-lg px-4 py-2.5 text-[15px] leading-relaxed ${
                      mine
                        ? 'bg-indigo-950/60 border border-indigo-800/50 text-indigo-50'
                        : 'bg-slate-900 border border-slate-800 text-slate-200'
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950 px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {!isInterviewActive ? (
            <button
              onClick={onStart}
              disabled={isConnecting}
              className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-white" />
              {isConnecting ? 'Starting...' : transcripts.length ? 'Reconnect' : 'Start interview'}
            </button>
          ) : (
            <>
              {isPushToTalk ? (
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    onPttPress();
                  }}
                  onPointerUp={onPttRelease}
                  onPointerCancel={onPttRelease}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`w-full py-3 rounded-lg border text-sm font-medium touch-none select-none ${
                    isSpacePressed
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200'
                      : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {isSpacePressed ? 'Listening... release when you are done' : 'Hold Space (or this button) to answer'}
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2.5 py-2.5 rounded-lg border border-slate-800 bg-slate-900/60 text-sm text-slate-300">
                  {hasMicrophone ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4 text-rose-400" />}
                  <span>{hasMicrophone ? 'Hands-free: just answer out loud' : 'No microphone found. Type your answers below.'}</span>
                  {hasMicrophone && (
                    <span className="flex items-end gap-0.5 h-3.5" aria-hidden>
                      {[0.4, 0.8, 0.55, 1, 0.6].map((f, i) => (
                        <span
                          key={i}
                          className="w-1 rounded-full bg-emerald-400/80"
                          style={{ height: `${Math.max(15, Math.min(100, micVolume * f * 1.6))}%` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  id="answer-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') send();
                  }}
                  placeholder="Or type an answer"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500"
                />
                <button
                  onClick={send}
                  disabled={!text.trim()}
                  className="px-3 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  aria-label="Send answer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
