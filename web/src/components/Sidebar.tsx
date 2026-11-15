import { motion, AnimatePresence } from 'motion/react';
import { useStore, openVideo } from '../lib/store';
import { posterUrl } from '../lib/api';
import { BottleMark, IKeyboard, ILibrary, IPlus, ISettings } from './Icons';
import { spring } from '../lib/motion';

export function Sidebar() {
  const videos = useStore((s) => s.videos);
  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const set = useStore((s) => s.set);
  const name = useStore((s) => s.settings?.name ?? '');
  const activeId = route.name === 'review' ? route.id : null;

  return (
    <nav className="sidebar" aria-label="Bottle">
      <div className="brand">
        <BottleMark />
        <span className="wordmark">bottle</span>
      </div>
      <button className="nav-item" onClick={() => openVideo()} title="Open a video (⌘O)">
        <IPlus size={17} /> <span>Open video</span> <kbd className="nav-kbd">⌘O</kbd>
      </button>
      <button className={`nav-item ${route.name === 'library' ? 'active' : ''}`} onClick={() => go({ name: 'library' })}>
        {route.name === 'library' && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
        <ILibrary size={17} /> <span>Library</span>
      </button>
      <div className="nav-sep" />
      <div className="nav-list">
        <AnimatePresence initial={false}>
          {videos.map((v) => (
            <motion.button
              key={v.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={spring.soft}
              className={`nav-item video ${activeId === v.id ? 'active' : ''}`}
              onClick={() => { useStore.setState({ versionId: null, draft: null, tool: null, selectedId: null }); go({ name: 'review', id: v.id }); }}
              title={v.title}
            >
              {activeId === v.id && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
              <span className="nav-thumb">{v.latest && <img src={posterUrl(v.latest.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0')} />}</span>
              <span className="nav-title">{v.title}</span>
              {v.open_count + v.draft_count > 0 && <span className="nav-count">{v.open_count + v.draft_count}</span>}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <div className="nav-foot">
        <button className="nav-item" onClick={() => set({ dialog: 'shortcuts' })}>
          <IKeyboard size={17} /> <span>Shortcuts</span> <kbd className="nav-kbd">?</kbd>
        </button>
        <button className="nav-item" onClick={() => set({ dialog: 'settings' })}>
          <span className="avatar sm">{(name || 'Y').charAt(0)}</span>
          <span className="nav-title">{name || 'You'}</span>
          <ISettings size={16} className="nav-gear" />
        </button>
      </div>
    </nav>
  );
}
