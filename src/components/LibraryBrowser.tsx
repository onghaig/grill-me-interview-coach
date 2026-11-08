import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { LibraryEntry, LibraryList, LIBRARY_LISTS } from '../../prompts/library';
import { SystemDesignQuestion } from '../../prompts/interviewer';
import { api } from '../utils/api';

interface Props {
  /** Called with the finished question once it has been fetched or written. */
  onPick: (question: SystemDesignQuestion) => void;
}

const DIFF_COLOR: Record<string, string> = {
  Easy: 'text-emerald-400 border-emerald-500/30',
  Medium: 'text-amber-400 border-amber-500/30',
  Hard: 'text-rose-400 border-rose-500/30',
};

export function LibraryBrowser({ onPick }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [list, setList] = useState<LibraryList>('neetcode150');
  const [topic, setTopic] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [search, setSearch] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ entries: LibraryEntry[]; cached: string[] }>('/api/library')
      .then((d) => {
        setEntries(d.entries);
        setCached(new Set(d.cached));
      })
      .catch((e) => setError(e?.message || 'Could not load the library.'));
  }, []);

  const inList = useMemo(() => entries.filter((e) => e.list === list), [entries, list]);
  const topics = useMemo(() => ['All', ...Array.from(new Set(inList.map((e) => e.topic)))], [inList]);
  const shown = inList.filter(
    (e) =>
      (topic === 'All' || e.topic === topic) &&
      (difficulty === 'All' || e.difficulty === difficulty) &&
      (!search.trim() || e.title.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const pick = async (e: LibraryEntry) => {
    if (loadingId) return;
    setError(null);
    setLoadingId(e.id);
    try {
      const d = await api<{ question: SystemDesignQuestion; cached: boolean }>(`/api/library/${e.id}`, {
        method: 'POST',
        withKey: 'questions',
        body: {},
      });
      setCached((prev) => new Set(prev).add(e.id));
      onPick(d.question);
    } catch (err: any) {
      setError(err?.message || 'Could not open that question.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {LIBRARY_LISTS.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              setList(l.id);
              setTopic('All');
              setDifficulty('All');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${
              list === l.id ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
          />
        </div>
        {list === 'neetcode150' && (
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
            {topics.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        {list === 'neetcode150' && (
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
            {['All', 'Easy', 'Medium', 'Hard'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="text-xs text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded-md p-2.5 mb-3">{error}</p>}
      <p className="text-[11px] text-slate-500 mb-2">
        {shown.length} question{shown.length === 1 ? '' : 's'}. The first time anyone opens a question the model writes it, which uses your API key. After that it is stored and free.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 max-h-[28rem] overflow-y-auto pr-1">
        {shown.map((e) => (
          <button
            key={e.id}
            onClick={() => pick(e)}
            disabled={!!loadingId}
            className="flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-900/50 hover:border-indigo-500/50 hover:bg-slate-900 transition disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-sm truncate">{e.title}</span>
              {e.list === 'neetcode150' && <span className="block text-[11px] text-slate-500">{e.topic}</span>}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {e.list === 'neetcode150' && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${DIFF_COLOR[e.difficulty]}`}>{e.difficulty}</span>}
              {loadingId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : cached.has(e.id) ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
