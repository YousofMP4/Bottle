/**
 * A soft mechanical "click" for button presses, synthesized with WebAudio (no audio files):
 * a 4ms band-passed noise tick for the contact, plus a short low thump for the body.
 * Off by default; only the Settings toggle turns it on.
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let last = 0;

function ensure() {
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.02), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** `soft` is used for small controls (chips, menu rows); the default is a firmer key press. */
export function click(soft = false) {
  const now = performance.now();
  if (now - last < 35) return; // never stack clicks
  last = now;
  const c = ensure();
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = soft ? 3200 : 2400; bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(soft ? 0.05 : 0.09, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t); src.stop(t + 0.02);

  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(soft ? 180 : 140, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.03);
  const og = c.createGain();
  og.gain.setValueAtTime(soft ? 0.03 : 0.06, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  o.connect(og).connect(c.destination);
  o.start(t); o.stop(t + 0.04);
}

/** Which elements count as "hardware" for the click. */
export const CLICKY = '.btn, .round-btn, .pill-btn, .ver-chip, .step-btn, .step-read, .tb-btn, .tb-swatch, .fb-voice, .fb-mode, .fb-icon, .fb-send, .fc-send, .vn-play, .seg-btn, .vol-knob, .c-act, .toast-action';
export const SOFT = '.seg-btn, .c-act, .tb-swatch, .ver-chip, .step-read';
