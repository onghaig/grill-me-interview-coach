export type InterviewPhase = 'clarify' | 'estimate' | 'design' | 'deep_dive' | 'wrap_up';

export interface PhaseInfo {
  id: InterviewPhase;
  label: string;
  durationMinutes: number;
  description: string;
}

export const INTERVIEW_PHASES: PhaseInfo[] = [
  { id: 'clarify', label: 'Clarify', durationMinutes: 5, description: 'Scope requirements, constraints, latency, availability' },
  { id: 'estimate', label: 'Estimate', durationMinutes: 5, description: 'Back-of-envelope calculations: QPS, storage, memory' },
  { id: 'design', label: 'Design', durationMinutes: 10, description: 'High-level architecture, core data flow, components' },
  { id: 'deep_dive', label: 'Deep dive', durationMinutes: 7, description: 'Bottlenecks, partitioning, failure modes, consistency' },
  { id: 'wrap_up', label: 'Wrap-up', durationMinutes: 3, description: 'Summary, trade-offs, questions and next steps' },
];

const PHASE_OVERRIDES: Record<string, Partial<Record<InterviewPhase, { label: string; description: string }>>> = {
  low_level_design: {
    clarify: { label: 'Requirements', description: 'Use cases, actors, constraints, scope' },
    estimate: { label: 'Entities', description: 'Core classes, relationships, responsibilities' },
    design: { label: 'Class design', description: 'Interfaces, inheritance vs composition, patterns, key methods' },
    deep_dive: { label: 'Extend & harden', description: 'New requirements, concurrency, error handling, edge cases' },
    wrap_up: { label: 'Wrap-up', description: 'Trade-offs and what you would change' },
  },
  coding: {
    clarify: { label: 'Clarify', description: 'Restate the problem, examples, constraints, edge cases' },
    estimate: { label: 'Approach', description: 'Brute force to optimal, complexity analysis' },
    design: { label: 'Code', description: 'Implement the solution cleanly' },
    deep_dive: { label: 'Test', description: 'Dry run, edge cases, fix bugs' },
    wrap_up: { label: 'Follow-ups', description: 'Optimizations and variations' },
  },
};

export function getPhases(type?: string): PhaseInfo[] {
  const overrides = type ? PHASE_OVERRIDES[type] : undefined;
  if (!overrides) return INTERVIEW_PHASES;
  return INTERVIEW_PHASES.map((p) => ({ ...p, ...(overrides[p.id] || {}) }));
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'interviewer' | 'system';
  text: string;
  timestamp: string;
  isInterim?: boolean;
}

export interface ScorecardCategory {
  name: string;
  score: number;
  feedback: string;
  weight?: number;
}

export interface ScorecardData {
  overallVerdict: 'Strong Hire' | 'Hire' | 'Lean Hire' | 'Lean No Hire' | 'No Hire';
  totalScore: number;
  summary: string;
  categoryScores: ScorecardCategory[];
  strengths: string[];
  areasForImprovement: string[];
  keyArchitecturalTradeoffs: string[];
  recommendedStudyTopics: string[];
}
