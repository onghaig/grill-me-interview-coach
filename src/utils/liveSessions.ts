import { TranscriptEntry } from '../types';
import { SystemDesignQuestion } from '../../prompts/interviewer';
import { Timing } from '../../prompts/timing';
import { api } from './api';

/** An interview that is in progress or paused, as listed on the home screen. */
export interface LiveSessionSummary {
  id: string;
  /** "active": the page was closed or refreshed mid-interview. "paused": the user left on purpose. */
  status: 'active' | 'paused';
  title: string;
  type: string;
  updatedAt: number;
  elapsedSeconds: number;
  timing: Timing;
  turns: number;
}

/** Everything needed to put an interview back exactly as it was. */
export interface LiveSessionPayload {
  status: 'active' | 'paused';
  question: SystemDesignQuestion;
  timing: Timing;
  voice: string;
  phase: string;
  phaseLabel: string;
  elapsedSeconds: number;
  transcript: TranscriptEntry[];
  code: string;
  codeLanguage: string;
  diagramText: string;
  /** Excalidraw elements, so the drawing itself comes back and not only its text description. */
  scene?: any[];
}

export interface LiveSessionData extends LiveSessionPayload {
  id: string;
  updatedAt: number;
}

export const fetchLiveSessions = async (): Promise<LiveSessionSummary[]> =>
  (await api<{ sessions: LiveSessionSummary[] }>('/api/live-sessions')).sessions;

export const fetchLiveSession = (id: string): Promise<LiveSessionData> => api<LiveSessionData>(`/api/live-sessions/${id}`);

export const saveLiveSession = async (id: string, payload: LiveSessionPayload): Promise<void> => {
  await api(`/api/live-sessions/${id}`, { method: 'PUT', body: payload });
};

export const deleteLiveSession = async (id: string): Promise<void> => {
  await api(`/api/live-sessions/${id}`, { method: 'DELETE' });
};

/** Best-effort save while the page is closing. Browsers cap this at about 64 KB, so a large drawing may not fit. */
export function beaconLiveSession(id: string, payload: LiveSessionPayload): boolean {
  try {
    return navigator.sendBeacon(`/api/live-sessions/${id}`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  } catch {
    return false;
  }
}
