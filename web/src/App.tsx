import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useStore, parseHash, addVideo, uploadFrom } from './lib/store';
import { api } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { Library } from './components/Library';
import { Review } from './components/Review';
import { Projects } from './components/Projects';
import { SignIn, Join } from './components/SignIn';
import { CLOUD, auth } from './lib/cloud';

import { Toasts } from './components/Toasts';
import { SettingsDialog } from './components/Settings';
import { ShortcutsDialog } from './components/Shortcuts';
import { PasteDialog } from './components/PasteDialog';
import { TooltipLayer } from './components/Tooltip';
import { ContextMenuLayer } from './components/ContextMenu';
import { RemoveDialog } from './components/RemoveDialog';
import { view } from './lib/motion';
import { click, CLICKY, SOFT } from './lib/sfx';

/** Online, Portal sits behind a sign-in; on this Mac it opens straight away. */
export function App() {
  const [gate, setGate] = useState<'checking' | 'in' | 'login' | 'setup'>(CLOUD ? 'checking' : 'in');
  const check = () => auth.state().then((a) => { useStore.setState({ me: a.user }); setGate(a.user ? 'in' : a.setup_needed ? 'setup' : 'login'); }).catch(() => setGate('login'));
  useEffect(() => {
    if (!CLOUD) return;
    check();
    const out = () => setGate('login');
    window.addEventListener('portal:signed-out', out);
    return () => window.removeEventListener('portal:signed-out', out);
  }, []);
  const joinToken = CLOUD ? /^\/join\/(inv_[a-f0-9]+)/.exec(location.pathname)?.[1] : undefined;
  if (joinToken) return <Join token={joinToken} />;
  if (gate === 'checking') return <div className="signin" />;
  if (gate !== 'in') return <SignIn mode={gate} onDone={check} />;
  return <Workspace />;
}

function Workspace() {
  const route = useStore((s) => s.route);

  useEffect(() => {
    const s = useStore.getState();
    s.loadVideos();
    s.loadActivity();
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
          st.loadActivity();
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
    // Optional mechanical click on press (Settings → Feel). Fires on pointerdown, like a real switch.
    const onPress = (e: PointerEvent) => {
      if (e.button !== 0 || !useStore.getState().settings?.click_sound) return;
      const el = (e.target as HTMLElement)?.closest?.(CLICKY) as HTMLElement | null;
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;
      click(el.matches(SOFT));
    };
    window.addEventListener('pointerdown', onPress, true);
    // Online: drop a video file anywhere to upload it.
    const onDragOver = (e: DragEvent) => { if (CLOUD && e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!CLOUD || !f) return;
      e.preventDefault();
      if (!/^video\//.test(f.type) && !/\.(mov|mp4|m4v|webm|mkv)$/i.test(f.name)) { useStore.getState().toast({ text: 'That isn’t a video file', tone: 'error' }); return; }
      uploadFrom(f);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onPress, true); window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); es?.close(); };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Sidebar />
        <main className="main">
          <AnimatePresence mode="wait" initial={false}>
            {route.name === 'projects' ? (
              <motion.div key={`projects-${route.ws ?? ''}`} className="view" {...view}><Projects /></motion.div>
            ) : route.name === 'library' ? (
              <motion.div key={`library-${route.folder ?? ''}-${route.ws ?? ''}`} className="view" {...view}><Library /></motion.div>
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
