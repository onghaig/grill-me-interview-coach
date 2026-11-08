import { Rubric } from '../../prompts/interviewer';

/** The full grading rubric: weighted categories with their signals, must-cover topics and red flags. */
export function RubricView({ rubric }: { rubric: Rubric }) {
  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-4">
        {rubric.categories.map((c) => (
          <div key={c.name} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-100">{c.name}</span>
              <span className="text-xs font-mono text-slate-400">{c.weight}%</span>
            </div>
            <div className="h-1 rounded-full bg-slate-800 mt-2">
              <div className="h-1 rounded-full bg-indigo-500" style={{ width: `${c.weight}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">{c.description}</p>
            <div className="grid sm:grid-cols-2 gap-4 mt-3 text-xs">
              <div>
                <h4 className="font-medium text-emerald-400 mb-1">Strong signals</h4>
                <ul className="list-disc pl-4 space-y-1 text-slate-300 marker:text-slate-600">
                  {c.strongSignals.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-rose-400 mb-1">Weak signals</h4>
                <ul className="list-disc pl-4 space-y-1 text-slate-300 marker:text-slate-600">
                  {c.weakSignals.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-xs">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="font-medium text-emerald-400 mb-1.5">Must cover</h4>
          <ul className="list-disc pl-4 space-y-1 text-slate-300 marker:text-slate-600">
            {rubric.mustCover.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h4 className="font-medium text-rose-400 mb-1.5">Red flags</h4>
          <ul className="list-disc pl-4 space-y-1 text-slate-300 marker:text-slate-600">
            {rubric.redFlags.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
