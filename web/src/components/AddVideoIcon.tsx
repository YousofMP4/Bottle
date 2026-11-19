import { useStore } from '../lib/store';
import { IPlus } from './Icons';

/** The "+" on Add video buttons. It turns into a spinner while Finder is opening. */
export function AddVideoIcon({ size = 16, dark = false }: { size?: number; dark?: boolean }) {
  const picking = useStore((s) => s.picking);
  if (!picking) return <IPlus size={size} />;
  return <span className={`add-spin ${dark ? 'dark' : ''}`} style={{ width: size, height: size }} aria-hidden><span className="spinner" /></span>;
}

/** Props shared by every Add video button while the picker is pending. */
export function useAddBusy() {
  const picking = useStore((s) => s.picking);
  return { 'aria-busy': !!picking || undefined, 'data-busy': picking ? '' : undefined } as const;
}
