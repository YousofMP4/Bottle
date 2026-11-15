import { useStore } from '../lib/store';
import { SHORTCUTS } from '../lib/shortcuts';
import { Dialog } from './Dialog';

export function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  const set = useStore((s) => s.set);
  return (
    <Dialog open={open} onClose={() => set({ dialog: null })} title="Keyboard shortcuts" wide>
      <div className="shortcuts">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3>{g.group}</h3>
            {g.items.map(([keys, label]) => (
              <div className="sc-row" key={label}>
                <span>{label}</span>
                <span className="sc-keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
