import { ScorecardData, TranscriptEntry } from '../types';
import { SystemDesignQuestion } from '../../prompts/interviewer';

export interface SavedInterview {
  id: string;
  savedAt: number;
  question: SystemDesignQuestion;
  transcript: TranscriptEntry[];
  diagramText: string;
  /** PNG data URL of the whiteboard at the end of the interview, if anything was drawn. */
  whiteboardImage?: string;
  code: string;
  codeLanguage: string;
  durationSeconds: number;
  scorecard: ScorecardData | null;
}

const KEY = 'interview-history-v1';
const MAX_ENTRIES = 50;

export function loadHistory(): SavedInterview[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: SavedInterview[]): SavedInterview[] {
  let items = list.slice(0, MAX_ENTRIES);
  // If storage is full, drop the oldest entries until it fits
  while (items.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      return items;
    } catch {
      items = items.slice(0, -1);
    }
  }
  return items;
}

/** Insert or replace by id; newest first. Returns the stored list. */
export function saveInterview(entry: SavedInterview): SavedInterview[] {
  const rest = loadHistory().filter((e) => e.id !== entry.id);
  return write([entry, ...rest].sort((a, b) => b.savedAt - a.savedAt));
}

export function deleteInterview(id: string): SavedInterview[] {
  return write(loadHistory().filter((e) => e.id !== id));
}
