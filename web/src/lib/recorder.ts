/** Voice notes with MediaRecorder + a live level meter for the waveform UI. */
export interface Recording { blob: Blob; duration: number; peaks: number[]; url: string }

export class VoiceRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private timer = 0;
  private started = 0;
  onLevel: ((level: number) => void) | null = null;

  static supported() { return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = []; this.levels = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.started = performance.now();
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const buf = new Float32Array(this.analyser.fftSize);
      this.timer = window.setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4.5);
        this.levels.push(level);
        this.onLevel?.(level);
      }, 50);
    } catch { /* level meter is optional */ }
  }

  elapsed() { return this.started ? (performance.now() - this.started) / 1000 : 0; }

  stop(): Promise<Recording> {
    return new Promise((resolve, reject) => {
      const rec = this.rec;
      if (!rec) return reject(new Error('Not recording'));
      const duration = this.elapsed();
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
        this.cleanup();
        resolve({ blob, duration, peaks: downsample(this.levels, 48), url: URL.createObjectURL(blob) });
      };
      rec.stop();
    });
  }

  cancel() { try { this.rec?.stop(); } catch { /* */ } this.cleanup(); }

  private cleanup() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.rec = null; this.stream = null; this.ctx = null; this.analyser = null; this.started = 0;
  }
}

export function downsample(src: number[], n: number): number[] {
  if (!src.length) return Array(n).fill(0.05);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * src.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * src.length));
    let m = 0; for (let j = a; j < b && j < src.length; j++) m = Math.max(m, src[j]);
    out.push(+Math.max(0.04, m).toFixed(3));
  }
  return out;
}
