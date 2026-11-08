import { useState } from 'react';
import { Sparkles, Loader2, ArrowLeft, Play, Radio, Mic, ChevronRight } from 'lucide-react';
import { Markdown } from './Markdown';
import { InterviewSummary } from '../utils/history';
import { api } from '../utils/api';
import { LIMITS } from '../utils/limits';
import type { AccountUser } from './AuthScreen';
import { SystemDesignQuestion, SYSTEM_DESIGN_QUESTIONS, QUESTION_TYPE_LABELS } from '../../prompts/interviewer';

export const VOICES = [
  { id: 'Sulafat', label: 'Sulafat (warm)' },
  { id: 'Achird', label: 'Achird (friendly)' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi (casual)' },
  { id: 'Aoede', label: 'Aoede (breezy)' },
  { id: 'Charon', label: 'Charon (informative)' },
  { id: 'Orus', label: 'Orus (firm)' },
  { id: 'Fenrir', label: 'Fenrir (excitable)' },
];

export interface StartOptions {
  pushToTalk: boolean;
  voice: string;
}

interface HomeScreenProps {
  onStart: (question: SystemDesignQuestion, options: StartOptions) => void;
  history: InterviewSummary[];
  user: AccountUser | null;
  onSignOut: () => void;
  onChangeKey: () => void;
  onOpenInterview: (id: string) => void;
}

const AMAZON_PRINCIPLES =
  'Customer Obsession; Ownership; Invent and Simplify; Are Right, A Lot; Learn and Be Curious; Hire and Develop the Best; Insist on the Highest Standards; Think Big; Bias for Action; Frugality; Earn Trust; Dive Deep; Have Backbone, Disagree and Commit; Deliver Results';

const EXAMPLES = [
  'Design a rate limiter for a public API',
  'Design Uber ride matching',
  'Low-level design: parking lot',
  'Low-level design: elevator system with OOP',
  'LeetCode 146: LRU Cache',
  'Merge k sorted lists',
];

export function HomeScreen({ onStart, history, user, onSignOut, onChangeKey, onOpenInterview }: HomeScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<SystemDesignQuestion | null>(null);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [voice, setVoice] = useState(VOICES[0].id);

  const [mode, setMode] = useState<'technical' | 'behavioral'>('technical');
  const [resumeText, setResumeText] = useState('');
  const [resumePdf, setResumePdf] = useState<{ name: string; data: string } | null>(null);
  const [resumeFileName, setResumeFileName] = useState('');
  const [principles, setPrinciples] = useState('');
  const [role, setRole] = useState('');

  const canGenerateBehavioral = !!(resumeText.trim() || resumePdf || principles.trim() || role.trim());

  const handleResumeFile = async (file: File) => {
    setError(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf && file.size > LIMITS.pdfBytes) {
      setError(`That PDF is over ${LIMITS.pdfBytes / 1024 / 1024} MB. Paste the text of your resume instead.`);
      return;
    }
    if (!isPdf && file.size > LIMITS.resumeTextFileBytes) {
      setError(`That file is over ${LIMITS.resumeTextFileBytes / 1024} KB. Paste the most recent part of your resume instead.`);
      return;
    }
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        setResumePdf({ name: file.name, data });
        setResumeText('');
        setResumeFileName('');
      } else {
        const text = await file.text();
        if (text.length > LIMITS.resumeChars) {
          setError(`That resume has ${text.length.toLocaleString()} characters. The limit is ${LIMITS.resumeChars.toLocaleString()}, so trim it to your most recent roles.`);
          return;
        }
        setResumeText(text);
        setResumeFileName(file.name);
        setResumePdf(null);
      }
    } catch {
      setError('Could not read that file. Try pasting the text instead.');
    }
  };

  const handleGenerateBehavioral = async () => {
    if (!canGenerateBehavioral || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const data = await api<{ question: SystemDesignQuestion }>('/api/behavioral', {
        withKey: true,
        body: {
          resumeText: resumeText.trim(),
          resumePdf: resumePdf ? { data: resumePdf.data, mimeType: 'application/pdf' } : undefined,
          principles: principles.trim(),
          role: role.trim(),
        },
      });
      setGenerated(data.question as SystemDesignQuestion);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong preparing the interview.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (mode === 'behavioral') return handleGenerateBehavioral();
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const data = await api<{ question: SystemDesignQuestion }>('/api/rubric', { withKey: true, body: { prompt: prompt.trim() } });
      setGenerated(data.question as SystemDesignQuestion);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong building the rubric.');
    } finally {
      setIsGenerating(false);
    }
  };

  const options: StartOptions = { pushToTalk, voice };

  const optionsBar = (
    <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-slate-400 flex items-center gap-2">
                Voice
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setPushToTalk(!pushToTalk)}
                className={`py-1.5 px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition ${
                  pushToTalk
                    ? 'border-indigo-500/50 bg-indigo-950/40 text-indigo-300'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {pushToTalk ? <Radio className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {pushToTalk ? 'Push-to-talk (hold Space)' : 'Hands-free'}
              </button>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              Bar Raiser
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400 min-w-0">
              {user && <span className="truncate max-w-[14rem]" title={user.email}>{user.email}</span>}
              <button onClick={onChangeKey} className="hover:text-slate-200 shrink-0">
                Models and keys
              </button>
              <button onClick={onSignOut} className="hover:text-slate-200 shrink-0">
                Sign out
              </button>
            </div>
          </div>
          <h1 className="font-display text-[2.6rem] leading-[1.1] font-medium tracking-tight mt-8 text-slate-50 text-balance">Practice the interview before the interview</h1>
          <p className="text-slate-400 mt-3 text-[15px] leading-relaxed max-w-2xl">
            Type any system design, low-level design or LeetCode-style question, or add your resume for a behavioral interview. The AI works out which it is,
            writes the problem and a hidden grading rubric, interviews you on it out loud, then scores you against a rubric that stays hidden until you finish.
          </p>
        </div>

        <ol className="flex items-center gap-2 mb-6 text-xs text-slate-500">
          {['Describe the question', 'Check the problem', 'Interview'].map((label, i) => {
            const active = (!generated && i === 0) || (generated && i === 1);
            const done = generated && i === 0;
            return (
              <li key={label} className="flex items-center gap-2">
                {i > 0 && <span className="w-6 h-px bg-slate-700" />}
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono border ${
                    active
                      ? 'border-indigo-400 text-indigo-300'
                      : done
                      ? 'border-slate-600 bg-slate-800 text-slate-300'
                      : 'border-slate-700 text-slate-600'
                  }`}
                >
                  {done ? '\u2713' : i + 1}
                </span>
                <span className={active ? 'text-slate-200' : ''}>{label}</span>
              </li>
            );
          })}
        </ol>

        {!generated ? (
          <>
            <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1 mb-4" role="tablist">
              {(['technical', 'behavioral'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`px-4 py-1.5 rounded-md text-xs font-medium ${
                    mode === m ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'technical' ? 'Technical' : 'Behavioral'}
                </button>
              ))}
            </div>
            {mode === 'technical' ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
                rows={4}
                maxLength={LIMITS.promptChars}
                placeholder="e.g. Design a notification system for 1B pushes a day, or: LeetCode 200 Number of Islands"
                className="w-full bg-transparent resize-none outline-none text-sm placeholder:text-slate-600"
                disabled={isGenerating}
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setPrompt(ex)}
                    disabled={isGenerating}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-[11px] text-slate-500">Ctrl/Cmd + Enter to generate</span>
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isGenerating}
                  className="py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-sm font-semibold flex items-center gap-2 transition"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Preparing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Create interview
                    </>
                  )}
                </button>
              </div>
              {error && (
                <p className="mt-3 text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5">
                  {error}
                </p>
              )}
            </div>
            ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="resume" className="text-xs font-medium text-slate-300">
                    Resume
                  </label>
                  <label className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                    Upload PDF (3 MB max) or text file
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleResumeFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {resumePdf ? (
                  <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm">
                    <span className="truncate">{resumePdf.name}</span>
                    <button onClick={() => setResumePdf(null)} className="text-xs text-slate-400 hover:text-slate-200 ml-3 shrink-0">
                      Remove
                    </button>
                  </div>
                ) : (
                  <textarea
                    id="resume"
                    value={resumeText}
                    onChange={(e) => {
                      setResumeText(e.target.value);
                      setResumeFileName('');
                    }}
                    rows={7}
                    maxLength={LIMITS.resumeChars}
                    disabled={isGenerating}
                    placeholder="Paste your resume here. Roles, projects and numbers make the questions much more specific."
                    className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm resize-y outline-none placeholder:text-slate-600 focus:border-slate-500"
                  />
                )}
                {!resumePdf && (
                  <p className="text-[11px] text-slate-500 mt-1 flex justify-between">
                    <span>{resumeFileName ? `Loaded from ${resumeFileName}` : ''}</span>
                    <span className="tabular-nums">{resumeText.length.toLocaleString()} / {LIMITS.resumeChars.toLocaleString()}</span>
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="principles" className="text-xs font-medium text-slate-300">
                    Leadership principles, values or business info
                  </label>
                  <button
                    onClick={() => setPrinciples(AMAZON_PRINCIPLES)}
                    disabled={isGenerating}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Use Amazon leadership principles
                  </button>
                </div>
                <textarea
                  id="principles"
                  value={principles}
                  onChange={(e) => setPrinciples(e.target.value)}
                  rows={4}
                  maxLength={LIMITS.principlesChars}
                  disabled={isGenerating}
                  placeholder="The principles or values to be assessed on, or notes on the company and what it cares about. Leave empty for general senior-engineer leadership questions."
                  className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm resize-y outline-none placeholder:text-slate-600 focus:border-slate-500"
                />
              </div>

              <div>
                <label htmlFor="role" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Role and company (optional)
                </label>
                <input
                  id="role"
                  value={role}
                  maxLength={LIMITS.roleChars}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={isGenerating}
                  placeholder="e.g. Senior Software Engineer at a large e-commerce company"
                  className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] text-slate-500 leading-relaxed">
                  Your resume is sent to Gemini to write the questions. This app does not store it, and it is not
                  kept after the interview is prepared.
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerateBehavioral || isGenerating}
                  className="shrink-0 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-sm font-semibold flex items-center gap-2 transition"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Preparing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Create interview
                    </>
                  )}
                </button>
              </div>
              {error && (
                <p className="text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5">{error}</p>
              )}
            </div>
            )}

            {mode === 'technical' ? (
              <>
            <h2 className="text-xs font-mono uppercase tracking-wider text-slate-500 mt-10 mb-3">
              Or start from a classic
            </h2>
            <div className="mb-3">{optionsBar}</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {SYSTEM_DESIGN_QUESTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => onStart(q, options)}
                  className="flex flex-col justify-start text-left p-4 rounded-lg border border-slate-800 bg-slate-900/50 hover:border-indigo-500/50 hover:bg-slate-900 transition group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{q.title}</span>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 shrink-0" />
                  </div>
                  <span className="block text-[11px] text-slate-500 mt-1">{q.scale}</span>
                </button>
              ))}
            </div>

              </>
            ) : (
              <div className="mt-4">{optionsBar}</div>
            )}

            {history.length > 0 && (
              <section className="mt-12">
                <h2 className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3">
                  Past interviews
                  <span className="ml-2 normal-case tracking-normal text-slate-600">saved in this browser</span>
                </h2>
                <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => onOpenInterview(h.id)}
                        className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-900 transition"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{h.title}</span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            {QUESTION_TYPE_LABELS[(h.type as keyof typeof QUESTION_TYPE_LABELS) || 'system_design'] || 'Interview'} ·{' '}
                            {new Date(h.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                            {Math.max(1, Math.round(h.durationSeconds / 60))} min
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-right">
                          {h.score !== null ? (
                            <>
                              <span className="font-display text-lg text-slate-50">{h.score}</span>
                              <span className="text-slate-500">/100</span>
                              <span className="block text-[11px] text-slate-400">{h.verdict}</span>
                            </>
                          ) : (
                            <span className="text-slate-500">Not graded</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div>
            <button
              onClick={() => setGenerated(null)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Change question
            </button>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-indigo-500/40 text-indigo-300 bg-indigo-950/30">
                  {QUESTION_TYPE_LABELS[generated.type || 'system_design']}
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-400 bg-amber-950/30">
                  {generated.difficulty}
                </span>
                {!(generated.type === 'coding' && /constraints/i.test(generated.description)) && (
                  <span className="text-[11px] text-slate-500">{generated.scale}</span>
                )}
              </div>
              <h2 className="font-display text-2xl font-medium tracking-tight text-slate-50">{generated.title}</h2>
              <Markdown text={generated.description} className="mt-3 text-sm leading-6 text-slate-300" />
            </div>

            <p className="mt-4 text-xs text-slate-500 leading-relaxed">
              {generated.type === 'behavioral'
                ? 'The questions and the grading rubric stay hidden. You will see the rubric with your scorecard when the interview ends.'
                : 'The grading rubric is ready but stays hidden. You will see it with your scorecard when the interview ends.'}
            </p>

            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex flex-wrap items-center gap-3">
              {optionsBar}
              <div className="flex-1" />
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="text-xs text-slate-400 hover:text-slate-200 px-2"
              >
                {isGenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button
                onClick={() => onStart(generated, options)}
                className="py-2.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-2 transition"
              >
                <Play className="w-4 h-4 fill-white" /> Start interview
              </button>
            </div>
            {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
