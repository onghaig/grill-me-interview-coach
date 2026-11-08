import type { CodingSpec } from '../../prompts/interviewer';

export interface TestResult {
  ok: boolean;
  input: string;
  expected: string;
  actual: string;
  hidden: boolean;
  error: string | null;
}
export interface RunResult {
  stdout: string;
  error: string | null;
  tests: TestResult[];
  timedOut?: boolean;
}

const TIME_LIMIT_MS = 10_000;
const LOAD_LIMIT_MS = 60_000;
let worker: Worker | null = null;
let n = 0;

function stop() {
  worker?.terminate();
  worker = null;
}

/** Run Python in a background worker. An endless loop is stopped after ten seconds without freezing the page. */
export function runPython(code: string, spec: CodingSpec | null, mode: 'exec' | 'tests', onStatus?: (s: string) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('./pyWorker.ts', import.meta.url), { type: 'module' });
    const w = worker;
    const id = ++n;
    onStatus?.('Loading Python (first run only)...');
    let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      stop();
      reject(new Error('Python took too long to load. Check your connection and try again.'));
    }, LOAD_LIMIT_MS);
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'started') {
        clearTimeout(timer);
        onStatus?.('Running...');
        timer = setTimeout(() => {
          stop();
          resolve({ stdout: '', error: 'Stopped: your code ran for more than 10 seconds. Look for an endless loop.', tests: [], timedOut: true });
        }, TIME_LIMIT_MS);
      } else if (m.type === 'result') {
        clearTimeout(timer);
        resolve(m.result);
      } else if (m.type === 'failure') {
        clearTimeout(timer);
        reject(new Error(m.message));
      }
    };
    w.onerror = () => {
      clearTimeout(timer);
      stop();
      reject(new Error('Could not start Python. Check your connection and try again.'));
    };
    w.postMessage({ id, code, spec, mode });
  });
}

/** A short text version of a run, so the interviewer can see what happened. */
export function summarizeRun(r: RunResult): string {
  const lines: string[] = [];
  if (r.tests.length) {
    const pass = r.tests.filter((t) => t.ok).length;
    lines.push(`Tests: ${pass} of ${r.tests.length} passed.`);
    for (const t of r.tests.filter((t) => !t.ok).slice(0, 3)) {
      lines.push(t.hidden ? 'A hidden test failed.' : `Failed: input ${t.input}, expected ${t.expected}, got ${t.error || t.actual}`);
    }
  }
  if (r.error) lines.push('Error:\n' + r.error.slice(-400));
  if (r.stdout.trim()) lines.push('Output:\n' + r.stdout.slice(0, 400));
  return lines.join('\n') || 'Ran with no output.';
}
