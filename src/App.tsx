import { useState, useRef, useEffect, useCallback } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { InterviewPanel } from './components/InterviewPanel';
import { ScorecardModal } from './components/ScorecardModal';
import { HomeScreen, StartOptions } from './components/HomeScreen';
import { CodeEditor } from './components/CodeEditor';
import { ProblemStatement } from './components/ProblemStatement';
import { ReviewScreen } from './components/ReviewScreen';
import { BehavioralInterview } from './components/BehavioralInterview';
import { downloadMarkdown, copyMarkdown } from './utils/exportMarkdown';
import { SavedInterview, InterviewSummary, fetchHistory, fetchInterview, saveInterview, deleteInterview } from './utils/history';
import { api, getApiKey, isConfigured, llmForSocket, voiceModelForSocket } from './utils/api';
import { AuthScreen, AccountUser } from './components/AuthScreen';
import { KeySetup } from './components/KeySetup';
import { AudioRecorder, AudioPlayer } from './utils/audio';
import { MicGate, gateOptionsForSensitivity } from './utils/micGate';
import { InterviewPhase, TranscriptEntry, ScorecardData, getPhases } from './types';
import { SystemDesignQuestion, SYSTEM_DESIGN_QUESTIONS } from '../prompts/interviewer';
import { Timing, DEFAULT_TIMING, timeLimitSeconds, normalizeTiming } from '../prompts/timing';
import {
  LiveSessionSummary,
  LiveSessionPayload,
  fetchLiveSessions,
  fetchLiveSession,
  saveLiveSession,
  deleteLiveSession,
  beaconLiveSession,
} from './utils/liveSessions';

export default function App() {
  const [currentQuestion, setCurrentQuestion] = useState<SystemDesignQuestion>(SYSTEM_DESIGN_QUESTIONS[0]);
  const [currentPhase, setCurrentPhase] = useState<InterviewPhase>('clarify');
  const [isInterviewActive, setIsInterviewActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  // A ref as well, so a delayed retry sees the current value instead of a stale one
  const connectingRef = useRef(false);
  const setConnecting = (v: boolean) => {
    connectingRef.current = v;
    setIsConnecting(v);
  };
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [view, setView] = useState<'home' | 'interview' | 'review'>('home');
  const [auth, setAuth] = useState<'loading' | 'anon' | 'authed'>('loading');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [hasKey, setHasKey] = useState(() => isConfigured());
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [history, setHistory] = useState<InterviewSummary[]>([]);
  const [reviewRecord, setReviewRecord] = useState<SavedInterview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recordRef = useRef<SavedInterview | null>(null);
  // Interviews that were paused or interrupted, and the one this page is currently running
  const [liveSessions, setLiveSessions] = useState<LiveSessionSummary[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const sceneRef = useRef<any[]>([]);
  const [initialScene, setInitialScene] = useState<any[] | undefined>(undefined);
  const lastSavedRef = useRef('');
  const autoLoadedRef = useRef(false);
  const audioThisTurnRef = useRef(false);
  const pausedRef = useRef(false);
  const stateRef = useRef<any>({});
  const captureWhiteboardRef = useRef<(() => Promise<string | null>) | null>(null);
  const whiteboardImageRef = useRef<string | undefined>(undefined);
  const [voice, setVoice] = useState('Sulafat');
  // A text chat has no voice connection (cheaper). Read-aloud uses the browser's own voice for the interviewer's replies.
  const [voiceAgent, setVoiceAgent] = useState(true);
  const voiceAgentRef = useRef(true);
  voiceAgentRef.current = voiceAgent;
  const [readAloud, setReadAloud] = useState(false);
  const readAloudRef = useRef(false);
  readAloudRef.current = readAloud;
  const [micSensitivity, setMicSensitivity] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('br-mic-sensitivity'));
      return localStorage.getItem('br-mic-sensitivity') !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
    } catch {
      return 50;
    }
  });
  const gateRef = useRef<MicGate<string> | null>(null);
  useEffect(() => {
    gateRef.current?.setOptions(gateOptionsForSensitivity(micSensitivity));
    try {
      localStorage.setItem('br-mic-sensitivity', String(micSensitivity));
    } catch {
      /* the setting just will not be remembered */
    }
  }, [micSensitivity]);
  const [workspaceTab, setWorkspaceTab] = useState<'problem' | 'whiteboard' | 'code'>('whiteboard');
  const [code, setCode] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('Python');
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  const [hasMicrophone, setHasMicrophone] = useState(true);
  const [timing, setTiming] = useState<Timing>(DEFAULT_TIMING);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Practice mode has no limit, so there is nothing remaining
  const timeLimit = timeLimitSeconds(timing);
  const remainingSeconds: number | null = timeLimit === null ? null : Math.max(0, timeLimit - elapsedSeconds);
  const timeChecksSentRef = useRef<Set<number>>(new Set());

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
  const lastMicVolumeRef = useRef(0);
  const sessionModeRef = useRef<string>('live_socket');

  stateRef.current = { currentQuestion, timing, voice, currentPhase, elapsedSeconds, transcripts, code, codeLanguage, latestDiagramText };

  const showNotice = (msg: string) => setNotice(msg);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);

  // Who is signed in? Also react to the server saying the session has expired.
  useEffect(() => {
    api<{ user: AccountUser }>('/api/auth/me')
      .then(({ user }) => {
        setUser(user);
        setAuth('authed');
      })
      .catch(() => setAuth('anon'));
    const expired = () => {
      setUser(null);
      setAuth('anon');
    };
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, []);

  useEffect(() => {
    if (auth !== 'authed') return;
    fetchHistory()
      .then(setHistory)
      .catch(() => {});
    fetchLiveSessions()
      .then((list) => {
        setLiveSessions(list);
        // A refresh or closed tab leaves an interview marked active. Put the user back in it, ready to rejoin.
        const cutOff = list.find((x) => x.status === 'active' && Date.now() - x.updatedAt < 30 * 60 * 1000);
        if (cutOff && !autoLoadedRef.current) {
          autoLoadedRef.current = true;
          loadSession(cutOff.id, false);
        }
        autoLoadedRef.current = true;
      })
      .catch(() => {});
  }, [auth]);

  // Keep the home screen's list current whenever the user lands there
  useEffect(() => {
    if (view === 'home' && auth === 'authed') refreshLiveSessions();
  }, [view, auth]);

  const refreshLiveSessions = () =>
    fetchLiveSessions()
      .then(setLiveSessions)
      .catch(() => {});

  const buildPayload = (status: 'active' | 'paused'): LiveSessionPayload => {
    const st = stateRef.current;
    return {
      status,
      question: st.currentQuestion,
      timing: st.timing,
      voice: st.voice,
      phase: st.currentPhase,
      phaseLabel: getPhases(st.currentQuestion.type).find((p) => p.id === st.currentPhase)?.label ?? '',
      elapsedSeconds: st.elapsedSeconds,
      transcript: st.transcripts,
      code: st.code,
      codeLanguage: st.codeLanguage,
      diagramText: st.latestDiagramText,
      scene: sceneRef.current,
    };
  };

  /** Save the running interview to the server. Quiet while autosaving; says so if a deliberate save fails. */
  const saveSessionNow = async (status: 'active' | 'paused') => {
    const id = sessionIdRef.current;
    if (!id) return;
    const payload = buildPayload(status);
    const json = JSON.stringify(payload);
    if (status === 'active' && (json === lastSavedRef.current || pausedRef.current)) return;
    try {
      await saveLiveSession(id, payload);
      lastSavedRef.current = json;
    } catch (err: any) {
      if (status !== 'active') showNotice(`Could not save your progress: ${err?.message || 'unknown error'}`);
    }
  };

  /** Put a saved interview back exactly as it was. With startNow it also rejoins the call. */
  const loadSession = async (id: string, startNow: boolean) => {
    try {
      const d = await fetchLiveSession(id);
      const savedTiming = normalizeTiming(d.timing);
      const savedVoice = d.voice || voice;
      sessionIdRef.current = d.id;
      lastSavedRef.current = '';
      pausedRef.current = false;
      openEntryRef.current = null;
      setCurrentQuestion(d.question);
      setTiming(savedTiming);
      setVoice(savedVoice);
      setTranscripts(d.transcript);
      setCode(d.code);
      setCodeLanguage(d.codeLanguage);
      setLatestDiagramText(d.diagramText);
      sceneRef.current = d.scene ?? [];
      setInitialScene(d.scene && d.scene.length ? d.scene : undefined);
      setCurrentPhase(d.phase as InterviewPhase);
      setElapsedSeconds(d.elapsedSeconds);
      setScorecard(null);
      setWorkspaceTab(d.question.type === 'coding' ? 'code' : 'whiteboard');
      setView('interview');
      if (startNow) {
        startSession(d.question, { pushToTalk: isPushToTalk, voice: savedVoice, timing: savedTiming, voiceAgent: voiceAgentRef.current }, {
          hasProgress: d.transcript.length > 0,
          fromServer: true,
          elapsed: d.elapsedSeconds,
        });
      }
    } catch (err: any) {
      showNotice(`Could not reopen that interview: ${err?.message || 'unknown error'}`);
      refreshLiveSessions();
    }
  };

  /** Stop the call, save everything, and go home. The interview waits under "In progress". */
  const handlePause = async () => {
    pausedRef.current = true;
    audioRecorderRef.current?.stop();
    audioRecorderRef.current = null;
    audioPlayerRef.current?.stop();
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'stop' }));
      wsRef.current.close();
      wsRef.current = null;
    }
    pttSendingRef.current = false;
    closeStreamedEntry();
    setIsInterviewActive(false);
    setIsInterviewerSpeaking(false);
    await saveSessionNow('paused');
    sessionIdRef.current = null;
    await refreshLiveSessions();
    setView('home');
  };

  /** Leaving an interview that is not running: keep it if anything happened, otherwise drop the empty shell. */
  const leaveToHome = async () => {
    setShowScorecard(false);
    const id = sessionIdRef.current;
    if (id) {
      const st = stateRef.current;
      const hasProgress = st.transcripts.length > 0 || !!st.code.trim() || sceneRef.current.length > 0;
      if (hasProgress) await saveSessionNow('paused');
      else await deleteLiveSession(id).catch(() => {});
      sessionIdRef.current = null;
    }
    setView('home');
  };

  const discardSession = async (id: string) => {
    await deleteLiveSession(id).catch((err) => showNotice(`Could not discard that interview: ${err?.message || 'unknown error'}`));
    refreshLiveSessions();
  };

  // Autosave while the interview is live, so a refresh or a closed tab loses almost nothing
  useEffect(() => {
    if (view !== 'interview' || !isInterviewActive) return;
    saveSessionNow('active');
    const timer = setInterval(() => saveSessionNow('active'), 5000);
    return () => clearInterval(timer);
  }, [view, isInterviewActive]);

  // One last best-effort save as the page closes or is hidden
  useEffect(() => {
    const flush = () => {
      const id = sessionIdRef.current;
      if (id && isInterviewActiveRef.current) beaconLiveSession(id, buildPayload('active'));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const persist = (record: SavedInterview) =>
    saveInterview(record)
      .then((summary) => setHistory((prev) => [summary, ...prev.filter((x) => x.id !== summary.id)]))
      .catch((err) => showNotice(`Could not save this interview to your account: ${err?.message || 'unknown error'}. You can still export it.`));

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setHistory([]);
    setReviewRecord(null);
    recordRef.current = null;
    sessionIdRef.current = null;
    setLiveSessions([]);
    autoLoadedRef.current = false;
    setAuth('anon');
  };

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
      timerIntervalRef.current = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
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

  // In a timed interview, quietly tell the interviewer when time is getting short (practice mode never does)
  useEffect(() => {
    if (!isInterviewActive || remainingSeconds === null) return;
    for (const t of [300, 60, 0]) {
      if (remainingSeconds <= t && !timeChecksSentRef.current.has(t)) {
        timeChecksSentRef.current.add(t);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'time_check', remainingSeconds: t }));
        }
      }
    }
  }, [remainingSeconds, isInterviewActive]);

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

  // Safety net: instruction tags such as [COACH] or [DIAGRAM UPDATE] must never appear in the chat
  const stripTags = (t: string) => t.replace(/\[(?:COACH|DIAGRAM UPDATE|CODE UPDATE|PHASE[^\]]*|START OF INTERVIEW)[^\]]*\]:?/gi, '');

  // Merge streamed transcription chunks into a single message per turn
  const appendStreamed = (role: 'user' | 'interviewer', chunk: string) => {
    const open = openEntryRef.current;
    if (open && open.role === role) {
      openTextRef.current += chunk;
      setTranscripts((prev) => prev.map((t) => (t.id === open.id ? { ...t, text: stripTags(t.text + chunk) } : t)));
      return;
    }
    const text = stripTags(chunk).replace(/^\s+/, '');
    if (!text) return;
    const id = `${role}_${Date.now()}_${Math.random()}`;
    openEntryRef.current = { role, id };
    openTextRef.current = text;
    setTranscripts((prev) => [...prev, { id, role, text, timestamp: nowStamp() }]);
  };

  const closeStreamedEntry = () => {
    openEntryRef.current = null;
  };

  /** Switch push-to-talk on or off at any point in the interview. */
  const handleTogglePtt = (enabled: boolean) => {
    isPushToTalkRef.current = enabled;
    setIsPushToTalk(enabled);
    if (!enabled) {
      // Going hands-free: end any held turn so nothing is left half open
      if (pttReleaseTimerRef.current) {
        clearTimeout(pttReleaseTimerRef.current);
        pttReleaseTimerRef.current = null;
      }
      if (pttSendingRef.current && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'ptt_end' }));
      pttSendingRef.current = false;
      setIsSpacePressed(false);
    }
  };

  /** Drop the voice connection and carry on by typing. The server keeps the conversation going as text. */
  const handleSwitchToText = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const history = stateRef.current.transcripts.slice(-24).map((t: TranscriptEntry) => ({ role: t.role, text: t.text }));
    ws.send(JSON.stringify({ type: 'switch_mode', mode: 'text', history }));
    audioRecorderRef.current?.stop();
    audioRecorderRef.current = null;
    audioPlayerRef.current?.stop();
    pttSendingRef.current = false;
    setIsSpacePressed(false);
    setIsInterviewerSpeaking(false);
    sessionModeRef.current = 'conversational_engine';
    setVoiceAgent(false);
    voiceAgentRef.current = false;
    setHasMicrophone(false);
    showNotice('Switched to text chat. The interviewer will reply in writing.');
  };

  const handleStartInterview = () => startSession(currentQuestion, { pushToTalk: isPushToTalk, voice, timing, voiceAgent });

  const handleHomeStart = (question: SystemDesignQuestion, options: StartOptions) => {
    setCurrentQuestion(question);
    setIsPushToTalk(options.pushToTalk);
    isPushToTalkRef.current = options.pushToTalk;
    setVoice(options.voice);
    setVoiceAgent(options.voiceAgent);
    voiceAgentRef.current = options.voiceAgent;
    setTiming(options.timing);
    setTranscripts([]);
    setLatestDiagramText('');
    setCode(question.coding?.starterCode ?? '');
    if (question.coding?.starterCode) setCodeLanguage('Python');
    setWorkspaceTab(question.type === 'coding' ? 'code' : 'whiteboard');
    setScorecard(null);
    setCurrentPhase('clarify');
    setElapsedSeconds(0);
    sessionIdRef.current = `ls_${Date.now()}`;
    lastSavedRef.current = '';
    sceneRef.current = [];
    setInitialScene(undefined);
    openEntryRef.current = null;
    setView('interview');
    pausedRef.current = false;
    startSession(question, options, { hasProgress: false, elapsed: 0 });
  };

  // Start interview session
  const startSession = async (
    question: SystemDesignQuestion,
    options: StartOptions,
    resumeOpts?: { hasProgress?: boolean; fromServer?: boolean; elapsed?: number; attempt?: number }
  ) => {
    if (isInterviewActiveRef.current || connectingRef.current) return;
    setConnecting(true);
    // Unlock audio output inside the click gesture
    audioPlayerRef.current?.unlock();
    openEntryRef.current = null;
    pttSendingRef.current = false;
    // Reminders for thresholds that have already passed (for example when rejoining late) are not repeated
    const elapsedNow = resumeOpts?.elapsed ?? elapsedSeconds;
    timeChecksSentRef.current = new Set([300, 60, 0].filter((t) => (timeLimitSeconds(options.timing) ?? Infinity) - elapsedNow <= t && elapsedNow > 0));

    // Starting an interview that already has history means rejoining it. Make sure the server has the latest
    // before it rebuilds the conversation (not for a session just loaded from the server, which is already current).
    const resuming = !!sessionIdRef.current && (resumeOpts?.hasProgress ?? stateRef.current.transcripts.length > 0);
    if (resuming && !resumeOpts?.fromServer) await saveSessionNow('active');
    audioThisTurnRef.current = false;
    pausedRef.current = false;

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
            apiKey: getApiKey(),
            llm: llmForSocket(),
            liveModel: voiceModelForSocket(),
            pushToTalk: options.pushToTalk,
            voiceAgent: options.voiceAgent,
            timing: options.timing,
            resumeSessionId: resuming ? sessionIdRef.current : undefined,
            kickoff: true,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'status' && msg.status === 'connected') {
            sessionModeRef.current = msg.mode || 'live_socket';
            setConnecting(false);
            setIsInterviewActive(true);
          } else if (msg.type === 'audio') {
            audioThisTurnRef.current = true;
            // Model 24kHz audio
            if (audioPlayerRef.current) {
              audioPlayerRef.current.playChunk(msg.data);
            }
          } else if (msg.type === 'interrupted') {
            // The model heard speech and stopped. The mic level helps tell a real interruption from echo or noise.
            console.info(`[bar-raiser] interviewer interrupted (mic level ${lastMicVolumeRef.current})`);
            // User interrupted model speech
            if (audioPlayerRef.current) {
              audioPlayerRef.current.stop();
            }
            setIsInterviewerSpeaking(false);
            audioThisTurnRef.current = false;
            closeStreamedEntry();
          } else if (msg.type === 'input_transcript') {
            appendStreamed('user', msg.text);
          } else if (msg.type === 'output_transcript') {
            appendStreamed('interviewer', msg.text);
          } else if (msg.type === 'turn_complete') {
            // Only the text-only fallback engine needs browser speech; live mode streams real audio
            if (sessionModeRef.current === 'conversational_engine' && readAloudRef.current && openEntryRef.current?.role === 'interviewer') {
              audioPlayerRef.current?.speakText(openTextRef.current, true);
            }
            // Rarely the model answers in text only. Speak it so the candidate is never left in silence.
            if (
              sessionModeRef.current === 'live_socket' &&
              !audioThisTurnRef.current &&
              openEntryRef.current?.role === 'interviewer' &&
              openTextRef.current.trim()
            ) {
              audioPlayerRef.current?.speakText(openTextRef.current, true);
            }
            audioThisTurnRef.current = false;
            closeStreamedEntry();
          } else if (msg.type === 'error') {
            // A refresh can leave the old connection open for a moment. When rejoining, wait and try again quietly.
            if (msg.code === 'live_limit' && resuming && (resumeOpts?.attempt ?? 0) < 3) {
              audioRecorderRef.current?.stop();
              audioRecorderRef.current = null;
              setConnecting(false);
              setIsInterviewActive(false);
              ws.close();
              setTimeout(() => startSession(question, options, { ...resumeOpts, hasProgress: true, attempt: (resumeOpts?.attempt ?? 0) + 1 }), 3000);
              return;
            }
            showNotice(msg.error || 'Something went wrong with the interview connection.');
            if (['live_limit', 'no_key', 'unauthorized'].includes(msg.code)) {
              setConnecting(false);
              setIsInterviewActive(false);
              audioRecorderRef.current?.stop();
              audioRecorderRef.current = null;
              ws.close();
              if (msg.code === 'unauthorized') setAuth('anon');
              if (msg.code === 'no_key') setShowKeySetup(true);
            }
          } else if (msg.type === 'status' && msg.status === 'closed') {
            setIsInterviewActive(false);
            setConnecting(false);
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket connection error:', err);
        setConnecting(false);
        setIsInterviewActive(false);
      };

      ws.onclose = () => {
        audioRecorderRef.current?.stop();
        audioRecorderRef.current = null;
        setIsInterviewActive(false);
        setConnecting(false);
      };

      // Start Microphone Recording (non-blocking)
      //
      // In hands-free mode the MicGate sends audio only while someone is speaking (silence costs tokens), and
      // ignores the interviewer's own voice coming back through the speakers, which the model would otherwise
      // take as the candidate interrupting. Push-to-talk already sends only what you hold the key for.
      const gate = new MicGate<string>(gateOptionsForSensitivity(micSensitivity));
      gateRef.current = gate;
      let latestVolume = 0;
      const sendAudio = (data: string) => wsRef.current?.send(JSON.stringify({ type: 'audio', data }));

      const recorder = new AudioRecorder(
        (base64Pcm) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          // Read live, so push-to-talk can be switched on or off in the middle of the interview
          if (isPushToTalkRef.current) {
            if (pttSendingRef.current) sendAudio(base64Pcm);
            return;
          }
          const { send, ended } = gate.push(base64Pcm, latestVolume, performance.now(), !!audioPlayerRef.current?.isPlaying);
          for (const chunk of send) sendAudio(chunk);
          if (ended) ws.send(JSON.stringify({ type: 'audio_end' })); // tell the model the mic went quiet
        },
        (volume) => {
          latestVolume = volume;
          lastMicVolumeRef.current = volume;
          setMicVolume(volume);
        }
      );

      if (options.voiceAgent) {
        const micStarted = await recorder.start();
        setHasMicrophone(micStarted);
        audioRecorderRef.current = recorder;
      } else {
        setHasMicrophone(false);
      }
    } catch (err: any) {
      console.error('Failed to start interview:', err);
      setConnecting(false);
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
    timing?: Timing;
  }): Promise<ScorecardData> => {
    return api<ScorecardData>('/api/grade', { body: payload, withKey: 'grading' });
  };

  // The record to export for the interview that just ended (latest saved copy, which includes the scorecard)
  const currentRecord = (): SavedInterview => {
    const saved = recordRef.current;
    return (
      saved ?? {
        id: 'unsaved',
        savedAt: Date.now(),
        question: currentQuestion,
        transcript: transcripts,
        diagramText: latestDiagramText,
        whiteboardImage: whiteboardImageRef.current,
        code,
        codeLanguage,
        durationSeconds: interviewDurationSeconds,
        timing,
        scorecard,
      }
    );
  };

  const codeTextFor = (c: string, lang: string) => (c ? `Language: ${lang}\n${c}` : '');

  const handleRegrade = async (entry: SavedInterview) => {
    const scorecard = await requestGrade({
      question: entry.question,
      transcript: entry.transcript,
      diagramText: entry.diagramText,
      codeText: codeTextFor(entry.code, entry.codeLanguage),
      durationSeconds: entry.durationSeconds,
      timing: entry.timing,
    });
    const updated = { ...entry, scorecard };
    setReviewRecord(updated);
    persist(updated);
  };

  // End interview session & trigger grading
  const handleEndInterview = async () => {
    const elapsed = elapsedSeconds;
    setInterviewDurationSeconds(elapsed);

    // Snapshot the whiteboard before anything else; skip very large images so storage is not exhausted
    let whiteboardImage: string | undefined;
    try {
      const img = await captureWhiteboardRef.current?.();
      if (img && img.length < 1_500_000) whiteboardImage = img;
    } catch (err) {
      console.warn('Whiteboard capture failed:', err);
    }
    whiteboardImageRef.current = whiteboardImage;

    // Save right away so nothing is lost if grading fails
    recordRef.current = null;
    if (transcripts.length > 0) {
      const record: SavedInterview = {
        id: `iv_${Date.now()}`,
        savedAt: Date.now(),
        question: currentQuestion,
        transcript: transcripts,
        diagramText: latestDiagramText,
        whiteboardImage,
        code,
        codeLanguage,
        durationSeconds: elapsed,
        timing,
        scorecard: null,
      };
      recordRef.current = record;
      persist(record);
    }
    // The interview is finished, so it no longer belongs under "In progress"
    if (sessionIdRef.current) {
      deleteLiveSession(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
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
        timing,
      });
      if (recordRef.current) {
        recordRef.current = { ...recordRef.current, scorecard: scorecardData };
        persist(recordRef.current);
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

  const noticeEl = notice ? (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[calc(100%-2rem)] rounded-lg border border-amber-500/40 bg-slate-900 px-4 py-3 text-sm text-amber-100 shadow-xl shadow-black/40 flex items-start gap-3"
    >
      <span className="flex-1 leading-relaxed">{notice}</span>
      <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-200 text-xs shrink-0">
        Dismiss
      </button>
    </div>
  ) : null;

  if (auth === 'loading') {
    return <div className="h-screen w-screen bg-slate-950 flex items-center justify-center text-sm text-slate-500">Loading...</div>;
  }
  if (auth === 'anon') {
    return (
      <AuthScreen
        onAuthed={(u) => {
          setUser(u);
          setAuth('authed');
        }}
      />
    );
  }
  if (!hasKey || showKeySetup) {
    return (
      <KeySetup
        onSaved={() => {
          setHasKey(isConfigured());
          setShowKeySetup(false);
        }}
        onCancel={hasKey ? () => setShowKeySetup(false) : undefined}
      />
    );
  }

  if (view === 'review' && reviewRecord) {
    return (
      <>
        <ReviewScreen
          key={reviewRecord.id + (reviewRecord.scorecard ? '-g' : '-u')}
          interview={reviewRecord}
          onBack={() => setView('home')}
          onDelete={() => {
            const id = reviewRecord.id;
            deleteInterview(id)
              .then(() => {
                setHistory((prev) => prev.filter((x) => x.id !== id));
                setView('home');
              })
              .catch((err) => showNotice(`Could not delete: ${err?.message || 'unknown error'}`));
          }}
          onRegrade={() => handleRegrade(reviewRecord)}
        />
        {noticeEl}
      </>
    );
  }

  if (view === 'home' || view === 'review') {
    return (
      <>
        <HomeScreen
          onStart={handleHomeStart}
          history={history}
          liveSessions={liveSessions}
          onResumeSession={(id) => loadSession(id, true)}
          onDiscardSession={discardSession}
          user={user}
          onSignOut={signOut}
          onChangeKey={() => setShowKeySetup(true)}
          onOpenInterview={(id) => {
            fetchInterview(id)
              .then((record) => {
                setReviewRecord(record);
                setView('review');
              })
              .catch((err) => showNotice(`Could not open that interview: ${err?.message || 'unknown error'}`));
          }}
        />
        {noticeEl}
      </>
    );
  }

  const scorecardModal = showScorecard ? (
      <ScorecardModal
        scorecard={scorecard}
        isLoading={isGrading}
        error={gradingError}
        onClose={() => setShowScorecard(false)}
        questionTitle={currentQuestion.title}
        durationSeconds={interviewDurationSeconds}
        transcriptCount={transcripts.length}
        rubric={currentQuestion.rubric}
        onDownloadMarkdown={() => downloadMarkdown(currentRecord())}
        onCopyMarkdown={() => copyMarkdown(currentRecord())}
      />
  ) : null;

  if (currentQuestion.type === 'behavioral') {
    return (
      <>
        <BehavioralInterview
          question={currentQuestion}
          isInterviewActive={isInterviewActive}
          isConnecting={isConnecting}
          transcripts={transcripts}
          isInterviewerSpeaking={isInterviewerSpeaking}
          isPushToTalk={isPushToTalk}
          isSpacePressed={isSpacePressed}
          micVolume={micVolume}
          hasMicrophone={hasMicrophone}
          remainingSeconds={remainingSeconds}
          elapsedSeconds={elapsedSeconds}
          timing={timing}
          onStart={handleStartInterview}
          onEnd={handleEndInterview}
          onPause={handlePause}
          onSendText={handleSendCandidateText}
          onPttPress={pttPress}
          onPttRelease={pttRelease}
          getAudioLevel={() => audioPlayerRef.current?.getLevel() ?? 0}
          onGoHome={leaveToHome}
        />
        {scorecardModal}
        {noticeEl}
      </>
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
              captureRef={captureWhiteboardRef}
              initialElements={initialScene}
              onSceneChange={(elements) => {
                sceneRef.current = elements;
              }}
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
              spec={currentQuestion.coding}
              onRunSummary={(summary) => {
                // Let the interviewer see the latest run, by attaching it to the code it just received
                const commented = summary.split('\n').map((l) => '# ' + l).join('\n');
                if (wsRef.current?.readyState === WebSocket.OPEN && code.trim()) {
                  wsRef.current.send(JSON.stringify({ type: 'code', text: `${code}\n\n# Result of the candidate's last run:\n${commented}`, language: codeLanguage }));
                }
              }}
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
            setElapsedSeconds(0);
          }}
          currentPhase={currentPhase}
          onSelectPhase={handlePhaseChange}
          isInterviewActive={isInterviewActive}
          onStartInterview={handleStartInterview}
          onPause={handlePause}
          canRejoin={transcripts.length > 0}
          onEndInterview={handleEndInterview}
          isConnecting={isConnecting}
          transcripts={transcripts}
          interimTranscript={null}
          isInterviewerSpeaking={isInterviewerSpeaking}
          isPushToTalk={isPushToTalk}
          onTogglePushToTalk={handleTogglePtt}
          voiceAgent={voiceAgent}
          onSwitchToText={handleSwitchToText}
          readAloud={readAloud}
          onToggleReadAloud={(on) => {
            setReadAloud(on);
            if (!on) audioPlayerRef.current?.stop();
          }}
          micSensitivity={micSensitivity}
          onMicSensitivity={setMicSensitivity}
          isSpacePressed={isSpacePressed}
          micVolume={micVolume}
          hasMicrophone={hasMicrophone}
          remainingSeconds={remainingSeconds}
          elapsedSeconds={elapsedSeconds}
          timing={timing}
          latestDiagramText={latestDiagramText}
          onSendCoachGuidance={handleSendCoachGuidance}
          onSendCandidateText={handleSendCandidateText}
          getAudioLevel={() => audioPlayerRef.current?.getLevel() ?? 0}
          onPttPress={pttPress}
          onPttRelease={pttRelease}
          onGoHome={leaveToHome}
        />
      </div>

      {scorecardModal}
      {noticeEl}
    </div>
  );
}
