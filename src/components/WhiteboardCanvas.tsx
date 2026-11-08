import { useState, useRef, useEffect, useCallback } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { serializeDiagram, ExcalidrawSimpleElement } from '../utils/diagramSerializer';
import { Layers, RefreshCw, Sparkles, Trash2, Eye, EyeOff } from 'lucide-react';

interface WhiteboardCanvasProps {
  /** Filled with a function that renders the board to a PNG data URL (null when the board is empty). */
  captureRef?: React.MutableRefObject<(() => Promise<string | null>) | null>;
  onDiagramUpdate: (serializedText: string) => void;
  latestSerializedText: string;
}

export function WhiteboardCanvas({ onDiagramUpdate, latestSerializedText, captureRef }: WhiteboardCanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = async () => {
      if (!excalidrawAPI) return null;
      const elements = excalidrawAPI.getSceneElements();
      if (!elements || elements.length === 0) return null;
      const blob: Blob = await exportToBlob({
        elements,
        appState: { ...excalidrawAPI.getAppState(), exportBackground: true, exportWithDarkMode: true },
        files: excalidrawAPI.getFiles(),
        mimeType: 'image/png',
        maxWidthOrHeight: 1400,
      });
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    };
    return () => {
      if (captureRef.current) captureRef.current = null;
    };
  }, [excalidrawAPI, captureRef]);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'idle'>('idle');
  const [showSerializedPreview, setShowSerializedPreview] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string>('');

  const processDiagram = useCallback(
    (elements: readonly any[]) => {
      try {
        const compactText = serializeDiagram(elements as ExcalidrawSimpleElement[]);
        if (compactText !== lastSerializedRef.current) {
          lastSerializedRef.current = compactText;
          setSyncStatus('synced');
          onDiagramUpdate(compactText);
        } else {
          setSyncStatus('synced');
        }
      } catch (err) {
        console.error('Failed to serialize diagram:', err);
      }
    },
    [onDiagramUpdate]
  );

  const handleChange = useCallback(
    (elements: readonly any[]) => {
      setSyncStatus('pending');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // 3-second debounce as strictly specified in prompt
      debounceTimerRef.current = setTimeout(() => {
        processDiagram(elements);
      }, 3000);
    },
    [processDiagram]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleForceSync = () => {
    if (!excalidrawAPI) return;
    const elements = excalidrawAPI.getSceneElements();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    processDiagram(elements);
  };

  const handleClearCanvas = () => {
    if (!excalidrawAPI) return;
    excalidrawAPI.resetScene();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    processDiagram([]);
  };

  // Quick system design preset template generator
  const handleInsertTemplate = (type: 'standard_3tier' | 'microservices_cache') => {
    if (!excalidrawAPI) return;

    if (type === 'standard_3tier') {
      const b1Id = 'b_client_' + Date.now();
      const t1Id = 't_client_' + Date.now();
      const b2Id = 'b_gw_' + Date.now();
      const t2Id = 't_gw_' + Date.now();
      const b3Id = 'b_cache_' + Date.now();
      const t3Id = 't_cache_' + Date.now();
      const b4Id = 'b_db_' + Date.now();
      const t4Id = 't_db_' + Date.now();

      const newElements: any[] = [
        // Client
        {
          id: b1Id,
          type: 'rectangle',
          x: 100,
          y: 200,
          width: 140,
          height: 70,
          strokeColor: '#38bdf8',
          backgroundColor: '#0c4a6e',
          fillStyle: 'solid',
          strokeWidth: 2,
          roundness: { type: 3 },
          boundElements: [{ id: t1Id, type: 'text' }],
        },
        {
          id: t1Id,
          type: 'text',
          x: 120,
          y: 222,
          text: 'Client App',
          fontSize: 18,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: b1Id,
          strokeColor: '#f8fafc',
        },
        // API Gateway
        {
          id: b2Id,
          type: 'rectangle',
          x: 340,
          y: 200,
          width: 160,
          height: 70,
          strokeColor: '#a855f7',
          backgroundColor: '#581c87',
          fillStyle: 'solid',
          strokeWidth: 2,
          roundness: { type: 3 },
          boundElements: [{ id: t2Id, type: 'text' }],
        },
        {
          id: t2Id,
          type: 'text',
          x: 355,
          y: 222,
          text: 'API Gateway',
          fontSize: 18,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: b2Id,
          strokeColor: '#f8fafc',
        },
        // Redis Cache
        {
          id: b3Id,
          type: 'ellipse',
          x: 600,
          y: 110,
          width: 150,
          height: 70,
          strokeColor: '#f43f5e',
          backgroundColor: '#881337',
          fillStyle: 'solid',
          strokeWidth: 2,
          boundElements: [{ id: t3Id, type: 'text' }],
        },
        {
          id: t3Id,
          type: 'text',
          x: 620,
          y: 132,
          text: 'Redis Cache',
          fontSize: 18,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: b3Id,
          strokeColor: '#f8fafc',
        },
        // DB
        {
          id: b4Id,
          type: 'rectangle',
          x: 600,
          y: 290,
          width: 160,
          height: 75,
          strokeColor: '#10b981',
          backgroundColor: '#064e3b',
          fillStyle: 'solid',
          strokeWidth: 2,
          roundness: { type: 3 },
          boundElements: [{ id: t4Id, type: 'text' }],
        },
        {
          id: t4Id,
          type: 'text',
          x: 615,
          y: 312,
          text: 'PostgreSQL DB',
          fontSize: 18,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: b4Id,
          strokeColor: '#f8fafc',
        },
        // Arrow Client -> Gateway
        {
          id: 'arr_1_' + Date.now(),
          type: 'arrow',
          x: 240,
          y: 235,
          width: 100,
          height: 0,
          points: [[0, 0], [100, 0]],
          startBinding: { elementId: b1Id, focus: 0, gap: 5 },
          endBinding: { elementId: b2Id, focus: 0, gap: 5 },
          strokeColor: '#94a3b8',
          strokeWidth: 2,
        },
        // Arrow Gateway -> Redis
        {
          id: 'arr_2_' + Date.now(),
          type: 'arrow',
          x: 500,
          y: 220,
          width: 100,
          height: -75,
          points: [[0, 0], [100, -75]],
          startBinding: { elementId: b2Id, focus: 0, gap: 5 },
          endBinding: { elementId: b3Id, focus: 0, gap: 5 },
          strokeColor: '#94a3b8',
          strokeWidth: 2,
        },
        // Arrow Gateway -> DB
        {
          id: 'arr_3_' + Date.now(),
          type: 'arrow',
          x: 500,
          y: 250,
          width: 100,
          height: 75,
          points: [[0, 0], [100, 75]],
          startBinding: { elementId: b2Id, focus: 0, gap: 5 },
          endBinding: { elementId: b4Id, focus: 0, gap: 5 },
          strokeColor: '#94a3b8',
          strokeWidth: 2,
        },
      ];

      excalidrawAPI.updateScene({ elements: newElements });
      processDiagram(newElements);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-900 border-r border-slate-800">
      {/* Canvas Top Bar Controls */}
      <div className="h-12 bg-slate-950/80 backdrop-blur border-b border-slate-800/80 px-4 flex items-center justify-between z-10 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  syncStatus === 'pending'
                    ? 'bg-amber-400'
                    : syncStatus === 'synced'
                    ? 'bg-emerald-400'
                    : 'bg-slate-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  syncStatus === 'pending'
                    ? 'bg-amber-500'
                    : syncStatus === 'synced'
                    ? 'bg-emerald-500'
                    : 'bg-slate-500'
                }`}
              />
            </span>
            <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase font-mono">
              Architecture Whiteboard
            </span>
          </div>

          <span className="text-xs px-2 py-0.5 rounded bg-slate-800/70 text-slate-400 font-mono">
            {syncStatus === 'pending'
              ? 'Syncing in 3s...'
              : syncStatus === 'synced'
              ? 'AI Live Synced'
              : 'Auto-sync active'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick stencil templates */}
          <button
            onClick={() => handleInsertTemplate('standard_3tier')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition"
            title="Insert Starter Architecture (Client -> Gateway -> Cache / DB)"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Insert Starter Architecture</span>
          </button>

          {/* Sync now button */}
          <button
            onClick={handleForceSync}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800/60 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 transition"
            title="Force immediate diagram serialization & sync"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Sync Now</span>
          </button>

          {/* Toggle serialized diagram text preview */}
          <button
            onClick={() => setShowSerializedPreview(!showSerializedPreview)}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition ${
              showSerializedPreview
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Preview what text is transmitted to Gemini Live"
          >
            {showSerializedPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span className="font-mono">AI Context</span>
          </button>

          {/* Clear canvas */}
          <button
            onClick={handleClearCanvas}
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition"
            title="Clear whiteboard canvas"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Excalidraw Area */}
      <div className="flex-1 w-full h-[calc(100%-48px)] relative overflow-hidden">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          theme="dark"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: { saveFileToDisk: true },
              loadScene: true,
              saveAsImage: true,
              toggleTheme: true,
            },
          }}
        />

        {/* Live Serialized Text Drawer / Floating Card */}
        {showSerializedPreview && (
          <div className="absolute bottom-4 left-4 z-20 w-80 max-h-64 bg-slate-900/95 backdrop-blur-md border border-indigo-500/30 rounded-lg shadow-2xl p-3 flex flex-col text-xs font-mono">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="font-bold text-indigo-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                Serialized AI Diagram Text
              </span>
              <span className="text-[10px] text-slate-500 uppercase">Debounced 3s</span>
            </div>
            <pre className="flex-1 overflow-y-auto text-slate-300 bg-slate-950/70 p-2 rounded border border-slate-800/80 whitespace-pre-wrap leading-relaxed select-text">
              {latestSerializedText || '(No shapes or connections drawn yet)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
