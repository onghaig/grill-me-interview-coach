import { useEffect, useRef } from 'react';

interface InterviewerFaceProps {
  /** Returns current output loudness, 0 to 1. Read every frame, so it must be cheap. */
  getLevel: () => number;
  speaking: boolean;
  /** The candidate is talking (the interviewer looks attentive). */
  listening: boolean;
}

/** A rough, hand-drawn stick-figure face whose mouth follows the interviewer's voice. */
export function InterviewerFace({ getLevel, speaking, listening }: InterviewerFaceProps) {
  const mouthRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const eyeL = useRef<SVGEllipseElement>(null);
  const eyeR = useRef<SVGEllipseElement>(null);
  const browL = useRef<SVGPathElement>(null);
  const browR = useRef<SVGPathElement>(null);
  const state = useRef({ speaking, listening, getLevel, blink: 0, smooth: 0 });
  state.current.speaking = speaking;
  state.current.listening = listening;
  state.current.getLevel = getLevel;

  // Blink at irregular intervals
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        state.current.blink = performance.now();
        schedule();
      }, 2200 + Math.random() * 3200);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tick = (t: number) => {
      const st = state.current;
      let target = st.speaking ? st.getLevel() : 0;
      // Browser-TTS fallback has no audio level: fake plausible syllables
      if (st.speaking && target === 0) target = 0.35 + 0.3 * Math.abs(Math.sin(t / 130)) * Math.abs(Math.sin(t / 310));
      if (reduce) target = st.speaking ? 0.3 : 0;
      st.smooth += (target - st.smooth) * 0.45;
      const open = Math.min(1, st.smooth * 1.3);

      // Mouth: a smile at rest that opens into an oval while speaking
      const w = 15 - open * 3;
      const y = 76;
      const lip = 3 - open * 2;
      const drop = open * 15;
      if (mouthRef.current) {
        mouthRef.current.setAttribute(
          'd',
          open < 0.06
            ? `M ${50 - w} ${y} Q 50 ${y + lip + 4} ${50 + w} ${y}`
            : `M ${50 - w} ${y} Q 50 ${y - 4} ${50 + w} ${y} Q 50 ${y + drop + 4} ${50 - w} ${y} Z`
        );
        mouthRef.current.setAttribute('fill', open < 0.06 ? 'none' : 'currentColor');
        mouthRef.current.setAttribute('fill-opacity', '0.25');
      }

      // Eyes: blink squashes them for ~120ms
      const since = t - st.blink;
      const ry = since < 120 ? 0.8 : 4.2;
      eyeL.current?.setAttribute('ry', String(ry));
      eyeR.current?.setAttribute('ry', String(ry));

      // Brows lift slightly while the candidate talks
      const lift = st.listening ? -3 : 0;
      browL.current?.setAttribute('transform', `translate(0 ${lift})`);
      browR.current?.setAttribute('transform', `translate(0 ${lift})`);

      // Gentle bob while speaking, slight tilt while listening
      if (headRef.current && !reduce) {
        const bob = st.speaking ? Math.sin(t / 220) * 1.2 * (0.4 + open) : Math.sin(t / 1400) * 0.6;
        const tilt = st.listening ? 3 : 0;
        headRef.current.setAttribute('transform', `translate(0 ${bob.toFixed(2)}) rotate(${tilt} 50 50)`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 100 110"
      className="w-full h-full text-slate-200"
      role="img"
      aria-label={speaking ? 'Interviewer is speaking' : listening ? 'Interviewer is listening' : 'Interviewer'}
    >
      <defs>
        {/* Slight wobble gives the lines a hand-drawn feel */}
        <filter id="sketchy" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="1" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2" />
        </filter>
      </defs>
      <g filter="url(#sketchy)" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* neck and shoulders */}
        <path d="M 50 88 L 50 100 M 24 108 Q 50 98 76 108" />
        <g ref={headRef}>
          <path d="M 50 12 C 74 11 88 28 87 52 C 86 76 70 90 50 90 C 30 90 14 76 13 52 C 12 28 26 13 50 12 Z" />
          <path ref={browL} d="M 28 38 Q 36 33 44 37" />
          <path ref={browR} d="M 56 37 Q 64 33 72 38" />
          <ellipse ref={eyeL} cx="36" cy="49" rx="3.2" ry="4.2" fill="currentColor" stroke="none" />
          <ellipse ref={eyeR} cx="64" cy="49" rx="3.2" ry="4.2" fill="currentColor" stroke="none" />
          <path d="M 50 53 Q 46 62 51 64" strokeWidth="2" />
          <path ref={mouthRef} d="M 35 76 Q 50 82 65 76" />
        </g>
      </g>
    </svg>
  );
}
