import { SystemDesignQuestion, QUESTION_TYPE_LABELS } from '../../prompts/interviewer';
import { Markdown } from './Markdown';

export function ProblemStatement({ question }: { question: SystemDesignQuestion }) {
  const type = question.type || 'system_design';
  const scaleLabel =
    type === 'coding' ? 'Constraints' : type === 'low_level_design' ? 'Scope' : type === 'behavioral' ? 'Format' : 'Scale and traffic';
  // The statement already lists constraints for coding questions, so skip the duplicate card
  const showScale = !(type === 'coding' && /constraints/i.test(question.description));
  return (
    <div className="w-full h-full overflow-y-auto bg-slate-950 select-text">
      <article className="max-w-[44rem] mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded border border-slate-700 text-slate-300">
            {QUESTION_TYPE_LABELS[type]}
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded border border-slate-700 text-slate-400">
            {question.difficulty}
          </span>
        </div>
        <h1 className="font-display text-[2rem] leading-tight font-medium tracking-tight text-slate-50 text-balance">
          {question.title}
        </h1>

        <Markdown text={question.description} className="mt-6 text-[15px] leading-7 text-slate-300" />

        {question.diagramSvg && (
          <figure className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            {/* Shown through an image, so nothing inside the picture can run */}
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(question.diagramSvg)}`}
              alt={`Diagram for ${question.title}`}
              className="w-full max-h-64 object-contain"
            />
          </figure>
        )}

        {showScale && (
          <section className="mt-8 rounded-lg border border-slate-800 bg-slate-900/60 px-5 py-4">
            <h2 className="text-[11px] font-mono uppercase tracking-wider text-indigo-400 mb-2">{scaleLabel}</h2>
            <Markdown text={question.scale} className="text-sm leading-6 text-slate-300" />
          </section>
        )}

        <p className="text-xs text-slate-500 mt-8 leading-relaxed">
          Ask the interviewer about anything that is ambiguous. Clarifying questions are part of what gets graded.
        </p>
      </article>
    </div>
  );
}
