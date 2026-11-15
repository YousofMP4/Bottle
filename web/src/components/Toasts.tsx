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
            className={`toast ${t.tone ?? ''}`}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={spring.toast}
          >
            {t.tone === 'accent' && <span className="toast-ic"><ICheck size={14} /></span>}
            {t.tone === 'error' && <span className="toast-ic err"><IX size={13} /></span>}
            <span className="toast-text">{t.text}</span>
            {t.action && <button className="toast-action" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
