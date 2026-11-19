import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { pop } from '../lib/motion';
import { IChevronRight } from './Icons';

export type MenuItem =
  | 'sep'
  | { label: string; icon?: ReactNode; kbd?: string; danger?: boolean; disabled?: boolean; hint?: string; run?: () => void; submenu?: MenuItem[] };

interface Open { x: number; y: number; items: MenuItem[]; key: number }
let open: Open | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let n = 0;

/** Open the app's context menu at a point (usually a right-click). */
export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault?.(); e.stopPropagation?.();
  open = { x: e.clientX, y: e.clientY, items, key: ++n };
  emit();
}
export function closeMenu() { if (open) { open = null; emit(); } }

export function ContextMenuLayer() {
  const cur = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open);
  useEffect(() => {
    if (!cur) return;
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.('.ctx-menu')) closeMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeMenu(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu);
    };
  }, [cur]);
  return createPortal(
    <AnimatePresence>{cur && <Panel key={cur.key} x={cur.x} y={cur.y} items={cur.items} root />}</AnimatePresence>,
    document.body,
  );
}

function Panel({ x, y, alt, items, root, onBack }: { x: number; y: number; alt?: number; items: MenuItem[]; root?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ox: 0, oy: 0 });
  const [sub, setSub] = useState<{ i: number; x: number; y: number; alt: number } | null>(null);

  // Keep the whole menu on screen: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight;
    let nx = x, ny = y, ox = 0, oy = 0;
    if (nx + w > vw - 8) { nx = Math.max(8, root ? x - w : (alt ?? x) - w); ox = 1; }
    if (ny + h > vh - 8) { ny = Math.max(8, vh - h - 8); oy = 1; }
    setPos({ x: nx, y: ny, ox, oy });
    if (root) requestAnimationFrame(() => (el.querySelector('.menu-item:not([aria-disabled="true"])') as HTMLElement | null)?.focus({ preventScroll: true }));
  }, [x, y]);

  const buttons = () => [...(ref.current?.querySelectorAll<HTMLElement>(':scope > .menu-item:not([aria-disabled="true"])') ?? [])];
  const onKey = (e: React.KeyboardEvent) => {
    const b = buttons(); const i = b.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); b[i <= 0 ? b.length - 1 : i - 1]?.focus(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); (document.activeElement as HTMLElement)?.dispatchEvent(new MouseEvent('mouseenter')); (document.activeElement as HTMLElement)?.click(); }
    else if (e.key === 'ArrowLeft' && onBack) { e.preventDefault(); e.stopPropagation(); onBack(); }
  };

  return (
    <motion.div
      ref={ref}
      role="menu"
      className="ctx-menu menu"
      style={{ left: pos.x, top: pos.y, transformOrigin: `${pos.ox ? 'right' : 'left'} ${pos.oy ? 'bottom' : 'top'}` }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: pop }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => it === 'sep' ? <div key={i} className="menu-sep" /> : (
        <button
          key={i}
          role="menuitem"
          className={`menu-item ${it.danger ? 'danger' : ''} ${sub?.i === i ? 'on' : ''}`}
          aria-disabled={it.disabled || undefined}
          aria-haspopup={it.submenu ? 'menu' : undefined}
          title={it.disabled ? it.hint : undefined}
          onMouseEnter={(e) => {
            if (it.submenu && !it.disabled) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSub({ i, x: r.right + 2, alt: r.left - 2, y: r.top - 4 }); }
            else setSub(null);
          }}
          onClick={(e) => {
            if (it.disabled) return;
            if (it.submenu) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSub({ i, x: r.right + 2, alt: r.left - 2, y: r.top - 4 }); return; }
            closeMenu(); it.run?.();
          }}
        >
          <span className="menu-ic">{it.icon}</span>
          <span className="menu-label-text">{it.label}</span>
          {it.kbd && <span className="menu-kbd">{it.kbd}</span>}
          {it.submenu && <IChevronRight size={13} className="menu-chev" />}
        </button>
      ))}
      <AnimatePresence>
        {sub && typeof items[sub.i] === 'object' && (items[sub.i] as any).submenu && (
          <Sub key={sub.i} x={sub.x} y={sub.y} alt={sub.alt} items={(items[sub.i] as any).submenu} onBack={() => { setSub(null); buttons()[0]?.focus(); }} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Sub(props: { x: number; y: number; alt: number; items: MenuItem[]; onBack: () => void }) {
  return createPortal(<Panel {...props} />, document.body);
}
