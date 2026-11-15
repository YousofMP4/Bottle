import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store';
import { spring } from '../lib/motion';
import { ICheck, IX } from './Icons';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.tone ?? ''} ${t.sub ? 'two' : ''}`}
            initial={{ opacity: 0, y: -16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.16 } }}
            transition={spring.toast}
          >
            {t.tone === 'accent' && <span className="toast-ic"><ICheck size={13} /></span>}
            {t.tone === 'error' && <span className="toast-ic err"><IX size={12} /></span>}
            <span className="toast-text">
              <span className="toast-title">{t.text}</span>
              {t.sub && <span className="toast-sub">{t.sub}</span>}
            </span>
            {t.action && <button className="toast-action" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss"><IX size={12} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
