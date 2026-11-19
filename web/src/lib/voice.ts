import { useSyncExternalStore } from 'react';
import { player } from './bus';

/**
 * The one audio controller for voice notes.
 *
 * - A single <audio> element for the whole app, so two clips can never overlap.
 * - State comes from the element's own events (play / pause / ended), never from click counts.
 * - A toggle that arrives while play() is still pending is ignored, so rapid clicks can't stack.
 * - Playing a voice note pauses the video; the video starting stops the voice note (see Stage).
 */
export interface VoiceState { id: string | null; playing: boolean; progress: number; duration: number }

let state: VoiceState = { id: null, playing: false, progress: 0, duration: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<VoiceState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

let el: HTMLAudioElement | null = null;
let pending: Promise<void> | null = null;
let raf = 0;

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = 'auto';
  el.addEventListener('play', () => { set({ playing: true }); tick(); });
  el.addEventListener('pause', () => { cancelAnimationFrame(raf); set({ playing: false }); });
  el.addEventListener('ended', () => { cancelAnimationFrame(raf); set({ playing: false, progress: 0 }); if (el) el.currentTime = 0; });
  el.addEventListener('loadedmetadata', () => { if (el && isFinite(el.duration)) set({ duration: el.duration }); });
  el.addEventListener('error', () => { cancelAnimationFrame(raf); set({ playing: false }); });
  return el;
}

function tick() {
  cancelAnimationFrame(raf);
  const loop = () => {
    if (!el) return;
    const d = isFinite(el.duration) && el.duration > 0 ? el.duration : state.duration || 1;
    set({ progress: Math.min(1, el.currentTime / d) });
    if (!el.paused) raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

export const voice = {
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },

  /** Play/pause the clip `id`. Starting a different clip stops the current one first. */
  toggle(id: string, url: string, durationHint = 0) {
    if (pending) return; // play() still settling: ignore the extra click
    const a = audio();
    if (state.id === id && !a.paused) { a.pause(); return; }
    if (state.id !== id) {
      a.pause();
      a.src = url;
      a.currentTime = 0;
      set({ id, progress: 0, duration: durationHint, playing: false });
    }
    player.pause(); // a voice note and the video never play over each other
    pending = a.play().catch(() => { set({ playing: false }); }).finally(() => { pending = null; });
  },

  /** Stop whatever is playing (used when the video starts). */
  stop() {
    if (!el || el.paused) return;
    el.pause();
  },

  /** Forget a clip (e.g. its draft was discarded). */
  release(id: string) {
    if (state.id !== id || !el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
    set({ id: null, playing: false, progress: 0, duration: 0 });
  },
};

/** React hook: this clip's live state (playing only if it's the current clip). */
export function useVoice(id: string) {
  const s = useSyncExternalStore(voice.subscribe, voice.get);
  const mine = s.id === id;
  return { playing: mine && s.playing, progress: mine ? s.progress : 0, active: mine };
}
