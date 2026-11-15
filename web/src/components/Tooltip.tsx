import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ease } from '../lib/motion';

/**
 * One tooltip layer for the whole app. Any element with `data-tip` gets a polished tooltip:
 * label + keycaps, a short delay when "cold", instant when moving between controls ("warm"),
 * a 150ms fade/scale/slide, and an arrow pointing at the trigger. Use the `tip()` helper so
 * every icon-only control also gets a matching aria-label.
 *
 *   <button {...tip('Draw', 'D')}>…</button>
 *   <button {...tip('Send to agent', ['⌘', '↩'], { aria: false })}>Send to agent</button>
 */
export type Side = 'top' | 'bottom' | 'right' | 'left';
export function tip(label: string, keys?: string | string[], opts: { side?: Side; aria?: boolean; when?: 'collapsed' | 'truncated' } = {}) {
  const k = keys === undefined ? undefined : Array.isArray(keys) ? keys.join('|') : keys;
  return {
    'data-tip': label,
    ...(k ? { 'data-tip-keys': k } : {}),
    ...(opts.side ? { 'data-tip-side': opts.side } : {}),
    ...(opts.when ? { 'data-tip-when': opts.when } : {}),
    ...(opts.aria === false ? {} : { 'aria-label': label }),
  } as Record<string, string>;
}

const COLD_DELAY = 350; // ms before the first tooltip shows
const WARM_WINDOW = 400; // after a tooltip hides, others open instantly for this long
const GAP = 8;

interface Shown { el: HTMLElement; label: string; keys: string[]; side: Side; x: number; y: number; arrow: number }

function place(el: HTMLElement, bubble: { w: number; h: number }, wanted: Side): Omit<Shown, 'el' | 'label' | 'keys'> {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let side = wanted;
  if (side === 'top' && r.top - bubble.h - GAP < 4) side = 'bottom';
  else if (side === 'bottom' && r.bottom + bubble.h + GAP > vh - 4) side = 'top';
  else if (side === 'right' && r.right + bubble.w + GAP > vw - 4) side = 'left';
  else if (side === 'left' && r.left - bubble.w - GAP < 4) side = 'right';
  let x: number, y: number, arrow: number;
  if (side === 'top' || side === 'bottom') {
    const cx = r.left + r.width / 2;
    x = Math.min(vw - bubble.w - 8, Math.max(8, cx - bubble.w / 2));
    y = side === 'top' ? r.top - bubble.h - GAP : r.bottom + GAP;
    arrow = cx - x;
  } else {
    const cy = r.top + r.height / 2;
    y = Math.min(vh - bubble.h - 8, Math.max(8, cy - bubble.h / 2));
    x = side === 'right' ? r.right + GAP : r.left - bubble.w - GAP;
    arrow = cy - y;
  }
  return { side, x, y, arrow };
}

function eligible(el: HTMLElement) {
  const when = el.dataset.tipWhen;
  if (when === 'collapsed') return (document.querySelector('.sidebar') as HTMLElement | null)?.offsetWidth! < 120;
  if (when === 'truncated') {
    const t = el.querySelector('.nav-title, .card-title, .crumb-current') as HTMLElement | null;
    const collapsed = (document.querySelector('.sidebar') as HTMLElement | null)?.offsetWidth! < 120;
    return collapsed || (!!t && t.scrollWidth > t.clientWidth + 1);
  }
  return true;
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const measure = useRef<HTMLDivElement>(null);
  const st = useRef({ timer: 0, target: null as HTMLElement | null, lastHide: 0, suppressed: null as HTMLElement | null, open: false });

  useEffect(() => {
    const s = st.current;
    const hide = () => {
      clearTimeout(s.timer);
      s.target = null;
      if (s.open) { s.open = false; s.lastHide = performance.now(); }
      setShown(null);
    };
    const show = (el: HTMLElement) => {
      if (!el.isConnected || !eligible(el)) return;
      const label = el.dataset.tip || '';
      const keys = el.dataset.tipKeys ? el.dataset.tipKeys.split('|') : [];
      // Measure off-screen with the real content, then place.
      const m = measure.current!;
      m.querySelector('.tip-label')!.textContent = label;
      const kc = m.querySelector('.tip-keys') as HTMLElement;
      kc.innerHTML = '';
      for (const k of keys) { const s2 = document.createElement('kbd'); s2.className = 'keycap'; s2.textContent = k; kc.appendChild(s2); }
      const b = { w: m.offsetWidth, h: m.offsetHeight };
      s.open = true;
      setShown({ el, label, keys, ...place(el, b, (el.dataset.tipSide as Side) || 'top') });
    };
    const arm = (el: HTMLElement) => {
      if (s.target === el) return;
      clearTimeout(s.timer);
      s.target = el;
      const warm = s.open || performance.now() - s.lastHide < WARM_WINDOW;
      if (warm) { show(el); return; }
      s.timer = window.setTimeout(() => show(el), COLD_DELAY);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (!el) { if (s.target) hide(); return; }
      if (s.suppressed === el) return;
      s.suppressed = null;
      arm(el);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      const el = s.target;
      if (el && (!to || !el.contains(to))) { if (!to?.closest?.('[data-tip]')) hide(); }
      if (s.suppressed && (!to || !s.suppressed.contains(to))) s.suppressed = null;
    };
    // Clicking hides the tooltip and keeps it hidden until the pointer leaves that control.
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (s.target || shownRef.current) { s.lastHide = 0; s.open = false; hide(); }
      s.suppressed = el;
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el?.matches?.(':focus-visible')) return;
      const t = el.closest('[data-tip]') as HTMLElement | null;
      if (t) arm(t);
    };
    const onBlur = () => { if (s.target && !s.target.matches(':hover')) hide(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerout', onOut, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('focusin', onFocus);
    window.addEventListener('focusout', onBlur);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('focusout', onBlur);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      clearTimeout(s.timer);
    };
  }, []);

  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Labels that change while visible (Play → Pause) update in place; hide if the trigger goes away.
  useEffect(() => {
    if (!shown) return;
    const el = shown.el;
    const mo = new MutationObserver(() => {
      if (!el.isConnected) { setShown(null); return; }
      const label = el.dataset.tip;
      if (!label) { setShown(null); return; }
      if (label !== shown.label) setShown({ ...shown, label, keys: el.dataset.tipKeys ? el.dataset.tipKeys.split('|') : [] });
    });
    mo.observe(el, { attributes: true, attributeFilter: ['data-tip', 'data-tip-keys'] });
    const poll = window.setInterval(() => { if (!el.isConnected) setShown(null); }, 250);
    return () => { mo.disconnect(); clearInterval(poll); };
  }, [shown]);

  const off = { top: { y: 4 }, bottom: { y: -4 }, right: { x: -4 }, left: { x: 4 } } as const;

  return createPortal(
    <>
      <div ref={measure} className="tip tip-measure" aria-hidden>
        <span className="tip-label" /><span className="tip-keys" />
      </div>
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.el.dataset.tip + String(shown.x) + String(shown.y)}
            role="tooltip"
            className={`tip side-${shown.side}`}
            style={{ left: shown.x, top: shown.y, ['--arrow' as any]: `${shown.arrow}px` }}
            initial={{ opacity: 0, scale: 0.95, ...off[shown.side] }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.15, ease } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
          >
            <span className="tip-label">{shown.label}</span>
            {shown.keys.length > 0 && <span className="tip-keys">{shown.keys.map((k) => <kbd key={k} className="keycap">{k}</kbd>)}</span>}
            <i className="tip-arrow" />
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
