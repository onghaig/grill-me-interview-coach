import { useState } from 'react';
import { Sparkles, Loader2, ArrowLeft, Play, ShieldAlert, ListChecks, Radio, Mic, ChevronRight } from 'lucide-react';
import { Markdown } from './Markdown';
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
}

const EXAMPLES = [
  'Design a rate limiter for a public API',
  'Design Uber ride matching',
  'Low-level design: parking lot',
  'Low-level design: elevator system with OOP',
  'LeetCode 146: LRU Cache',
  'Merge k sorted lists',
];

export function HomeScreen({ onStart }: HomeScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<SystemDesignQuestion | null>(null);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [voice, setVoice] = useState(VOICES[0].id);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.question) throw new Error(data.error || `Request failed (${res.status})`);
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
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            Software Engineering Technical Interview Coach
          </div>
          <h1 className="font-display text-[2.6rem] leading-[1.1] font-medium tracking-tight mt-8 text-slate-50 text-balance">Practice the interview before the interview</h1>
          <p className="text-slate-400 mt-3 text-[15px] leading-relaxed max-w-2xl">
            Type any system design, low-level design or LeetCode-style question. The AI works out which it is,
            builds a grading rubric, interviews you on it out loud, then scores you against that rubric.
          </p>
        </div>

        <ol className="flex items-center gap-2 mb-6 text-xs text-slate-500">
          {['Describe the question', 'Review the rubric', 'Interview'].map((label, i) => {
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
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
                rows={4}
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
                      <Loader2 className="w-4 h-4 animate-spin" /> Building rubric...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Build rubric
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
                <span className="text-[11px] text-slate-500">{generated.scale}</span>
              </div>
              <h2 className="font-display text-2xl font-medium tracking-tight text-slate-50">{generated.title}</h2>
              <Markdown text={generated.description} className="mt-3 text-sm leading-6 text-slate-300" />
            </div>

            {generated.rubric && (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
                <h3 className="text-xs font-mono uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5" /> Grading rubric
                </h3>
                <div className="space-y-3">
                  {generated.rubric.categories.map((c) => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">{c.name}</span>
                        <span className="text-xs font-mono text-slate-400">{c.weight}%</span>
                      </div>
                      <div className="h-1 rounded-full bg-slate-800 mt-1">
                        <div className="h-1 rounded-full bg-indigo-500" style={{ width: `${c.weight}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">{c.description}</p>
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-4 mt-5 text-xs">
                  <div>
                    <h4 className="font-semibold text-emerald-400 mb-1.5">Must cover</h4>
                    <ul className="space-y-1 text-slate-300 list-disc pl-4">
                      {generated.rubric.mustCover.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-rose-400 mb-1.5 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> Red flags
                    </h4>
                    <ul className="space-y-1 text-slate-300 list-disc pl-4">
                      {generated.rubric.redFlags.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

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
