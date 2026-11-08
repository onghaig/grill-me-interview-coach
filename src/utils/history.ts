import { ScorecardData, TranscriptEntry } from '../types';
import { SystemDesignQuestion } from '../../prompts/interviewer';
import { api } from './api';

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

/** What the home screen list needs, without downloading every transcript. */
export interface InterviewSummary {
  id: string;
  savedAt: number;
  title: string;
  type: string;
  durationSeconds: number;
  score: number | null;
  verdict: string | null;
}

export const fetchHistory = async (): Promise<InterviewSummary[]> => (await api<{ interviews: InterviewSummary[] }>('/api/interviews')).interviews;

export const fetchInterview = async (id: string): Promise<SavedInterview> =>
  (await api<{ interview: SavedInterview }>(`/api/interviews/${id}`)).interview;

export const saveInterview = async (entry: SavedInterview): Promise<InterviewSummary> =>
  (await api<{ summary: InterviewSummary }>(`/api/interviews/${entry.id}`, { method: 'PUT', body: entry })).summary;

export const deleteInterview = async (id: string): Promise<void> => {
  await api(`/api/interviews/${id}`, { method: 'DELETE' });
};
