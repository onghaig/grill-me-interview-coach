import { Fragment, ReactNode } from 'react';

/** Small dependency-free renderer for the Markdown subset used in problem statements.
 *  Text is rendered through React, so model output can never inject HTML. */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code key={i++} className="font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-200">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={i++} className="font-semibold text-slate-50">
          {tok.slice(2, -2)}
        </strong>
      );
    } else {
      out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(text: string): ReactNode {
  return text.split('\n').map((l, i, arr) => (
    <Fragment key={i}>
      {inline(l)}
      {i < arr.length - 1 && <br />}
    </Fragment>
  ));
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  // Split out fenced code first, then treat the remainder block by block
  const parts = text.replace(/\r\n/g, '\n').split(/(```[^\n]*\n[\s\S]*?```)/g);
  let key = 0;
  for (const part of parts) {
    const fence = part.match(/^```[^\n]*\n([\s\S]*?)```$/);
    if (fence) {
      blocks.push(
        <pre
          key={key++}
          className="font-mono text-[13px] leading-relaxed bg-slate-900 border border-slate-800 rounded-md p-3.5 whitespace-pre-wrap break-words text-slate-200"
        >
          {fence[1].replace(/\n$/, '')}
        </pre>
      );
      continue;
    }
    for (const raw of part.split(/\n{2,}/)) {
      const block = raw.trim();
      if (!block) continue;
      const heading = block.match(/^(#{1,4})\s+(.*)$/);
      if (heading && !block.includes('\n')) {
        blocks.push(
          <h3 key={key++} className="text-[11px] font-mono uppercase tracking-wider text-indigo-400 pt-2">
            {inline(heading[2])}
          </h3>
        );
        continue;
      }
      let ls = block.split('\n');
      // A bold-only first line acts as a sub-heading ("**Example 1**", "**Constraints**")
      const sub = ls[0].match(/^\*\*([^*]+)\*\*:?$/);
      if (sub) {
        blocks.push(
          <h4 key={key++} className="text-sm font-semibold text-slate-100 pt-2">
            {sub[1]}
          </h4>
        );
        ls = ls.slice(1);
        if (ls.length === 0) continue;
      }
      if (ls.every((l) => /^\s*[-*•]\s+/.test(l))) {
        blocks.push(
          <ul key={key++} className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
            {ls.map((l, i) => (
              <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
            ))}
          </ul>
        );
        continue;
      }
      if (ls.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        blocks.push(
          <ol key={key++} className="list-decimal pl-5 space-y-1.5 marker:text-slate-500 marker:font-mono">
            {ls.map((l, i) => (
              <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
            ))}
          </ol>
        );
        continue;
      }
      blocks.push(<p key={key++}>{lines(ls.join('\n'))}</p>);
    }
  }
  return <div className={`space-y-3.5 ${className}`}>{blocks}</div>;
}
