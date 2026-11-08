import { useEffect, useRef } from 'react';

interface InterviewerFaceProps {
  /** Returns current output loudness, 0 to 1. Read every frame, so it must be cheap. */
  getLevel: () => number;
  speaking: boolean;
  /** The candidate is talking (the dog tilts its head and perks its ears). */
  listening: boolean;
}

/** A rough, hand-drawn dog whose mouth follows the interviewer's voice. */
export function InterviewerFace({ getLevel, speaking, listening }: InterviewerFaceProps) {
  const mouthRef = useRef<SVGPathElement>(null);
  const tongueRef = useRef<SVGEllipseElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const earL = useRef<SVGGElement>(null);
  const earR = useRef<SVGGElement>(null);
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

      // Mouth: a closed grin at rest, the lower jaw drops while speaking
      const jaw = open * 13;
      if (mouthRef.current) {
        mouthRef.current.setAttribute(
          'd',
          open < 0.06
            ? 'M 50 63 L 50 68 M 37 67 Q 44 73 50 68 Q 56 73 63 67'
            : `M 50 63 L 50 68 M 38 67 Q 50 70 62 67 Q 60 ${68 + jaw} 50 ${69 + jaw} Q 40 ${68 + jaw} 38 67 Z`
        );
        mouthRef.current.setAttribute('fill', open < 0.06 ? 'none' : 'currentColor');
        mouthRef.current.setAttribute('fill-opacity', '0.18');
      }
      if (tongueRef.current) {
        tongueRef.current.setAttribute('cy', String(67 + jaw * 0.8));
        tongueRef.current.setAttribute('ry', String(Math.max(0.01, jaw * 0.3)));
        tongueRef.current.setAttribute('opacity', open < 0.1 ? '0' : '0.55');
      }

      // Eyes: blink squashes them for ~120ms
      const since = t - st.blink;
      const ry = since < 120 ? 0.8 : 4;
      eyeL.current?.setAttribute('ry', String(ry));
      eyeR.current?.setAttribute('ry', String(ry));

      // Brows lift while the candidate talks
      const lift = st.listening ? -3 : 0;
      browL.current?.setAttribute('transform', `translate(0 ${lift})`);
      browR.current?.setAttribute('transform', `translate(0 ${lift})`);

      if (!reduce) {
        // Ears flop with the voice and perk up when listening
        const flap = st.speaking ? Math.sin(t / 150) * 4 * (0.3 + open) : Math.sin(t / 1800) * 1.5;
        const perk = st.listening ? 14 : 0;
        earL.current?.setAttribute('transform', `rotate(${(flap - perk).toFixed(2)} 29 30)`);
        earR.current?.setAttribute('transform', `rotate(${(-flap + perk).toFixed(2)} 71 30)`);
        // Head bobs while speaking, tilts like a curious dog while listening
        const bob = st.speaking ? Math.sin(t / 220) * 1.3 * (0.4 + open) : Math.sin(t / 1400) * 0.6;
        const tilt = st.listening ? 9 : 0;
        headRef.current?.setAttribute('transform', `translate(0 ${bob.toFixed(2)}) rotate(${tilt} 50 55)`);
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
      aria-label={speaking ? 'Interviewer dog is speaking' : listening ? 'Interviewer dog is listening' : 'Interviewer dog'}
    >
      <defs>
        {/* Slight wobble gives the lines a hand-drawn feel */}
        <filter id="sketchy" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="1" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2" />
        </filter>
      </defs>
      <g filter="url(#sketchy)" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* collar and tag */}
        <path d="M 34 88 Q 50 98 66 88" />
        <circle cx="50" cy="98" r="3.4" strokeWidth="2" />
        <g ref={headRef}>
          {/* floppy ears sit behind the head */}
          <g ref={earL}>
            <path d="M 29 30 C 14 26 6 44 9 64 C 11 74 22 72 26 60 C 29 50 30 40 29 30 Z" fill="currentColor" fillOpacity="0.12" />
          </g>
          <g ref={earR}>
            <path d="M 71 30 C 86 26 94 44 91 64 C 89 74 78 72 74 60 C 71 50 70 40 71 30 Z" fill="currentColor" fillOpacity="0.12" />
          </g>
          {/* head */}
          <path d="M 50 14 C 72 13 82 30 81 50 C 80 72 68 86 50 86 C 32 86 20 72 19 50 C 18 30 28 15 50 14 Z" />
          <path ref={browL} d="M 31 33 Q 38 29 44 33" strokeWidth="2.2" />
          <path ref={browR} d="M 56 33 Q 62 29 69 33" strokeWidth="2.2" />
          <ellipse ref={eyeL} cx="38" cy="43" rx="3.2" ry="4" fill="currentColor" stroke="none" />
          <ellipse ref={eyeR} cx="62" cy="43" rx="3.2" ry="4" fill="currentColor" stroke="none" />
          {/* muzzle and nose */}
          <path d="M 34 58 C 34 52 42 51 50 51 C 58 51 66 52 66 58 C 66 70 58 76 50 76 C 42 76 34 70 34 58 Z" strokeWidth="2" />
          <ellipse cx="50" cy="56" rx="6.5" ry="4.6" fill="currentColor" stroke="none" />
          <ellipse ref={tongueRef} cx="50" cy="67" rx="5.5" ry="0.01" fill="currentColor" stroke="none" opacity="0" />
          <path ref={mouthRef} d="M 50 63 L 50 68 M 37 67 Q 44 73 50 68 Q 56 73 63 67" strokeWidth="2.2" />
        </g>
      </g>
    </svg>
  );
}
