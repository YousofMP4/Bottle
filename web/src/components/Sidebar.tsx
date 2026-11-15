import { motion, AnimatePresence } from 'motion/react';
import { useStore, addVideo, playVideo, askRemove } from '../lib/store';
import { api } from '../lib/api';
import { showMenu } from './ContextMenu';
import { posterUrl } from '../lib/api';
import { BottleMark, IFolder, IKeyboard, ILibrary, IPlus, ISettings, ITrash, ICopy, IPlay } from './Icons';
import { spring } from '../lib/motion';
import { tip } from './Tooltip';

export function Sidebar() {
  const videos = useStore((s) => s.videos);
  const folders = useStore((s) => s.folders);
  const toast = useStore((s) => s.toast);

  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const set = useStore((s) => s.set);
  const name = useStore((s) => s.settings?.name ?? '');
  const activeId = route.name === 'review' ? route.id : null;
  const inFolder = route.name === 'library' ? route.folder ?? null : null;
  const activeTop = inFolder ? (folders.find((f) => f.id === inFolder)?.parent_id ?? inFolder) : null;

  return (
    <nav className="sidebar" aria-label="Bottle">
      <div className="brand">
        <BottleMark />
        <span className="wordmark">bottle</span>
      </div>
      <button className="nav-item" onClick={() => addVideo()} {...tip('Add video', ['⌘', 'O'], { side: 'right', when: 'collapsed' })}>
        <IPlus size={17} /> <span>Add video</span> <kbd className="nav-kbd">⌘O</kbd>
      </button>
      <button className={`nav-item ${route.name === 'library' && !inFolder ? 'active' : ''}`} data-drop-folder="" onClick={() => go({ name: 'library' })} aria-current={route.name === 'library' && !inFolder ? 'page' : undefined} {...tip('Library', undefined, { side: 'right', when: 'collapsed' })}>
        {route.name === 'library' && !inFolder && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
        <ILibrary size={17} /> <span>Library</span>
      </button>
      {folders.filter((f) => !f.parent_id).map((f) => (
        <button key={f.id} className={`nav-item folder ${activeTop === f.id ? 'active' : ''}`} data-drop-folder={f.id} onClick={() => go({ name: 'library', folder: f.id })} {...tip(f.name, undefined, { side: 'right', when: 'truncated', aria: false })}>
          {activeTop === f.id && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
          <IFolder size={16} /> <span className="nav-title">{f.name}</span>
        </button>
      ))}
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
              onContextMenu={(e) => showMenu(e, [
                { label: 'Play', icon: <IPlay size={13} />, run: () => playVideo(v.id) },
                { label: 'Show in Finder', run: () => v.latest && api.reveal(v.latest.id) },
                { label: 'Copy path', icon: <ICopy size={13} />, run: async () => { try { await navigator.clipboard.writeText(v.latest?.path ?? ''); toast({ text: 'Path copied', sub: v.latest?.path, tone: 'accent' }); } catch { toast({ text: 'Couldn’t copy the path', tone: 'error' }); } } },
                'sep',
                { label: 'Remove from library…', icon: <ITrash size={14} />, danger: true, run: () => askRemove([v.id]) },
              ])}
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
