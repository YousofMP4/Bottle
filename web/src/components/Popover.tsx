import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { spring } from '../lib/motion';

/** Small anchored menu that opens upward (it lives in the bottom transport bar). */
export function Popover({ trigger, children, align = 'start', placement = 'up' }: {
  trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className="popover-anchor" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((o) => !o)}>{trigger(open)}</span>
      <AnimatePresence>
        {open && (
          <motion.div
            className={`popover ${align} ${placement}`}
            initial={{ opacity: 0, scale: 0.94, y: placement === 'up' ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={spring.toast}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
