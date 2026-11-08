import { useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('go', go);

export const LANGUAGES = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'Go'];
const HLJS_ID: Record<string, string> = {
  Python: 'python',
  JavaScript: 'javascript',
  TypeScript: 'typescript',
  Java: 'java',
  'C++': 'cpp',
  Go: 'go',
};

interface CodeEditorProps {
  code: string;
  language: string;
  onChange: (code: string) => void;
  onLanguageChange: (language: string) => void;
}

// Textarea and highlighted <pre> must share exactly the same box metrics
const SHARED = 'absolute inset-0 m-0 p-4 font-mono text-[13px] leading-[1.6] whitespace-pre overflow-auto tab-size-4';

export function CodeEditor({ code, language, onChange, onLanguageChange }: CodeEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const html = useMemo(() => {
    try {
      // Trailing newline keeps the last empty line's height in sync with the textarea
      return hljs.highlight(code + '\n', { language: HLJS_ID[language] || 'python', ignoreIllegals: true }).value;
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '\n';
    }
  }, [code, language]);

  const syncScroll = () => {
    if (ref.current && preRef.current) {
      preRef.current.scrollTop = ref.current.scrollTop;
      preRef.current.scrollLeft = ref.current.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const setCaret = (pos: number) =>
      requestAnimationFrame(() => {
        if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = pos;
      });

    // Tab inserts spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      onChange(code.slice(0, start) + '    ' + code.slice(end));
      setCaret(start + 4);
      return;
    }
    // Enter keeps the current line's indentation (and adds one level after a colon/brace)
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const line = code.slice(lineStart, start);
      const indent = line.match(/^\s*/)?.[0] ?? '';
      const extra = /[:{(\[]\s*$/.test(line) ? '    ' : '';
      const insert = '\n' + indent + extra;
      onChange(code.slice(0, start) + insert + code.slice(end));
      setCaret(start + insert.length);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/60">
        <span className="text-[11px] font-mono text-slate-400">
          The interviewer sees your code a moment after you stop typing
        </span>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200"
        >
          {LANGUAGES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-h-0 relative">
        <pre ref={preRef} aria-hidden className={`${SHARED} pointer-events-none text-slate-200`}>
          <code className="hljs-code" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={ref}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          placeholder={`# Write your ${language} here`}
          className={`${SHARED} w-full h-full resize-none bg-transparent text-transparent caret-slate-100 outline-none placeholder:text-slate-700 selection:bg-indigo-500/40`}
        />
      </div>
    </div>
  );
}
