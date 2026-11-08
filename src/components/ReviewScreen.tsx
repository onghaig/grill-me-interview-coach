import { useState } from 'react';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { SavedInterview } from '../utils/history';
import { downloadMarkdown, copyMarkdown, downloadWhiteboardImage } from '../utils/exportMarkdown';
import { ScorecardModal } from './ScorecardModal';
import { ProblemStatement } from './ProblemStatement';
import { RubricView } from './RubricView';
import { QUESTION_TYPE_LABELS } from '../../prompts/interviewer';

type Tab = 'scorecard' | 'rubric' | 'transcript' | 'code' | 'problem' | 'whiteboard';

interface ReviewScreenProps {
  interview: SavedInterview;
  onBack: () => void;
  onDelete: () => void;
  onRegrade: () => Promise<void>;
}

export function ReviewScreen({ interview, onBack, onDelete, onRegrade }: ReviewScreenProps) {
  const [tab, setTab] = useState<Tab>(interview.scorecard ? 'scorecard' : 'transcript');
  const [showFull, setShowFull] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const sc = interview.scorecard;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'scorecard', label: 'Scorecard' },
    ...(interview.question.rubric ? [{ id: 'rubric' as Tab, label: 'Rubric' }] : []),
    { id: 'transcript', label: `Transcript (${interview.transcript.length})` },
    { id: 'code', label: 'Code' },
    { id: 'problem', label: 'Problem' },
    { id: 'whiteboard', label: 'Whiteboard' },
  ];

  const regrade = async () => {
    setRegrading(true);
    setError(null);
    try {
      await onRegrade();
      setTab('scorecard');
    } catch (e: any) {
      setError(e?.message || 'Grading failed.');
    } finally {
      setRegrading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-6 pt-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Past interviews
            </button>
            <span className="flex items-center gap-4">
            <button
              onClick={() => downloadMarkdown(interview)}
              className="text-xs text-slate-300 hover:text-slate-50"
              title="Full transcript, rubric, grading and code as one Markdown file"
            >
              Download .md
            </button>
            <button
              onClick={async () => {
                setCopied(await copyMarkdown(interview));
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-slate-300 hover:text-slate-50"
            >
              {copied ? 'Copied' : 'Copy Markdown'}
            </button>
            {confirmDelete ? (
              <span className="text-xs flex items-center gap-3">
                <span className="text-slate-400">Delete this interview permanently?</span>
                <button onClick={onDelete} className="text-rose-400 hover:text-rose-300 font-medium">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-slate-400 hover:text-slate-200">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 mt-3">
            <h1 className="font-display text-2xl font-medium tracking-tight text-slate-50">
              {interview.question.title}
            </h1>
            {sc && (
              <span className="shrink-0 text-sm text-slate-300">
                <span className="font-display text-2xl text-slate-50">{sc.totalScore}</span>/100 · {sc.overallVerdict}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {QUESTION_TYPE_LABELS[interview.question.type || 'system_design']} ·{' '}
            {new Date(interview.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
            {Math.max(1, Math.round(interview.durationSeconds / 60))} min
          </p>
          <nav className="flex gap-5 mt-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`pb-2.5 -mb-px text-xs font-medium border-b-2 ${
                  tab === t.id ? 'border-indigo-400 text-slate-50' : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'scorecard' && (
          <div className="max-w-4xl mx-auto px-6 py-8">
            {sc ? (
              <>
                <p className="text-sm text-slate-300 leading-7 max-w-3xl">{sc.summary}</p>
                <div className="mt-6 space-y-3">
                  {sc.categoryScores.map((c) => (
                    <div key={c.name} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {c.name}
                          {c.weight != null && <span className="ml-2 text-xs text-slate-500">{c.weight}%</span>}
                        </span>
                        <span className="font-mono text-slate-300">{c.score}/5</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{c.feedback}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowFull(true)}
                  className="mt-6 text-xs px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500"
                >
                  Open full scorecard
                </button>
              </>
            ) : (
              <div className="text-center py-16">
                <p className="text-slate-300">This interview was saved without a scorecard.</p>
                <p className="text-xs text-slate-500 mt-1">Grading may have failed when it ended.</p>
                <button
                  onClick={regrade}
                  disabled={regrading || interview.transcript.length === 0}
                  className="mt-5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white inline-flex items-center gap-2"
                >
                  {regrading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {regrading ? 'Grading...' : 'Grade this interview'}
                </button>
                {error && <p className="text-xs text-rose-400 mt-3 max-w-md mx-auto break-words">{error}</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'rubric' && interview.question.rubric && (
          <div className="max-w-4xl mx-auto px-6 py-8">
            <RubricView rubric={interview.question.rubric} />
          </div>
        )}

        {tab === 'transcript' && (
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-5 select-text">
            {interview.transcript.length === 0 && <p className="text-sm text-slate-500">No transcript was recorded.</p>}
            {interview.transcript.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] font-mono text-slate-500 mb-1">
                  {t.role === 'user' ? 'You' : 'Interviewer'} · {t.timestamp}
                </span>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                    t.role === 'user'
                      ? 'bg-indigo-950/60 border border-indigo-800/50 text-indigo-50'
                      : 'bg-slate-900 border border-slate-800 text-slate-200'
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'code' && (
          <div className="max-w-4xl mx-auto px-6 py-8">
            {interview.code.trim() ? (
              <>
                <p className="text-xs text-slate-500 mb-2">{interview.codeLanguage}</p>
                <pre className="font-mono text-[13px] leading-relaxed bg-slate-900 border border-slate-800 rounded-md p-4 overflow-x-auto text-slate-200 select-text">
                  {interview.code}
                </pre>
              </>
            ) : (
              <p className="text-sm text-slate-500">No code was written in this interview.</p>
            )}
          </div>
        )}

        {tab === 'problem' && (
          <div className="h-full">
            <ProblemStatement question={interview.question} />
          </div>
        )}

        {tab === 'whiteboard' && (
          <div className="max-w-4xl mx-auto px-6 py-8">
            {interview.whiteboardImage && (
              <figure>
                <img
                  src={interview.whiteboardImage}
                  alt="Whiteboard at the end of the interview"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900"
                />
                <figcaption className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>The board as it looked when you ended the interview.</span>
                  <button onClick={() => downloadWhiteboardImage(interview)} className="text-slate-300 hover:text-slate-50">
                    Download PNG
                  </button>
                </figcaption>
              </figure>
            )}
            {interview.diagramText.trim() ? (
              <>
                <p className="text-xs text-slate-500 mt-8 mb-2">
                  Text description of the whiteboard as the interviewer saw it at the end.
                </p>
                <pre className="font-mono text-[12px] leading-relaxed bg-slate-900 border border-slate-800 rounded-md p-4 overflow-x-auto text-slate-300 whitespace-pre-wrap select-text">
                  {interview.diagramText}
                </pre>
              </>
            ) : (
              !interview.whiteboardImage && <p className="text-sm text-slate-500">Nothing was drawn on the whiteboard.</p>
            )}
          </div>
        )}
      </main>

      {showFull && sc && (
        <ScorecardModal
          scorecard={sc}
          isLoading={false}
          onClose={() => setShowFull(false)}
          questionTitle={interview.question.title}
          durationSeconds={interview.durationSeconds}
          transcriptCount={interview.transcript.length}
          rubric={interview.question.rubric}
          onDownloadMarkdown={() => downloadMarkdown(interview)}
          onCopyMarkdown={() => copyMarkdown(interview)}
        />
      )}
    </div>
  );
}
