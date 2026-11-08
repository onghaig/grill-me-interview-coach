import { SystemDesignQuestion, QUESTION_TYPE_LABELS } from '../../prompts/interviewer';

export function ProblemStatement({ question }: { question: SystemDesignQuestion }) {
  const type = question.type || 'system_design';
  const scaleLabel =
    type === 'coding' ? 'Constraints' : type === 'low_level_design' ? 'Scope' : 'Scale & traffic';
  return (
    <div className="w-full h-full overflow-y-auto bg-slate-950 p-8 select-text">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-indigo-500/40 text-indigo-300 bg-indigo-950/30">
            {QUESTION_TYPE_LABELS[type]}
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-400 bg-amber-950/30">
            {question.difficulty}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-100">{question.title}</h1>

        <h2 className="text-[11px] font-mono uppercase tracking-widest text-indigo-400 mt-6 mb-1.5">
          Problem
        </h2>
        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{question.description}</p>

        <h2 className="text-[11px] font-mono uppercase tracking-widest text-indigo-400 mt-6 mb-1.5">
          {scaleLabel}
        </h2>
        <p className="text-sm font-mono text-slate-300 leading-relaxed">{question.scale}</p>

        <p className="text-xs text-slate-500 mt-8">
          Ask the interviewer to clarify anything that is ambiguous. That is part of what is graded.
        </p>
      </div>
    </div>
  );
}
