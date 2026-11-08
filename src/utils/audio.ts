/**
 * Audio capture and playback utilities for Gemini Live API and voice speech
 * - Input: 16kHz 16-bit mono PCM little-endian (with automatic resampling from any native mic sample rate)
 * - Output: 24kHz PCM for Live API, WAV playback for Gemini TTS, and browser SpeechSynthesis fallback
 */

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  const sampleRateRatio = inputSampleRate / 16000;
  const newLength = Math.round(input.length / sampleRateRatio);
  const result = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const originalIndex = Math.min(input.length - 1, Math.round(i * sampleRateRatio));
    const s = Math.max(-1, Math.min(1, input[originalIndex]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

export class AudioRecorder {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onAudioChunkCallback: ((base64Pcm: string) => void) | null = null;
  private onVolumeCallback: ((volume: number) => void) | null = null;
  public isRecording = false;

  constructor(
    onAudioChunk: (base64Pcm: string) => void,
    onVolume?: (volume: number) => void
  ) {
    this.onAudioChunkCallback = onAudioChunk;
    this.onVolumeCallback = onVolume || null;
  }

  async start(): Promise<boolean> {
    if (this.isRecording) return true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia not supported in this environment');
        return false;
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.audioCtx = new AudioCtxClass({ sampleRate: 16000 });
      } catch {
        this.audioCtx = new AudioCtxClass();
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      const bufferSize = 2048;
      this.processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
      const actualSampleRate = this.audioCtx.sampleRate;

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputChannelData = e.inputBuffer.getChannelData(0);

        if (this.onVolumeCallback) {
          let sumSquares = 0;
          for (let i = 0; i < inputChannelData.length; i++) {
            sumSquares += inputChannelData[i] * inputChannelData[i];
          }
          const rms = Math.sqrt(sumSquares / inputChannelData.length);
          const normalized = Math.min(100, Math.round(rms * 280));
          this.onVolumeCallback(normalized);
        }

        const pcm16 = downsampleTo16k(inputChannelData, actualSampleRate);
        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        if (this.onAudioChunkCallback) {
          this.onAudioChunkCallback(base64);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);
      this.isRecording = true;
      return true;
    } catch (err) {
      console.warn('Microphone hardware not available:', err);
      this.stop();
      return false;
    }
  }

  stop(): void {
    this.isRecording = false;

    if (this.processor) {
      try {
        this.processor.disconnect();
        this.processor.onaudioprocess = null;
      } catch (err) {}
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (err) {}
      this.source = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (err) {}
      this.mediaStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close().catch(() => {});
      } catch (err) {}
      this.audioCtx = null;
    }
    if (this.onVolumeCallback) {
      this.onVolumeCallback(0);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBufferLike): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

export class AudioPlayer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  public isPlaying = false;
  private onPlaybackStateChange?: (isPlaying: boolean) => void;
  private rawAudioPlayed = false;

  constructor(onPlaybackStateChange?: (isPlaying: boolean) => void) {
    this.onPlaybackStateChange = onPlaybackStateChange;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.getVoices();
    }
  }

  public initContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.audioCtx = new AudioCtxClass({ sampleRate: 24000 });
      } catch {
        this.audioCtx = new AudioCtxClass();
      }
      // All Live API audio goes through this analyser so the avatar can follow the voice
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.audioCtx.destination);
      this.levelBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Unlock Web Audio & SpeechSynthesis synchronously inside a user gesture handler (button click)
   */
  public unlock(): void {
    try {
      const ctx = this.initContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Soft pleasant chime to confirm audio output is working
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
    } catch (e) {
      console.warn('Audio unlock warning:', e);
    }
  }

  /**
   * Play 24kHz raw PCM chunk from Gemini Live
   */
  playChunk(base64Pcm: string): void {
    try {
      this.rawAudioPlayed = true;
      this.stopSpeechSynthesis();

      const ctx = this.initContext();
      const binary = window.atob(base64Pcm);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const pcm16 = new Int16Array(bytes.buffer);
      if (pcm16.length === 0) return;

      const audioBuffer = ctx.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser ?? ctx.destination);

      const currentTime = ctx.currentTime;
      // Small lead on the first chunk of a burst so network jitter doesn't cause audible gaps
      const startTime =
        this.nextStartTime > currentTime ? this.nextStartTime : currentTime + 0.08;
      source.start(startTime);
      this.nextStartTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      this.setPlaying(true);

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) {
          this.activeSources.splice(idx, 1);
        }
        if (this.activeSources.length === 0) {
          this.setPlaying(false);
          this.nextStartTime = 0;
        }
      };
    } catch (err) {
      console.error('AudioPlayer playChunk error:', err);
    }
  }

  /** Current output loudness, 0 (silent) to 1 (loud). */
  getLevel(): number {
    if (!this.analyser || !this.levelBuf || !this.isPlaying) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  /**
   * Play WAV audio (e.g. from Gemini 3.8 Flash Lite TTS)
   */
  playWav(base64Wav: string): void {
    try {
      this.rawAudioPlayed = true;
      this.stopSpeechSynthesis();

      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
        this.currentAudioElement = null;
      }

      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      this.currentAudioElement = audio;
      this.setPlaying(true);

      audio.onended = () => {
        this.setPlaying(false);
        this.currentAudioElement = null;
      };

      audio.onerror = (e) => {
        console.warn('WAV playback failed:', e);
        this.setPlaying(false);
        this.currentAudioElement = null;
      };

      audio.play().catch((e) => {
        console.warn('WAV autoplay error:', e);
        this.setPlaying(false);
      });
    } catch (err) {
      console.error('playWav error:', err);
      this.setPlaying(false);
    }
  }

  /**
   * Speak interviewer text out loud using browser speech synthesis
   * Guarantees the user hears the interviewer talk!
   */
  speakText(text: string, force = false): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    try {
      if (this.rawAudioPlayed && !force) return;

      this.stopSpeechSynthesis();

      const cleanText = text.replace(/\[.*?\]/g, '').trim();
      if (!cleanText) return;

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      this.currentUtterance = utterance;
      utterance.rate = 1.0;
      utterance.pitch = 0.95;

      const voices = window.speechSynthesis.getVoices();
      const selectedVoice =
        voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Google') ||
              v.name.includes('Natural') ||
              v.name.includes('Daniel') ||
              v.name.includes('Samantha') ||
              v.name.includes('Guy') ||
              v.name.includes('David') ||
              v.name.includes('Alex'))
        ) || voices.find((v) => v.lang.startsWith('en'));

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => {
        this.setPlaying(true);
      };
      utterance.onend = () => {
        this.setPlaying(false);
        this.currentUtterance = null;
      };
      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis utterance event error:', e);
        this.setPlaying(false);
        this.currentUtterance = null;
      };

      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          console.warn('SpeechSynthesis speak failed:', e);
          this.setPlaying(false);
        }
      }, 40);
    } catch (err) {
      console.error('TTS speakText error:', err);
      this.setPlaying(false);
    }
  }

  private stopSpeechSynthesis(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    this.currentUtterance = null;
  }

  stop(): void {
    this.stopSpeechSynthesis();

    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement = null;
      } catch (e) {}
    }

    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (err) {}
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.rawAudioPlayed = false;
    this.setPlaying(false);
  }

  private setPlaying(playing: boolean): void {
    if (this.isPlaying !== playing) {
      this.isPlaying = playing;
      if (this.onPlaybackStateChange) {
        this.onPlaybackStateChange(playing);
      }
    }
  }
}
