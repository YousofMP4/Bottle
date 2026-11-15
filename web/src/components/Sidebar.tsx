import { motion, AnimatePresence } from 'motion/react';
import { useStore, addVideo, playVideo } from '../lib/store';
import { posterUrl } from '../lib/api';
import { BottleMark, IKeyboard, ILibrary, IPlus, ISettings } from './Icons';
import { spring } from '../lib/motion';
import { tip } from './Tooltip';

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
      <button className="nav-item" onClick={() => addVideo()} {...tip('Add video', ['⌘', 'O'], { side: 'right', when: 'collapsed' })}>
        <IPlus size={17} /> <span>Add video</span> <kbd className="nav-kbd">⌘O</kbd>
      </button>
      <button className={`nav-item ${route.name === 'library' ? 'active' : ''}`} onClick={() => go({ name: 'library' })} aria-current={route.name === 'library' ? 'page' : undefined} {...tip('Library', undefined, { side: 'right', when: 'collapsed' })}>
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
              aria-current={activeId === v.id ? 'page' : undefined}
              onClick={() => { if (activeId !== v.id) playVideo(v.id); }}
              {...tip(v.title, undefined, { side: 'right', when: 'truncated', aria: false })}
            >
              {activeId === v.id && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
              <span className="nav-thumb">{v.latest && <img src={posterUrl(v.latest.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0')} />}</span>
              <span className="nav-title">{v.title}</span>
              {v.open_count + v.draft_count > 0 && <span className="nav-count" aria-label={`${v.open_count + v.draft_count} open`}>{v.open_count + v.draft_count}</span>}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <div className="nav-foot">
        <button className="nav-item" onClick={() => set({ dialog: 'shortcuts' })} {...tip('Keyboard shortcuts', '?', { side: 'right', when: 'collapsed' })}>
          <IKeyboard size={17} /> <span>Shortcuts</span> <kbd className="nav-kbd">?</kbd>
        </button>
        <button className="nav-item" onClick={() => set({ dialog: 'settings' })} {...tip('Settings', ['⌘', ','], { side: 'right' })}>
          <span className="avatar sm">{(name || 'Y').charAt(0)}</span>
          <span className="nav-title">{name || 'You'}</span>
          <ISettings size={16} className="nav-gear" />
        </button>
      </div>
    </nav>
  );
}
