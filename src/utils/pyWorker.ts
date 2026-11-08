/// <reference lib="webworker" />
import { PY_HARNESS } from './pyHarness';

// Pyodide (Python compiled to WebAssembly) is fetched from a CDN the first time someone presses Run.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let ready: Promise<any> | null = null;

function load() {
  if (!ready) {
    ready = (async () => {
      const mod = await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs');
      const py = await mod.loadPyodide({ indexURL: PYODIDE_URL });
      py.runPython(PY_HARNESS);
      return py;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, code, spec, mode } = e.data;
  try {
    const py = await load();
    self.postMessage({ id, type: 'started' });
    const run = py.globals.get('__br_run');
    const json = run(code, JSON.stringify(spec ?? {}), mode);
    run.destroy?.();
    self.postMessage({ id, type: 'result', result: JSON.parse(json) });
  } catch (err: any) {
    self.postMessage({ id, type: 'failure', message: String(err?.message || err).slice(0, 300) });
  }
};
