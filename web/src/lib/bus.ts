/**
 * High-frequency player state (current time) lives outside React. Components subscribe and write
 * to the DOM directly, so playback never re-renders the tree.
 */
type Fn = (t: number) => void;
const subs = new Set<Fn>();
let current = 0;
export const timeBus = {
  get: () => current,
  emit(t: number) { current = t; for (const f of subs) f(t); },
  on(f: Fn) { subs.add(f); f(current); return () => { subs.delete(f); }; },
};

/** Imperative handle to the <video> element, set by <Stage>. */
export const player = {
  el: null as HTMLVideoElement | null,
  fps: 30,
  duration: 0,
  reverseRaf: 0,
  reverseRate: 0,
  onShuttle: null as null | ((rate: number) => void),
  get time() { return this.el?.currentTime ?? 0; },
  /** Called whenever the video starts; the audio controller hooks this to stop voice notes. */
  onPlay: null as null | (() => void),
  play() { this.stopReverse(); this.onPlay?.(); this.el?.play().catch(() => {}); },
  /**
   * Live scrubbing: only one seek in flight at a time, always to the latest wanted time, so the
   * frame under the cursor keeps up while dragging instead of queueing stale seeks.
   */
  scrubWant: -1,
  scrubTo(t: number) {
    const v = this.el;
    if (!v) return;
    const d = v.duration || this.duration || 0;
    const tt = Math.max(0, Math.min(d ? d - 0.001 : t, t));
    timeBus.emit(tt);
    this.scrubWant = tt;
    if (v.seeking) return;
    const next = () => {
      if (this.scrubWant < 0) return;
      const w = this.scrubWant;
      if (Math.abs(v.currentTime - w) < 0.004) { this.scrubWant = -1; return; }
      v.currentTime = w;
      v.addEventListener('seeked', next, { once: true });
    };
    next();
  },
  /** End a scrub: land exactly on the last position. */
  endScrub(t: number) { this.scrubWant = -1; this.seek(t); },
  pause() { this.stopReverse(); this.el?.pause(); },
  toggle() { if (!this.el) return; if (this.el.paused && !this.reverseRate) this.play(); else { this.pause(); this.setRate(1); } },
  seek(t: number) {
    if (!this.el) return;
    const d = this.el.duration || this.duration || 0;
    const tt = Math.max(0, Math.min(d ? d - 0.001 : t, t));
    this.el.currentTime = tt;
    timeBus.emit(tt);
  },
  /** Snap to the nearest frame boundary then move n frames. */
  step(n: number) {
    if (!this.el) return;
    this.pause();
    const f = Math.round(this.el.currentTime * this.fps) + n;
    this.seek((f + 0.001) / this.fps);
  },
  setRate(r: number) { if (this.el) this.el.playbackRate = r; this.onShuttle?.(r); },
  /** J/K/L shuttle. Positive = forward speeds, negative = reverse (emulated by seeking). */
  shuttle(dir: 1 | -1) {
    if (!this.el) return;
    const speeds = [1, 2, 4, 8];
    if (dir > 0) {
      this.stopReverse();
      const cur = this.el.paused ? 0 : this.el.playbackRate;
      const next = speeds.find((s) => s > cur) ?? 8;
      this.el.playbackRate = next; this.onShuttle?.(next);
      this.el.play().catch(() => {});
    } else {
      this.el.pause();
      const cur = this.reverseRate;
      const next = speeds.find((s) => s > cur) ?? 8;
      this.reverseRate = next; this.onShuttle?.(-next);
      if (!this.reverseRaf) {
        let last = performance.now();
        const loop = (now: number) => {
          if (!this.el || !this.reverseRate) return;
          const dt = (now - last) / 1000; last = now;
          if (!this.el.seeking) {
            const t = Math.max(0, this.el.currentTime - dt * this.reverseRate);
            this.el.currentTime = t; timeBus.emit(t);
            if (t <= 0) { this.stopReverse(); return; }
          }
          this.reverseRaf = requestAnimationFrame(loop);
        };
        this.reverseRaf = requestAnimationFrame(loop);
      }
    }
  },
  stopReverse() {
    if (this.reverseRaf) cancelAnimationFrame(this.reverseRaf);
    this.reverseRaf = 0;
    if (this.reverseRate) { this.reverseRate = 0; this.onShuttle?.(this.el?.playbackRate ?? 1); }
  },
};
