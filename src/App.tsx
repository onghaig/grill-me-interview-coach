import { useState, useRef, useEffect, useCallback } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { InterviewPanel } from './components/InterviewPanel';
import { ScorecardModal } from './components/ScorecardModal';
import { HomeScreen, StartOptions } from './components/HomeScreen';
import { CodeEditor } from './components/CodeEditor';
import { ProblemStatement } from './components/ProblemStatement';
import { ReviewScreen } from './components/ReviewScreen';
import { downloadMarkdown, copyMarkdown } from './utils/exportMarkdown';
import { SavedInterview, loadHistory, saveInterview, deleteInterview } from './utils/history';
import { AudioRecorder, AudioPlayer } from './utils/audio';
import { InterviewPhase, TranscriptEntry, ScorecardData, getPhases } from './types';
import { SystemDesignQuestion, SYSTEM_DESIGN_QUESTIONS } from '../prompts/interviewer';

export default function App() {
  const [currentQuestion, setCurrentQuestion] = useState<SystemDesignQuestion>(SYSTEM_DESIGN_QUESTIONS[0]);
  const [currentPhase, setCurrentPhase] = useState<InterviewPhase>('clarify');
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [view, setView] = useState<'home' | 'interview' | 'review'>('home');
  const [history, setHistory] = useState<SavedInterview[]>(() => loadHistory());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const savedIdRef = useRef<string | null>(null);
  const [voice, setVoice] = useState('Sulafat');
  const [workspaceTab, setWorkspaceTab] = useState<'problem' | 'whiteboard' | 'code'>('whiteboard');
  const [code, setCode] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('Python');
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [hasMicrophone, setHasMicrophone] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState(30 * 60);

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<{
    role: 'user' | 'interviewer';
    text: string;
  } | null>(null);

  const [latestDiagramText, setLatestDiagramText] = useState<string>('');
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [showScorecard, setShowScorecard] = useState(false);
  const [interviewDurationSeconds, setInterviewDurationSeconds] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interviewStartTimeRef = useRef<number>(0);

  // Keep ref of isPushToTalk and isSpacePressed for audio processor callback
  const isPushToTalkRef = useRef(isPushToTalk);
  isPushToTalkRef.current = isPushToTalk;
  // True from key/button press until a short tail after release, so the end of a sentence isn't clipped
  const pttSendingRef = useRef(false);
  const pttReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInterviewActiveRef = useRef(false);
  isInterviewActiveRef.current = isInterviewActive;
  // Transcript entry currently being streamed into, so chunks merge into one message per turn
  const openEntryRef = useRef<{ role: 'user' | 'interviewer'; id: string } | null>(null);
  const openTextRef = useRef('');
  const sessionModeRef = useRef<string>('live_socket');

  // Initialize audio player
  useEffect(() => {
    audioPlayerRef.current = new AudioPlayer((playing) => {
      setIsInterviewerSpeaking(playing);
    });

    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop();
      }
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stop();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const pttPress = useCallback(() => {
    if (!isPushToTalkRef.current || !isInterviewActiveRef.current) return;
    if (pttReleaseTimerRef.current) {
      clearTimeout(pttReleaseTimerRef.current);
      pttReleaseTimerRef.current = null;
      // Re-pressed during the release tail: keep the same open turn
      setIsSpacePressed(true);
      return;
    }
    if (pttSendingRef.current) return;
    pttSendingRef.current = true;
    setIsSpacePressed(true);
    // Barge-in: stop the interviewer locally, the server's activityStart interrupts the model
    audioPlayerRef.current?.stop();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ptt_start' }));
    }
  }, []);

  const pttRelease = useCallback(() => {
    if (!pttSendingRef.current || pttReleaseTimerRef.current) return;
    setIsSpacePressed(false);
    pttReleaseTimerRef.current = setTimeout(() => {
      pttReleaseTimerRef.current = null;
      pttSendingRef.current = false;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ptt_end' }));
      }
    }, 350);
  }, []);

  // Keyboard Space listener for Push-to-Talk
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      return (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        !!target?.isContentEditable
      );
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !isPushToTalkRef.current || !isInterviewActiveRef.current) return;
      if (isTyping(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) pttPress();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !isPushToTalkRef.current) return;
      if (isTyping(e)) return;
      e.preventDefault();
      e.stopPropagation();
      pttRelease();
    };
    // Capture phase so the whiteboard can't swallow Space (it uses it for panning)
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    const handleBlur = () => pttRelease();
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [pttPress, pttRelease]);

  // Timer countdown
  useEffect(() => {
    if (isInterviewActive) {
      interviewStartTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isInterviewActive]);

  // Diagram update handler from Excalidraw (debounced 3s by WhiteboardCanvas)
  const handleDiagramUpdate = useCallback(
    (compactText: string) => {
      setLatestDiagramText(compactText);

      // If interview is active and WebSocket is open, send [DIAGRAM UPDATE]
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && compactText) {
        wsRef.current.send(
          JSON.stringify({
            type: 'diagram',
            text: compactText,
          })
        );
      }
    },
    []
  );

  const sendCode = (text: string, language: string) => {
    if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
    codeDebounceRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && text.trim()) {
        wsRef.current.send(JSON.stringify({ type: 'code', text, language }));
      }
    }, 2500);
  };

  const handleCodeChange = (text: string) => {
    setCode(text);
    sendCode(text, codeLanguage);
  };

  const handleLanguageChange = (language: string) => {
    setCodeLanguage(language);
    sendCode(code, language);
  };

  const nowStamp = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Merge streamed transcription chunks into a single message per turn
  const appendStreamed = (role: 'user' | 'interviewer', chunk: string) => {
    const open = openEntryRef.current;
    if (open && open.role === role) {
      openTextRef.current += chunk;
      setTranscripts((prev) => prev.map((t) => (t.id === open.id ? { ...t, text: t.text + chunk } : t)));
      return;
    }
    const text = chunk.replace(/^\s+/, '');
    if (!text) return;
    const id = `${role}_${Date.now()}_${Math.random()}`;
    openEntryRef.current = { role, id };
    openTextRef.current = text;
    setTranscripts((prev) => [...prev, { id, role, text, timestamp: nowStamp() }]);
  };

  const closeStreamedEntry = () => {
    openEntryRef.current = null;
  };

  const handleStartInterview = () => startSession(currentQuestion, { pushToTalk: isPushToTalk, voice });

  const handleHomeStart = (question: SystemDesignQuestion, options: StartOptions) => {
    setCurrentQuestion(question);
    setIsPushToTalk(options.pushToTalk);
    isPushToTalkRef.current = options.pushToTalk;
    setVoice(options.voice);
    setTranscripts([]);
    setLatestDiagramText('');
    setCode('');
    setWorkspaceTab(question.type === 'coding' ? 'code' : 'whiteboard');
    setScorecard(null);
    setCurrentPhase('clarify');
    setRemainingSeconds(30 * 60);
    openEntryRef.current = null;
    setView('interview');
    startSession(question, options);
  };

  // Start interview session
  const startSession = async (question: SystemDesignQuestion, options: StartOptions) => {
    if (isInterviewActive || isConnecting) return;
    setIsConnecting(true);
    // Unlock audio output inside the click gesture
    audioPlayerRef.current?.unlock();
    openEntryRef.current = null;
    pttSendingRef.current = false;

    try {
      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send start command
        ws.send(
          JSON.stringify({
            type: 'start',
            questionId: question.id,
            customQuestion: question,
            voice: options.voice,
            pushToTalk: options.pushToTalk,
            kickoff: true,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'status' && msg.status === 'connected') {
            sessionModeRef.current = msg.mode || 'live_socket';
            setIsConnecting(false);
            setIsInterviewActive(true);
          } else if (msg.type === 'audio') {
            // Model 24kHz audio
            if (audioPlayerRef.current) {
              audioPlayerRef.current.playChunk(msg.data);
            }
          } else if (msg.type === 'interrupted') {
            // User interrupted model speech
            if (audioPlayerRef.current) {
              audioPlayerRef.current.stop();
            }
            setIsInterviewerSpeaking(false);
            closeStreamedEntry();
          } else if (msg.type === 'input_transcript') {
            appendStreamed('user', msg.text);
          } else if (msg.type === 'output_transcript') {
            appendStreamed('interviewer', msg.text);
          } else if (msg.type === 'turn_complete') {
            // Only the text-only fallback engine needs browser speech; live mode streams real audio
            if (sessionModeRef.current === 'conversational_engine' && openEntryRef.current?.role === 'interviewer') {
              audioPlayerRef.current?.speakText(openTextRef.current, true);
            }
            closeStreamedEntry();
          } else if (msg.type === 'error') {
            console.error('Server session notice:', msg.error);
          } else if (msg.type === 'status' && msg.status === 'closed') {
            setIsInterviewActive(false);
            setIsConnecting(false);
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection error:', err);
        setIsConnecting(false);
        setIsInterviewActive(false);
      };

      ws.onclose = () => {
        audioRecorderRef.current?.stop();
        audioRecorderRef.current = null;
        setIsInterviewActive(false);
        setIsConnecting(false);
      };

      // Start Microphone Recording (non-blocking)
      const recorder = new AudioRecorder(
        (base64Pcm) => {
          // Send audio if Push-To-Talk is disabled OR if Space is currently pressed
          if (
            wsRef.current &&
            wsRef.current.readyState === WebSocket.OPEN &&
            (!options.pushToTalk || pttSendingRef.current)
          ) {
            wsRef.current.send(
              JSON.stringify({
                type: 'audio',
                data: base64Pcm,
              })
            );
          }
        },
        (volume) => {
          setMicVolume(volume);
        }
      );

      const micStarted = await recorder.start();
      setHasMicrophone(micStarted);
      audioRecorderRef.current = recorder;
    } catch (err: any) {
      console.error('Failed to start interview:', err);
      setIsConnecting(false);
      setIsInterviewActive(false);
    }
  };

  // Send private coach guidance
  const handleSendCoachGuidance = (coachText: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && coachText.trim()) {
      wsRef.current.send(
        JSON.stringify({
          type: 'coach',
          text: coachText.trim(),
        })
      );
    }
  };

  // Send candidate speech or text turn
  const handleSendCandidateText = (text: string) => {
    if (!text.trim()) return;
    const userText = text.trim();
    closeStreamedEntry();
    setTranscripts((prev) => [
      ...prev,
      {
        id: 'user_' + Date.now() + Math.random(),
        role: 'user',
        text: userText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_text',
          text: userText,
        })
      );
    }
  };

  const handlePhaseChange = (phase: InterviewPhase) => {
    setCurrentPhase(phase);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'phase_advance',
          phase: phase,
          label: getPhases(currentQuestion.type).find((p) => p.id === phase)?.label,
        })
      );
    }
  };

  const requestGrade = async (payload: {
    question: SystemDesignQuestion;
    transcript: TranscriptEntry[];
    diagramText: string;
    codeText: string;
    durationSeconds: number;
  }): Promise<ScorecardData> => {
    const response = await fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Grading request failed with status ${response.status}`);
    }
    return response.json();
  };

  // The record to export for the interview that just ended (latest saved copy, which includes the scorecard)
  const currentRecord = (): SavedInterview => {
    const saved = savedIdRef.current ? loadHistory().find((e) => e.id === savedIdRef.current) : undefined;
    return (
      saved ?? {
        id: 'unsaved',
        savedAt: Date.now(),
        question: currentQuestion,
        transcript: transcripts,
        diagramText: latestDiagramText,
        code,
        codeLanguage,
        durationSeconds: interviewDurationSeconds,
        scorecard,
      }
    );
  };

  const codeTextFor = (c: string, lang: string) => (c ? `Language: ${lang}\n${c}` : '');

  const handleRegrade = async (id: string) => {
    const entry = loadHistory().find((e) => e.id === id);
    if (!entry) throw new Error('This interview is no longer saved.');
    const scorecard = await requestGrade({
      question: entry.question,
      transcript: entry.transcript,
      diagramText: entry.diagramText,
      codeText: codeTextFor(entry.code, entry.codeLanguage),
      durationSeconds: entry.durationSeconds,
    });
    setHistory(saveInterview({ ...entry, scorecard }));
  };

  // End interview session & trigger grading
  const handleEndInterview = async () => {
    const elapsed = Math.round(30 * 60 - remainingSeconds);
    setInterviewDurationSeconds(elapsed);

    // Save right away so nothing is lost if grading fails
    const savedId = `iv_${Date.now()}`;
    savedIdRef.current = null;
    if (transcripts.length > 0) {
      savedIdRef.current = savedId;
      setHistory(
        saveInterview({
          id: savedId,
          savedAt: Date.now(),
          question: currentQuestion,
          transcript: transcripts,
          diagramText: latestDiagramText,
          code,
          codeLanguage,
          durationSeconds: elapsed,
          scorecard: null,
        })
      );
    }

    // Stop recorder & audio
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    pttSendingRef.current = false;
    if (pttReleaseTimerRef.current) {
      clearTimeout(pttReleaseTimerRef.current);
      pttReleaseTimerRef.current = null;
    }
    setIsSpacePressed(false);
    closeStreamedEntry();
    setIsInterviewActive(false);
    setIsInterviewerSpeaking(false);
    setShowScorecard(true);
    setGradingError(null);
    setIsGrading(true);

    // Call grading endpoint
    try {
      const scorecardData = await requestGrade({
        question: currentQuestion,
        transcript: transcripts,
        diagramText: latestDiagramText,
        codeText: codeTextFor(code, codeLanguage),
        durationSeconds: elapsed,
      });
      if (savedIdRef.current) {
        const saved = loadHistory().find((e) => e.id === savedIdRef.current);
        if (saved) setHistory(saveInterview({ ...saved, scorecard: scorecardData }));
      }
      setScorecard(scorecardData);
    } catch (err) {
      console.error('Failed to grade interview:', err);
      setScorecard(null);
      setGradingError(err instanceof Error ? err.message : 'Grading failed.');
    } finally {
      setIsGrading(false);
    }
  };

  if (view === 'review') {
    const entry = history.find((e) => e.id === reviewId);
    if (entry) {
      return (
        <ReviewScreen
          key={entry.id + (entry.scorecard ? '-g' : '-u')}
          interview={entry}
          onBack={() => setView('home')}
          onDelete={() => {
            setHistory(deleteInterview(entry.id));
            setView('home');
          }}
          onRegrade={() => handleRegrade(entry.id)}
        />
      );
    }
  }

  if (view === 'home' || view === 'review') {
    return (
      <HomeScreen
        onStart={handleHomeStart}
        history={history}
        onOpenInterview={(id) => {
          setReviewId(id);
          setView('review');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Left 65%: Whiteboard / Code workspace */}
      <div className="w-[65%] h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 bg-slate-900 border-b border-slate-800">
          {(['problem', 'whiteboard', 'code'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setWorkspaceTab(tab)}
              className={`px-4 py-2 text-xs font-medium -mb-px border-b-2 transition ${
                workspaceTab === tab
                  ? 'border-indigo-400 text-slate-50'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'problem' ? 'Problem' : tab === 'whiteboard' ? 'Whiteboard' : 'Code'}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative">
          {/* Both stay mounted so neither loses its state when switching tabs */}
          <div className={`absolute inset-0 ${workspaceTab === 'whiteboard' ? '' : 'invisible pointer-events-none'}`}>
            <WhiteboardCanvas
              onDiagramUpdate={handleDiagramUpdate}
              latestSerializedText={latestDiagramText}
            />
          </div>
          <div className={`absolute inset-0 ${workspaceTab === 'problem' ? '' : 'invisible pointer-events-none'}`}>
            <ProblemStatement question={currentQuestion} />
          </div>
          <div className={`absolute inset-0 ${workspaceTab === 'code' ? '' : 'invisible pointer-events-none'}`}>
            <CodeEditor
              code={code}
              language={codeLanguage}
              onChange={handleCodeChange}
              onLanguageChange={handleLanguageChange}
            />
          </div>
        </div>
      </div>

      {/* Right 35%: Interview Panel */}
      <div className="w-[35%] h-full relative border-l border-slate-800">
        <InterviewPanel
          currentQuestion={currentQuestion}
          onSelectQuestion={(q) => {
            setCurrentQuestion(q);
            setRemainingSeconds(30 * 60);
          }}
          currentPhase={currentPhase}
          onSelectPhase={handlePhaseChange}
          isInterviewActive={isInterviewActive}
          onStartInterview={handleStartInterview}
          onEndInterview={handleEndInterview}
          isConnecting={isConnecting}
          transcripts={transcripts}
          interimTranscript={null}
          isInterviewerSpeaking={isInterviewerSpeaking}
          isPushToTalk={isPushToTalk}
          onTogglePushToTalk={setIsPushToTalk}
          isSpacePressed={isSpacePressed}
          micVolume={micVolume}
          hasMicrophone={hasMicrophone}
          remainingSeconds={remainingSeconds}
          latestDiagramText={latestDiagramText}
          onSendCoachGuidance={handleSendCoachGuidance}
          onSendCandidateText={handleSendCandidateText}
          getAudioLevel={() => audioPlayerRef.current?.getLevel() ?? 0}
          onPttPress={pttPress}
          onPttRelease={pttRelease}
          onGoHome={() => {
            setShowScorecard(false);
            setView('home');
          }}
        />
      </div>

      {/* Post-Interview Scorecard Modal */}
      {showScorecard && (
        <ScorecardModal
          scorecard={scorecard}
          isLoading={isGrading}
          error={gradingError}
          onClose={() => setShowScorecard(false)}
          questionTitle={currentQuestion.title}
          durationSeconds={interviewDurationSeconds}
          transcriptCount={transcripts.length}
          onDownloadMarkdown={() => downloadMarkdown(currentRecord())}
          onCopyMarkdown={() => copyMarkdown(currentRecord())}
        />
      )}
    </div>
  );
}
