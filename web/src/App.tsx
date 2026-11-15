import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useStore, parseHash, addVideo } from './lib/store';
import { api } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { Library } from './components/Library';
import { Review } from './components/Review';
import { Toasts } from './components/Toasts';
import { SettingsDialog } from './components/Settings';
import { ShortcutsDialog } from './components/Shortcuts';
import { PasteDialog } from './components/PasteDialog';
import { TooltipLayer } from './components/Tooltip';
import { ContextMenuLayer } from './components/ContextMenu';
import { RemoveDialog } from './components/RemoveDialog';
import { view } from './lib/motion';

export function App() {
  const route = useStore((s) => s.route);

  useEffect(() => {
    const s = useStore.getState();
    s.loadVideos();
    api.settings().then((settings) => s.set({ settings })).catch(() => {});
    api.platform().then((platform) => s.set({ platform })).catch(() => {});
    const onPop = () => useStore.setState({ route: parseHash() });
    window.addEventListener('popstate', onPop);

    // Live updates — including anything an agent does over MCP.
    let es: EventSource | null = null;
    let t = 0;
    const connect = () => {
      es = new EventSource('/api/events');
      es.addEventListener('changed', (e) => {
        clearTimeout(t);
        const data = JSON.parse((e as MessageEvent).data || '{}');
        t = window.setTimeout(() => {
          const st = useStore.getState();
          st.loadVideos();
          if (st.route.name === 'review') st.loadDetail(st.route.id);
          if (data.what === 'settings') api.settings().then((settings) => st.set({ settings }));
        }, 60);
      });
    };
    connect();

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); addVideo(); }
      if (mod && e.key === ',') { e.preventDefault(); useStore.getState().set({ dialog: 'settings' }); }
    };
    window.addEventListener('keydown', onKey);

    // Raised controls get a soft light that follows the pointer (CSS reads --mx / --my).
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('.btn, .round-btn, .pill-btn') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onMove); es?.close(); };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Sidebar />
        <main className="main">
          <AnimatePresence mode="wait" initial={false}>
            {route.name === 'library' ? (
              <motion.div key={`library-${route.folder ?? ''}`} className="view" {...view}><Library /></motion.div>
            ) : (
              <motion.div key={`review-${route.id}`} className="view" {...view}><Review id={route.id} /></motion.div>
            )}
          </AnimatePresence>
        </main>
        <Toasts />
        <SettingsDialog />
        <ShortcutsDialog />
        <PasteDialog />
        <RemoveDialog />
        <TooltipLayer />
        <ContextMenuLayer />
      </div>
    </MotionConfig>
  );
}
