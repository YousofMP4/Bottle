import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pop } from '../lib/motion';

/** Small anchored menu. Opens up (transport) or down (top bar). Arrow keys move between items. */
export function Popover({ trigger, children, align = 'start', placement = 'up' }: {
  trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const viaKeyboard = useRef(false);
  const close = () => {
    setOpen(false);
    (ref.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])];
    if (viaKeyboard.current) requestAnimationFrame(() => { const it = items(); (it.find((i) => i.classList.contains('on')) ?? it[0])?.focus(); });
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const it = items(); if (!it.length) return;
        const i = it.indexOf(document.activeElement as HTMLElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % it.length : (i <= 0 ? it.length - 1 : i - 1);
        it[n].focus();
      }
    };
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', keys, true);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', keys, true); };
  }, [open]);
  const dy = placement === 'up' ? 6 : -6;
  return (
    <div className="popover-anchor" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <span
        className="popover-trigger"
        onPointerDown={() => { viaKeyboard.current = false; }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') viaKeyboard.current = true; }}
        onClick={() => setOpen((o) => !o)}
      >{trigger(open)}</span>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="menu"
            className={`popover ${align} ${placement}`}
            initial={{ opacity: 0, scale: 0.96, y: dy }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: pop }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
