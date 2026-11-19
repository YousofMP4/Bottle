import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore, addVideo, playVideo, askRemove, useIsClient } from '../lib/store';
import { api } from '../lib/api';
import { showMenu } from './ContextMenu';
import { posterUrl } from '../lib/api';
import { Notifications } from './Notifications';
import { IBoard, PortalMark, Wordmark, IFolder, IKeyboard, ILibrary, IChevronRight, ISettings, ITrash, ICopy, IPlay } from './Icons';
import { spring } from '../lib/motion';
import { tip } from './Tooltip';
import { AddVideoIcon, useAddBusy } from './AddVideoIcon';
import { CLOUD } from '../lib/cloud';
import { downloadVersion } from '../lib/cloud';
import { IDownload } from './Icons';
import { dropVideosOnWorkspace, moveVideosInto } from '../lib/dropVideos';

export function Sidebar() {
  const picking = useStore((s) => s.picking);
  const busy = useAddBusy();
  const videos = useStore((s) => s.videos);
  const folders = useStore((s) => s.folders);
  const toast = useStore((s) => s.toast);

  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const set = useStore((s) => s.set);
  const name = useStore((s) => s.settings?.name ?? '');
  const activeId = route.name === 'review' ? route.id : null;
  const client = useIsClient();
  const dragged = useRef(false);
  /** Drag a video from the list onto a folder (sidebar or Library) like in a file explorer. */
  const dragVideo = (e: React.PointerEvent, id: string, title: string, poster?: string) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost: HTMLDivElement | null = null;
    const targetAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return (el?.closest('[data-drop-folder], [data-drop-workspace]') as HTMLElement | null) ?? null;
    };
    const clear = () => document.querySelectorAll('[data-drop-hot]').forEach((n) => n.removeAttribute('data-drop-hot'));
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = `${poster ? `<img src="${poster}" alt="">` : ''}<span class="drag-ghost-label"></span>`;
        (ghost.querySelector('.drag-ghost-label') as HTMLElement).textContent = title;
        document.body.appendChild(ghost);
        document.documentElement.dataset.dragCursor = 'move';
        document.documentElement.dataset.dragging = 'video';
      }
      ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`;
      clear();
      targetAt(ev.clientX, ev.clientY)?.setAttribute('data-drop-hot', '');
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return;
      ghost.remove(); clear(); delete document.documentElement.dataset.dragCursor; delete document.documentElement.dataset.dragging;
      dragged.current = true; setTimeout(() => { dragged.current = false; }, 0);
      const t = targetAt(ev.clientX, ev.clientY);
      if (!t) return;
      if (t.dataset.dropWorkspace) { dropVideosOnWorkspace([id], t.dataset.dropWorkspace, { x: ev.clientX, y: ev.clientY }); return; }
      moveVideosInto([id], t.dataset.dropFolder || null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const inFolder = route.name === 'library' ? route.folder ?? null : null;
  const activeTop = inFolder ? (folders.find((f) => f.id === inFolder)?.parent_id ?? inFolder) : null;
  const topFolders = folders.filter((f) => !f.parent_id);
  const workspaces = useStore((s) => s.workspaces);
  const activeProjects = topFolders.filter((f) => f.status === 'working' || f.status === 'revising').length;
  // Folders live under Library, open by default; the arrow next to Library folds them away (remembered).
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('portal.nav.folders') !== 'closed'; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem('portal.nav.folders', o ? 'closed' : 'open'); } catch {} return !o; });
  // The icon-only sidebar (narrow windows) has no room for the arrow, so folders always show there.
  const narrow = useNarrow();
  const shown = open || narrow;
  // With the folders folded away, the folder you are in shows on Library instead.
  const libActive = route.name === 'library' && (!inFolder || !shown);

  return (
    <nav className="sidebar" aria-label="Portal">
      <div className="brand">
        <button className="brand-home" onClick={() => go({ name: 'library' })} aria-label="Portal, go to Library">
          <span className="brand-mark"><PortalMark size={28} /></span>
          <span className="wordmark"><Wordmark height={30} /></span>
        </button>
        <Notifications />
      </div>
      <button className="nav-item nav-add" onClick={() => addVideo()} {...busy} {...tip('Add video', ['⌘', 'O'], { side: 'right', when: 'collapsed' })}>
        <AddVideoIcon size={17} /> <span>{picking ? 'Opening Finder…' : 'Add video'}</span> <kbd className="nav-kbd">⌘O</kbd>
      </button>
      <button className={`nav-item nav-projects ${route.name === 'projects' && !route.ws ? 'active' : ''}`} onClick={() => go({ name: 'projects' })} aria-current={route.name === 'projects' ? 'page' : undefined} {...tip(CLOUD ? 'Workspaces' : 'Projects', undefined, { side: 'right', when: 'collapsed' })}>
 {route.name === 'projects' && !route.ws && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
        <IBoard size={17} /> <span className="nav-title">{CLOUD ? 'Workspaces' : 'Projects'}</span>
        {activeProjects > 0 && <span className="nav-count plain" aria-label={`${activeProjects} in progress`}>{activeProjects}</span>}
      </button>
      {CLOUD && workspaces.length > 0 && !narrow && (
        <div className="nav-folders nav-ws" role="group" aria-label="Workspaces">
          {workspaces.map((w) => {
            const on = (route.name === 'projects' || route.name === 'library') && route.ws === w.id;
            return (
              <button key={w.id} className={`nav-item folder ${on ? 'active' : ''}`} data-drop-workspace={w.id} onClick={() => go({ name: 'library', ws: w.id })} {...tip(w.name, undefined, { side: 'right', when: 'truncated', aria: false })}>
                {on && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
                <span className="ws-dot">{w.name.charAt(0)}</span> <span className="nav-title">{w.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className={`nav-lib ${topFolders.length ? 'has-folders' : ''}`}>
        <button className={`nav-item ${libActive ? 'active' : ''}`} data-drop-folder="" onClick={() => go({ name: 'library' })} aria-current={route.name === 'library' && !inFolder ? 'page' : undefined} {...tip('Library', undefined, { side: 'right', when: 'collapsed' })}>
          {libActive && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
          <ILibrary size={17} /> <span className="nav-title">Library</span>
        </button>
        {topFolders.length > 0 && (
          <button className={`nav-disclose ${open ? 'open' : ''}`} onClick={toggle} aria-expanded={open} aria-controls="nav-folders" {...tip(open ? 'Hide folders' : 'Show folders', undefined, { side: 'right' })}>
            <IChevronRight size={14} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {shown && topFolders.length > 0 && (
          <motion.div
            id="nav-folders"
            key="folders"
            className="nav-folders"
            role="group"
            aria-label="Folders"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            {topFolders.map((f) => (
              <button key={f.id} className={`nav-item folder ${activeTop === f.id ? 'active' : ''}`} data-drop-folder={f.id} onClick={() => go({ name: 'library', folder: f.id })} {...tip(f.name, undefined, { side: 'right', when: 'truncated', aria: false })}>
                {activeTop === f.id && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
                <IFolder size={15} /> <span className="nav-title">{f.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
              onClick={() => { if (dragged.current) { dragged.current = false; return; } if (activeId !== v.id) playVideo(v.id); }}
              onPointerDown={(e) => { if (!client) dragVideo(e, v.id, v.title, v.latest ? posterUrl(v.latest.id) : undefined); }}
              onContextMenu={(e) => showMenu(e, [
                { label: 'Play', icon: <IPlay size={13} />, run: () => playVideo(v.id) },
                ...(CLOUD && v.latest ? [{ label: `Download v${v.latest.number}`, icon: <IDownload size={14} />, run: () => downloadVersion(v.latest!.id) }] : []),
                ...(CLOUD ? [] : [{ label: 'Show in Finder', run: () => v.latest && api.reveal(v.latest.id) }]),
                ...(CLOUD ? [] : [{ label: 'Copy path', icon: <ICopy size={13} />, run: async () => { try { await navigator.clipboard.writeText(v.latest?.path ?? ''); toast({ text: 'Path copied', sub: v.latest?.path, tone: 'accent' }); } catch { toast({ text: 'Couldn’t copy the path', tone: 'error' }); } } }]),
                'sep',
                { label: 'Remove from library…', icon: <ITrash size={14} />, danger: true, run: () => askRemove([v.id]) },
              ])}
              {...tip(v.title, undefined, { side: 'right', when: 'truncated', aria: false })}
            >
              {activeId === v.id && <motion.span layoutId="nav-active" className="nav-active" transition={spring.morph} />}
              <span className={`nav-thumb ${v.revising_at && client ? 'revising' : ''}`}>{v.latest && <img src={posterUrl(v.latest.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0')} />}</span>
              <span className="nav-title">{v.title}</span>
              {v.open_count + v.draft_count > 0 && <span className="nav-count" aria-label={`${v.open_count + v.draft_count} open`}>{v.open_count + v.draft_count}</span>}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <div className="nav-foot">
        <button className="nav-item nav-shortcuts" onClick={() => set({ dialog: 'shortcuts' })} {...tip('Keyboard shortcuts', '?', { side: 'right', when: 'collapsed' })}>
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

function useNarrow() {
  const q = '(max-width: 960px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
