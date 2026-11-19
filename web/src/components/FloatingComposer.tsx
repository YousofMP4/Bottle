import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store';
import { composer } from './FeedbackBar';
import { tc } from '../lib/time';
import { IArrowUp, IPen } from './Icons';
import { tip } from './Tooltip';

const W = 340;
const GAP = 16;

/**
 * The "Leave feedback" box that springs in under the cursor when a drawing stroke ends.
 * Shares the draft with the main feedback bar; Enter posts, Esc discards the whole draft.
 */
export function FloatingComposer() {
  const float = useStore((s) => s.float);
  const draft = useStore((s) => s.draft);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [h, setH] = useState(104);

  useLayoutEffect(() => { if (ref.current) setH(ref.current.offsetHeight); });
  // Focus (and select nothing) every time the box lands somewhere new.
  useEffect(() => {
    if (!float || float.drawing) return;
    const t = input.current;
    if (t) { t.focus({ preventScroll: true }); const n = t.value.length; t.setSelectionRange(n, n); }
  }, [float?.x, float?.y, float?.drawing]);

  const open = !!float && !!draft;
  let x = 0, y = 0;
  if (float) {
    const vw = window.innerWidth, vh = window.innerHeight;
    x = Math.min(vw - W - 8, Math.max(8, float.x - 28));
    y = float.y + GAP;
    if (y + h > vh - 8) y = Math.max(8, float.y - h - GAP); // flip above the cursor near the bottom
  }

  const cancel = () => { useStore.getState().clearDraft(); };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          key="float"
          className={`float-composer ${float!.drawing ? 'stepping-aside' : ''}`}
          style={{ width: W, left: 0, top: 0 }}
          initial={{ opacity: 0, scale: 0.9, x, y: y - 8 }}
          animate={{ opacity: float!.drawing ? 0.25 : 1, scale: 1, x, y }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.8 }}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Comment on this drawing"
        >
          <div className="fc-head">
            <span className="fc-chip mono">{tc(draft!.t, true)}</span>
            <span className="fc-marks"><IPen size={12} /> {draft!.shapes.length} mark{draft!.shapes.length === 1 ? '' : 's'}</span>
          </div>
          <textarea
            ref={input}
            rows={2}
            className="fc-input"
            placeholder="Leave feedback…"
            aria-label="Comment"
            value={draft!.text}
            onChange={(e) => useStore.getState().patchDraft({ text: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); composer.post(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
          />
          <div className="fc-foot">
            <span className="fc-hint"><kbd className="keycap">↩</kbd> send <kbd className="keycap">Esc</kbd> discard</span>
            <button className="fc-send" onClick={() => composer.post()} {...tip('Post comment', '↩')}><IArrowUp size={15} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
