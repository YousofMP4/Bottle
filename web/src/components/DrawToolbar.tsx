import { motion } from 'motion/react';
import type { Tool } from '../../../server/types';
import { useStore } from '../lib/store';
import { DRAW_COLORS } from '../lib/shapes';
import { spring } from '../lib/motion';
import { IArrowTool, ICircle, IPen, IRect, IUndo, IX } from './Icons';
import { tip } from './Tooltip';

const COLOR_NAMES: Record<string, string> = { '#ff5a4e': 'Red', '#ffd23f': 'Yellow', '#b9ec8f': 'Green', '#4fb3ff': 'Blue', '#ffffff': 'White' };

export const TOOLS: { id: Tool; label: string; key: string; Icon: typeof IPen }[] = [
  { id: 'pen', label: 'Pen', key: '1', Icon: IPen },
  { id: 'arrow', label: 'Arrow', key: '2', Icon: IArrowTool },
  { id: 'rect', label: 'Box', key: '3', Icon: IRect },
  { id: 'ellipse', label: 'Circle', key: '4', Icon: ICircle },
];

export function DrawToolbar() {
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const shapes = useStore((s) => s.draft?.shapes.length ?? 0);
  const set = useStore((s) => s.set);
  const undo = () => { const d = useStore.getState().draft; if (d) useStore.getState().patchDraft({ shapes: d.shapes.slice(0, -1) }); };

  return (
    <motion.div
      className="draw-toolbar"
      initial={{ opacity: 0, y: -14, scale: 0.92, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -10, scale: 0.94, filter: 'blur(3px)', transition: { duration: 0.14 } }}
      transition={spring.morph}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="tb-group">
        {TOOLS.map(({ id, label, key, Icon }) => (
          <button key={id} className={`tb-btn ${tool === id ? 'on' : ''}`} onClick={() => set({ tool: id })} aria-pressed={tool === id} {...tip(label, key, { side: 'bottom' })}>
            {tool === id && <motion.span layoutId="tb-active" className="tb-active" transition={spring.morph} />}
            <motion.span className="tb-ic" animate={{ scale: tool === id ? 1.06 : 1 }} transition={spring.pop}><Icon size={17} /></motion.span>
          </button>
        ))}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {DRAW_COLORS.map((c) => (
          <button key={c} className="tb-swatch" onClick={() => set({ color: c })} aria-pressed={color === c} {...tip(COLOR_NAMES[c] ?? c, undefined, { side: 'bottom' })}>
            <motion.span style={{ background: c }} animate={{ scale: color === c ? 1 : 0.62 }} transition={spring.pop} />
            {color === c && <motion.i layoutId="tb-swatch-ring" className="tb-swatch-ring" style={{ borderColor: c }} transition={spring.morph} />}
          </button>
        ))}
      </div>
      <span className="tb-sep" />
      <button className="tb-btn" onClick={undo} disabled={!shapes} {...tip('Undo last mark', ['⌘', 'Z'], { side: 'bottom' })}><span className="tb-ic"><IUndo size={17} /></span></button>
      <button className="tb-btn" onClick={() => set({ tool: null })} {...tip('Done drawing', 'Esc', { side: 'bottom' })}><span className="tb-ic"><IX size={16} /></span></button>
    </motion.div>
  );
}
