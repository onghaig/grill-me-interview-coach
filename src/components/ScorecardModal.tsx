import { useState } from 'react';
import { ScorecardData } from '../types';
import { Rubric } from '../../prompts/interviewer';
import { RubricView } from './RubricView';
import { Award, CheckCircle2, AlertTriangle, BookOpen, Download, X, Star, BarChart3, Clock, Compass } from 'lucide-react';

interface ScorecardModalProps {
  scorecard: ScorecardData | null;
  isLoading: boolean;
  error?: string | null;
  onClose: () => void;
  questionTitle: string;
  durationSeconds: number;
  transcriptCount: number;
  rubric?: Rubric;
  onDownloadMarkdown?: () => void;
  onCopyMarkdown?: () => Promise<boolean>;
}

export function ScorecardModal({
  scorecard,
  isLoading,
  error,
  onClose,
  questionTitle,
  durationSeconds,
  transcriptCount,
  rubric,
  onDownloadMarkdown,
  onCopyMarkdown,
}: ScorecardModalProps) {
  const [copied, setCopied] = useState(false);

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'Strong Hire':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
      case 'Hire':
        return 'bg-teal-500/20 text-teal-400 border-teal-500/50';
      case 'Lean Hire':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Lean No Hire':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'No Hire':
      default:
        return 'bg-rose-500/20 text-rose-400 border-rose-500/50';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                FAANG Interview Scorecard & Debrief
              </h2>
              <p className="text-xs text-slate-400">{questionTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {scorecard && onCopyMarkdown && (
              <button
                onClick={async () => {
                  const ok = await onCopyMarkdown();
                  setCopied(ok);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700 transition"
              >
                <span>{copied ? 'Copied' : 'Copy Markdown'}</span>
              </button>
            )}
            {scorecard && onDownloadMarkdown && (
              <button
                onClick={onDownloadMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .md</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-md hover:bg-slate-800 transition"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
              <div>
                <h3 className="text-base font-semibold text-slate-200">Hiring Committee Debrief in Progress...</h3>
                <p className="text-xs text-slate-400 max-w-md mt-1">
                  Synthesizing transcript, whiteboarding diagrams, and distributed systems trade-offs with Gemini 3.8 Flash.
                </p>
              </div>
            </div>
          ) : !scorecard ? (
            <div className="py-16 text-center text-slate-400">
              {error ? (
                <>
                  <p className="text-rose-400 font-semibold">Grading failed</p>
                  <p className="text-xs mt-2 max-w-md mx-auto break-words">{error}</p>
                  <p className="text-xs mt-2">Your transcript was not lost. Close this and try ending the interview again.</p>
                </>
              ) : (
                <p>No evaluation available. Please complete an interview session first.</p>
              )}
            </div>
          ) : (
            <>
              {/* Top Decision Banner */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Hiring Committee Decision</span>
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      className={`px-3 py-1 text-sm font-bold rounded-md border ${getVerdictBadge(
                        scorecard.overallVerdict
                      )}`}
                    >
                      {scorecard.overallVerdict}
                    </span>
                    <span className="font-display text-4xl font-medium text-slate-50">{scorecard.totalScore}<span className="text-sm font-normal text-slate-500">/100</span></span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Interview Duration
                  </span>
                  <div className="mt-2">
                    <span className="text-xl font-bold text-slate-200">
                      {Math.floor(durationSeconds / 60)}m {durationSeconds % 60}s
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">{transcriptCount} speaking turns exchanged</p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-slate-400" />
                    Whiteboard Assessment
                  </span>
                  <div className="mt-2">
                    <span className="text-sm font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Integrated Whiteboard
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">Diagram components evaluated</p>
                  </div>
                </div>
              </div>

              {/* Summary Statement */}
              <div className="p-4 rounded-lg bg-indigo-950/20 border border-indigo-900/40 text-slate-200 text-sm leading-relaxed">
                <span className="font-semibold text-indigo-300 block mb-1">Executive Summary:</span>
                {scorecard.summary}
              </div>

              {/* Category Scores Breakdown */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  Core Competency Rubric (1 - 5 Scale)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scorecard.categoryScores.map((cat, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-lg bg-slate-950/50 border border-slate-800/80 hover:border-slate-700 transition flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-slate-200">{cat.name}</span>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-3.5 h-3.5 ${
                                star <= cat.score
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-slate-700'
                              }`}
                            />
                          ))}
                          <span className="text-xs font-mono font-bold text-slate-300 ml-1">
                            {cat.score}/5
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 leading-normal">{cat.feedback}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Strengths & Improvements */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Strengths */}
                <div className="p-4 rounded-lg bg-slate-950/50 border border-emerald-950/40">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Key Strengths Demonstrated
                  </h4>
                  <ul className="space-y-2">
                    {scorecard.strengths.map((s, idx) => (
                      <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="text-emerald-500 font-bold mt-0.5">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Improvements */}
                <div className="p-4 rounded-lg bg-slate-950/50 border border-amber-950/40">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <AlertTriangle className="w-4 h-4" />
                    Areas for Improvement & Red Flags
                  </h4>
                  <ul className="space-y-2">
                    {scorecard.areasForImprovement.map((a, idx) => (
                      <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="text-amber-500 font-bold mt-0.5">•</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Architectural Trade-offs & Study Topics */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Architectural Trade-offs Analyzed
                  </h4>
                  <ul className="space-y-1.5">
                    {scorecard.keyArchitecturalTradeoffs.map((t, idx) => (
                      <li key={idx} className="text-xs text-slate-400 flex items-start gap-2">
                        <span className="text-indigo-400 font-bold mt-0.5">→</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                    Recommended Study Topics
                  </h4>
                  <ul className="space-y-1.5">
                    {scorecard.recommendedStudyTopics.map((topic, idx) => (
                      <li key={idx} className="text-xs text-slate-400 flex items-start gap-2">
                        <span className="text-indigo-400 font-bold mt-0.5">✓</span>
                        <span>{topic}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {rubric && (
                <section>
                  <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Grading rubric</h3>
                  <p className="text-xs text-slate-500 mb-4">
                    This is what you were graded against. It was hidden during the interview.
                  </p>
                  <RubricView rubric={rubric} />
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Software Engineering Technical Interview Coach
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
