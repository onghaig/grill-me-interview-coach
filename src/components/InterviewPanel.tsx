import { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Play,
  Square,
  Clock,
  Volume2,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Info,
  Layers,
  Copy,
  Check,
  Radio,
  SlidersHorizontal,
  Send,
} from 'lucide-react';
import { InterviewPhase, getPhases, TranscriptEntry } from '../types';
import { SystemDesignQuestion, SYSTEM_DESIGN_QUESTIONS } from '../../prompts/interviewer';

interface InterviewPanelProps {
  currentQuestion: SystemDesignQuestion;
  onSelectQuestion: (question: SystemDesignQuestion) => void;
  currentPhase: InterviewPhase;
  onSelectPhase: (phase: InterviewPhase) => void;
  isInterviewActive: boolean;
  onStartInterview: () => void;
  onEndInterview: () => void;
  isConnecting: boolean;
  transcripts: TranscriptEntry[];
  interimTranscript: { role: 'user' | 'interviewer'; text: string } | null;
  isInterviewerSpeaking: boolean;
  isPushToTalk: boolean;
  onTogglePushToTalk: (enabled: boolean) => void;
  isSpacePressed: boolean;
  micVolume: number;
  hasMicrophone: boolean;
  remainingSeconds: number;
  latestDiagramText: string;
  onSendCoachGuidance: (guidance: string) => void;
  onSendCandidateText: (text: string) => void;
  onPttPress: () => void;
  onPttRelease: () => void;
  onGoHome: () => void;
}

export function InterviewPanel({
  currentQuestion,
  onSelectQuestion,
  currentPhase,
  onSelectPhase,
  isInterviewActive,
  onStartInterview,
  onEndInterview,
  isConnecting,
  transcripts,
  interimTranscript,
  isInterviewerSpeaking,
  isPushToTalk,
  onTogglePushToTalk,
  isSpacePressed,
  micVolume,
  hasMicrophone,
  remainingSeconds,
  latestDiagramText,
  onSendCoachGuidance,
  onSendCandidateText,
  onPttPress,
  onPttRelease,
  onGoHome,
}: InterviewPanelProps) {
  const [showQuestionSelector, setShowQuestionSelector] = useState(false);
  const [showQuestionDetails, setShowQuestionDetails] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [showCoachDrawer, setShowCoachDrawer] = useState(false);
  const [coachInput, setCoachInput] = useState('');
  const [coachFeedback, setCoachFeedback] = useState<string | null>(null);
  const [candidateInput, setCandidateInput] = useState('');
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const handleSendCoach = (textToSend: string) => {
    if (!textToSend.trim()) return;
    onSendCoachGuidance(textToSend.trim());
    setCoachInput('');
    setCoachFeedback('Whisper guidance sent to interviewer');
    setTimeout(() => setCoachFeedback(null), 3000);
  };

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcripts, interimTranscript]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(Math.max(0, totalSeconds) / 60);
    const secs = Math.max(0, totalSeconds) % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyTranscript = () => {
    const text = transcripts.map((t) => `[${t.role.toUpperCase()} - ${t.timestamp}]: ${t.text}`).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const INTERVIEW_PHASES = getPhases(currentQuestion.type);
  const activePhaseIndex = INTERVIEW_PHASES.findIndex((p) => p.id === currentPhase);

  const handleNextPhase = () => {
    if (activePhaseIndex < INTERVIEW_PHASES.length - 1) {
      onSelectPhase(INTERVIEW_PHASES[activePhaseIndex + 1].id);
    }
  };

  // Determine current mic status text and color
  let micStatusText = 'Offline';
  let micStatusColor = 'text-slate-500 border-slate-700 bg-slate-800/40';

  if (isConnecting) {
    micStatusText = 'Connecting Live Session...';
    micStatusColor = 'text-amber-400 border-amber-500/40 bg-amber-950/20';
  } else if (isInterviewActive) {
    if (isInterviewerSpeaking) {
      micStatusText = 'Interviewer Speaking...';
      micStatusColor = 'text-indigo-400 border-indigo-500/40 bg-indigo-950/20';
    } else if (isPushToTalk) {
      if (isSpacePressed) {
        micStatusText = 'Transmitting Voice (Space Held)...';
        micStatusColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-950/30';
      } else {
        micStatusText = 'Muted — Hold [SPACE] to Talk';
        micStatusColor = 'text-slate-400 border-slate-700 bg-slate-800/50';
      }
    } else {
      micStatusText = micVolume > 15 ? 'Candidate Speaking...' : 'Listening (VAD Active)...';
      micStatusColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20';
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Header: Question Title & Selector */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {!isInterviewActive && !isConnecting && (
                <button
                  onClick={onGoHome}
                  className="text-[10px] font-bold font-mono tracking-wider text-slate-400 hover:text-indigo-300 uppercase"
                  title="Back to home"
                >
                  &larr; Home
                </button>
              )}
              <span className="text-[10px] font-bold font-mono tracking-wider text-indigo-400 uppercase">
                Technical Interview
              </span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                  currentQuestion.difficulty === 'Medium'
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-950/30'
                    : currentQuestion.difficulty === 'Hard'
                    ? 'border-amber-500/40 text-amber-400 bg-amber-950/30'
                    : 'border-rose-500/40 text-rose-400 bg-rose-950/30'
                }`}
              >
                {currentQuestion.difficulty}
              </span>
            </div>

            {/* Clickable Question Title that opens selector */}
            <button
              onClick={() => setShowQuestionSelector(!showQuestionSelector)}
              className="w-full text-left font-bold text-slate-100 text-sm hover:text-indigo-300 transition flex items-center justify-between group"
            >
              <span className="truncate">{currentQuestion.title}</span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 group-hover:text-indigo-300 transition-transform ${
                  showQuestionSelector ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          <button
            onClick={() => setShowQuestionDetails(!showQuestionDetails)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
            title="Toggle Question Brief & Scale"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Expandable Question Selector Dropdown */}
        {showQuestionSelector && (
          <div className="mt-3 p-2 bg-slate-900 border border-slate-800 rounded-xl shadow-xl shadow-black/40 space-y-1 animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="text-[10px] font-mono text-slate-500 uppercase px-2 py-1 block">
              Select Question
            </span>
            {SYSTEM_DESIGN_QUESTIONS.map((q) => (
              <button
                key={q.id}
                onClick={() => {
                  onSelectQuestion(q);
                  setShowQuestionSelector(false);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                  q.id === currentQuestion.id
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                    : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div className="truncate mr-2">
                  <span className="block truncate font-semibold">{q.title}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{q.scale}</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{q.difficulty}</span>
              </button>
            ))}
          </div>
        )}

        {/* Expandable Question Details Accordion */}
        {showQuestionDetails && (
          <div className="mt-3 p-3 bg-slate-900/90 border border-slate-800 rounded-xl text-xs space-y-2 text-slate-300 animate-in fade-in duration-150">
            <div>
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block mb-0.5">
                Scale & Traffic Constraints:
              </span>
              <p className="font-mono text-slate-200">{currentQuestion.scale}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block mb-0.5">
                Overview:
              </span>
              <p className="text-slate-300 leading-relaxed">{currentQuestion.description}</p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block mb-1">
                Suggested Scope:
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400 text-[11px]">
                {currentQuestion.suggestedRequirements.functional.slice(0, 3).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Phase Indicator & Countdown Timer Bar */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Clock
              className={`w-3.5 h-3.5 ${
                remainingSeconds < 300
                  ? 'text-rose-400'
                  : remainingSeconds < 600
                  ? 'text-amber-400'
                  : 'text-indigo-400'
              }`}
            />
            <span
              className={`font-mono font-bold text-sm tracking-wider ${
                remainingSeconds < 300
                  ? 'text-rose-400'
                  : remainingSeconds < 600
                  ? 'text-amber-400'
                  : 'text-slate-100'
              }`}
            >
              {formatTimer(remainingSeconds)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono uppercase">remaining</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-indigo-300">
              Phase {activePhaseIndex + 1}/{INTERVIEW_PHASES.length}:{' '}
              <span className="text-slate-200">{INTERVIEW_PHASES[activePhaseIndex].label}</span>
            </span>
            <button
              onClick={handleNextPhase}
              disabled={activePhaseIndex >= INTERVIEW_PHASES.length - 1}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 text-slate-300 transition"
              title="Advance to next phase"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 5-Step Phase Stepper */}
        <div className="grid grid-cols-5 gap-1">
          {INTERVIEW_PHASES.map((phase, idx) => {
            const isActive = phase.id === currentPhase;
            const isCompleted = idx < activePhaseIndex;
            return (
              <button
                key={phase.id}
                onClick={() => onSelectPhase(phase.id)}
                className={`flex flex-col items-center py-1.5 px-1 rounded-md text-[10px] font-medium transition text-center ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : isCompleted
                    ? 'bg-slate-800/80 text-emerald-400 hover:bg-slate-800'
                    : 'bg-slate-900 text-slate-500 hover:bg-slate-800/50'
                }`}
                title={phase.description}
              >
                <span className="font-bold truncate w-full">{phase.label}</span>
                <span className="text-[8px] opacity-75 font-mono">{phase.durationMinutes}m</span>
              </button>
            );
          })}
        </div>

        {/* Candidate Turn Input Bar */}
        {isInterviewActive && (
          <div className="p-2.5 bg-slate-900/90 border-t border-slate-800 flex flex-col gap-1.5">
            {!hasMicrophone && (
              <div className="text-[10px] text-amber-400/90 flex items-center gap-1 font-medium">
                <span>Voice Output is active (Interviewer will speak aloud). Type your answers or hold Space:</span>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!candidateInput.trim()) return;
                onSendCandidateText(candidateInput);
                setCandidateInput('');
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={candidateInput}
                onChange={(e) => setCandidateInput(e.target.value)}
                placeholder="Speak into mic, hold Space, or type answer..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="submit"
                disabled={!candidateInput.trim()}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Main Action Bar: Start / End & Push-to-Talk Toggle */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          {!isInterviewActive ? (
            <button
              onClick={onStartInterview}
              disabled={isConnecting}
              className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isConnecting ? 'Starting Session...' : 'Start Interview'}</span>
            </button>
          ) : (
            <button
              onClick={onEndInterview}
              className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
            >
              <Square className="w-4 h-4 fill-white" />
              <span>End Interview & Grade</span>
            </button>
          )}

          {/* Push-to-talk toggle switch */}
          <button
            onClick={() => onTogglePushToTalk(!isPushToTalk)}
            disabled={isInterviewActive || isConnecting}
            className={`disabled:opacity-60 disabled:cursor-not-allowed py-2 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
              isPushToTalk
                ? 'border-indigo-500/50 bg-indigo-950/40 text-indigo-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
            title={
              isInterviewActive
                ? 'Talk mode is fixed during an interview'
                : isPushToTalk
                ? 'Push-to-Talk Mode enabled (Hold Space to speak)'
                : 'Automatic Voice Activity Detection enabled'
            }
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isPushToTalk ? 'PTT (Space)' : 'Auto VAD'}</span>
          </button>
        </div>

        {/* Mic Status & Visualizer Banner */}
        <div
          className={`p-2 rounded-xl border flex items-center justify-between text-xs transition-colors ${micStatusColor}`}
        >
          <div className="flex items-center gap-2">
            {isPushToTalk && !isSpacePressed ? (
              <MicOff className="w-4 h-4 text-slate-500" />
            ) : isInterviewerSpeaking ? (
              <Volume2 className="w-4 h-4 text-indigo-400" />
            ) : (
              <Mic
                className={`w-4 h-4 ${
                  isInterviewActive ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
            )}
            <span className="font-medium text-[11px] truncate">{micStatusText}</span>
          </div>

          {/* Volume wave bars */}
          {isInterviewActive && (
            <div className="flex items-center gap-0.5 h-3">
              {[0.2, 0.5, 0.8, 0.4, 0.9, 0.3].map((factor, i) => {
                const heightPercent = isInterviewerSpeaking
                  ? Math.sin(Date.now() / 150 + i) * 30 + 50
                  : Math.min(100, (micVolume * factor * 1.5) + 15);
                return (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isInterviewerSpeaking ? 'bg-indigo-400' : 'bg-emerald-400'
                    }`}
                    style={{ height: `${Math.max(4, heightPercent)}%` }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Push-to-talk hold button (mouse, touch or Space) */}
        {isInterviewActive && isPushToTalk && (
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              onPttPress();
            }}
            onPointerUp={onPttRelease}
            onPointerCancel={onPttRelease}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-full py-2.5 px-3 rounded-lg text-center font-mono text-[11px] transition-all border touch-none ${
              isSpacePressed
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            {isSpacePressed ? 'Listening... release when done' : 'Hold SPACE (or this button) to talk'}
          </button>
        )}
      </div>

      {/* Live Transcript Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/30 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="font-semibold text-slate-300">Live Transcript</span>
            <span className="text-[10px] text-slate-500 font-mono">({transcripts.length} turns)</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Toggle Evaluator Coach Drawer */}
            <button
              onClick={() => setShowCoachDrawer(!showCoachDrawer)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition ${
                showCoachDrawer
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="Send private evaluator guidance to interviewer via [COACH]"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Coach Whisper</span>
            </button>

            {transcripts.length > 0 && (
              <button
                onClick={handleCopyTranscript}
                className="p-1 hover:text-slate-200 text-slate-400 rounded transition"
                title="Copy full transcript"
              >
                {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* Expandable Coach Guidance Drawer */}
        {showCoachDrawer && (
          <div className="p-3 bg-amber-950/20 border-b border-amber-900/40 text-xs animate-in slide-in-from-top-1 duration-150 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Evaluator Private Guidance [COACH]
              </span>
              <span className="text-[10px] text-amber-500/80 font-mono">Hidden from candidate</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-tight">
              The interviewer follows these private instructions at the next natural moment without revealing the coach.
            </p>

            {/* Quick Prompt Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                'Push back on hand-waving: ask for numbers and trade-offs',
                'Probe on database partition key & hot spots',
                'Candidate seems stuck: ask a guiding question',
                'Ask about failure modes & failover',
                'Probe on single point of failure (SPOF)',
              ].map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendCoach(preset)}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-300 border border-slate-700/80 transition text-left"
                >
                  + {preset}
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCoach(coachInput);
              }}
              className="flex items-center gap-1.5 pt-1"
            >
              <input
                type="text"
                value={coachInput}
                onChange={(e) => setCoachInput(e.target.value)}
                placeholder="Custom evaluator guidance (e.g. 'Ask about 301 vs 302')..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={!coachInput.trim()}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold text-xs rounded transition"
              >
                Send [COACH]
              </button>
            </form>

            {/* Confirmation feedback */}
            {coachFeedback && (
              <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                {coachFeedback}
              </div>
            )}
          </div>
        )}

        <div
          ref={transcriptScrollRef}
          className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs select-text"
        >
          {transcripts.length === 0 && !interimTranscript ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <Sparkles className="w-8 h-8 text-indigo-500/30 mb-2" />
              <p className="font-medium text-slate-400">Ready for Interview</p>
              <p className="text-[11px] max-w-xs mt-1">
                Click <span className="text-emerald-400 font-semibold">Start Interview</span> to begin. The AI will speak via Gemini Live and monitor your Excalidraw whiteboard.
              </p>
            </div>
          ) : (
            <>
              {transcripts.map((entry) => {
                const isUser = entry.role === 'user';
                return (
                  <div
                    key={entry.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400 font-mono">
                      <span className="font-bold text-slate-300">
                        {isUser ? 'Candidate' : 'Interviewer (Principal Architect)'}
                      </span>
                      <span>•</span>
                      <span>{entry.timestamp}</span>
                    </div>

                    <div
                      className={`p-3 rounded-xl max-w-[92%] leading-relaxed ${
                        isUser
                          ? 'bg-indigo-600/25 border border-indigo-500/40 text-indigo-50 rounded-tr-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                      }`}
                    >
                      {entry.text}
                    </div>
                  </div>
                );
              })}

              {/* Streaming Interim Transcript */}
              {interimTranscript && (
                <div
                  className={`flex flex-col ${
                    interimTranscript.role === 'user' ? 'items-end' : 'items-start'
                  } opacity-90`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-indigo-400 font-mono">
                    <span className="font-bold">
                      {interimTranscript.role === 'user' ? 'Candidate (Transcribing...)' : 'Interviewer (Speaking...)'}
                    </span>
                  </div>
                  <div
                    className={`p-3 rounded-xl max-w-[92%] leading-relaxed italic ${
                      interimTranscript.role === 'user'
                        ? 'bg-indigo-600/15 border border-indigo-500/30 text-indigo-200 rounded-tr-none'
                        : 'bg-slate-900/80 border border-slate-800 text-slate-300 rounded-tl-none'
                    }`}
                  >
                    {interimTranscript.text}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom Footer: Diagram Sync Indicator */}
      <div className="p-2.5 px-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span className="truncate">
            Diagram Context: {latestDiagramText ? 'Active (shapes detected)' : 'No elements drawn'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">Live 16kHz PCM</span>
      </div>
    </div>
  );
}
