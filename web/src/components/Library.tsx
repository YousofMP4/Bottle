import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Folder, VideoSummary } from '../../../server/types';
import { useStore, addVideo, playVideo, askRemove } from '../lib/store';
import { api, posterUrl, mediaUrl } from '../lib/api';
import { tc, ago } from '../lib/time';
import { BottleMark, IChevronRight, IFilm, IFolder, IGrid, IList, IPlay, IPlus, ISearch, ITrash, ICopy, IX } from './Icons';
import { ease, spring } from '../lib/motion';
import { tip } from './Tooltip';
import { showMenu, type MenuItem } from './ContextMenu';

type Sort = 'recent' | 'custom' | 'name' | 'duration' | 'notes';
type View = 'grid' | 'list';
const SORTS: [Sort, string][] = [['recent', 'Recently updated'], ['custom', 'Your order'], ['name', 'Name'], ['duration', 'Duration'], ['notes', 'Most notes']];

const store = {
  get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem('bottle.' + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set: (k: string, v: unknown) => { try { localStorage.setItem('bottle.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

interface Drag { kind: 'video' | 'folder'; ids: string[]; x: number; y: number; target: DropTarget | null; poster?: string }
type DropTarget = { type: 'folder'; id: string | null } | { type: 'before'; id: string; after: boolean };

export function Library() {
  const videos = useStore((s) => s.videos);
  const folders = useStore((s) => s.folders);
  const loaded = useStore((s) => s.videosLoaded);
  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const current = route.name === 'library' ? route.folder ?? null : null;
  const folder = folders.find((f) => f.id === current) ?? null;
  const parent = folder?.parent_id ? folders.find((f) => f.id === folder.parent_id) ?? null : null;

  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<Sort>(() => store.get('sort', 'recent'));
  const [view, setViewState] = useState<View>(() => store.get('view', 'grid'));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'video' | 'folder'; id: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const setSort = (s: Sort) => { setSortState(s); store.set('sort', s); };
  const setView = (v: View) => { setViewState(v); store.set('view', v); };

  // If the folder disappeared (deleted elsewhere), go back to the top level.
  useEffect(() => { if (current && loaded && folders.length && !folder) go({ name: 'library' }); }, [current, folder, loaded]);
  useEffect(() => { setSel(new Set()); }, [current]);

  const childFolders = query ? [] : folders.filter((f) => (f.parent_id ?? null) === current);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? videos.filter((v) => v.title.toLowerCase().includes(q) || (v.latest?.filename ?? '').toLowerCase().includes(q))
      : videos.filter((v) => (v.folder_id ?? null) === current);
    const by: Record<Sort, (a: VideoSummary, b: VideoSummary) => number> = {
      recent: (a, b) => b.updated_at - a.updated_at,
      custom: (a, b) => (a.position ?? 0) - (b.position ?? 0) || b.updated_at - a.updated_at,
      name: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
      duration: (a, b) => (b.latest?.duration ?? 0) - (a.latest?.duration ?? 0),
      notes: (a, b) => (b.open_count + b.draft_count) - (a.open_count + a.draft_count),
    };
    return [...list].sort(by[sort]);
  }, [videos, current, query, sort]);
  const ids = shown.map((v) => v.id);

  // ---------- keyboard: Cmd+A, Delete, Esc, / to search ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (useStore.getState().dialog || t.closest('input, textarea, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(ids)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); askRemove([...sel], () => setSel(new Set())); }
      else if (e.key === 'Escape' && sel.size) setSel(new Set());
      else if (e.key === '/' || (mod && e.key.toLowerCase() === 'f')) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'Enter' && sel.size === 1) playVideo([...sel][0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids.join(), sel]);

  // ---------- selection ----------
  const clickVideo = (e: React.MouseEvent, id: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(sel); next.has(id) ? next.delete(id) : next.add(id); setSel(next); anchor.current = id; return;
    }
    if (e.shiftKey && anchor.current) {
      const a = ids.indexOf(anchor.current), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) { setSel(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))); return; }
    }
    if (sel.size) { setSel(new Set()); }
    playVideo(id);
  };

  // ---------- actions ----------
  const newFolder = async () => {
    const parentId = folder && !folder.parent_id ? folder.id : folder?.parent_id ? null : null;
    if (folder?.parent_id) { toast({ text: 'Folders go one level deep', sub: 'Make the new folder in the top level or a top-level folder.' }); return; }
    try {
      const f = await api.createFolder('New folder', parentId);
      useStore.setState((s) => ({ folders: [...s.folders, f] }));
      setRenaming({ kind: 'folder', id: f.id });
    } catch (e: any) { toast({ text: 'Couldn’t create the folder', sub: e.message, tone: 'error' }); }
  };
  const moveTo = async (vids: string[], folderId: string | null, beforeId?: string | null) => {
    // Optimistic: move in the store first so the card leaves under your cursor, then persist.
    useStore.setState((s) => ({ videos: s.videos.map((v) => (vids.includes(v.id) ? { ...v, folder_id: folderId } : v)) }));
    try { await api.moveVideos(vids, folderId, beforeId); }
    catch (e: any) { toast({ text: 'Couldn’t move that', sub: e.message, tone: 'error' }); }
    useStore.getState().loadVideos();
    if (!beforeId) {
      const name = folderId ? folders.find((f) => f.id === folderId)?.name : 'Library';
      toast({ text: `Moved ${vids.length === 1 ? '1 video' : `${vids.length} videos`} to ${name}`, tone: 'accent' });
    }
    setSel(new Set());
  };
  const moveFolder = async (id: string, parentId: string | null) => {
    try { await api.updateFolder(id, { parent_id: parentId }); useStore.getState().loadVideos(); }
    catch (e: any) { toast({ text: 'Can’t move that folder there', sub: e.message, tone: 'error' }); }
  };
  const copyPath = async (v: VideoSummary) => {
    try { await navigator.clipboard.writeText(v.latest?.path ?? ''); toast({ text: 'Path copied', sub: v.latest?.path, tone: 'accent' }); }
    catch { toast({ text: 'Couldn’t copy the path', tone: 'error' }); }
  };
  const moveTargets = (exclude?: string | null): MenuItem[] => {
    const top = folders.filter((f) => !f.parent_id);
    const items: MenuItem[] = [{ label: 'Library (top level)', icon: <IFolder size={14} />, disabled: exclude === null, run: () => {} }];
    for (const f of top) {
      items.push({ label: f.name, icon: <IFolder size={14} />, disabled: exclude === f.id, run: () => {} });
      for (const c of folders.filter((x) => x.parent_id === f.id)) items.push({ label: `   ${c.name}`, icon: <IFolder size={14} />, disabled: exclude === c.id, run: () => {} });
    }
    return items;
  };
  const videoMenu = (v: VideoSummary): MenuItem[] => {
    const group = sel.has(v.id) && sel.size > 1 ? [...sel] : [v.id];
    const many = group.length > 1;
    const targets = moveTargets(many ? undefined : (v.folder_id ?? null)).map((it, i) => {
      if (it === 'sep') return it;
      const top = folders.filter((f) => !f.parent_id);
      const flat: (string | null)[] = [null];
      for (const f of top) { flat.push(f.id); for (const c of folders.filter((x) => x.parent_id === f.id)) flat.push(c.id); }
      return { ...it, run: () => moveTo(group, flat[i]) };
    });
    return [
      ...(many ? [] : [{ label: 'Play', icon: <IPlay size={13} />, kbd: '↩', run: () => playVideo(v.id) } as MenuItem]),
      ...(many ? [] : [{ label: 'Rename', kbd: '', run: () => setRenaming({ kind: 'video', id: v.id }) } as MenuItem]),
      { label: many ? `Move ${group.length} videos to…` : 'Move to…', icon: <IFolder size={14} />, submenu: targets },
      'sep',
      ...(many ? [] : [
        { label: 'Show in Finder', run: () => v.latest && api.reveal(v.latest.id) } as MenuItem,
        { label: 'Copy path', icon: <ICopy size={13} />, run: () => copyPath(v) } as MenuItem,
        'sep' as MenuItem,
      ]),
      { label: many ? `Remove ${group.length} from library…` : 'Remove from library…', icon: <ITrash size={14} />, kbd: '⌫', danger: true, run: () => askRemove(group, () => setSel(new Set())) },
    ];
  };
  const folderMenu = (f: Folder): MenuItem[] => {
    const kids = folders.some((x) => x.parent_id === f.id);
    const tops = folders.filter((x) => !x.parent_id && x.id !== f.id);
    return [
      { label: 'Open', run: () => go({ name: 'library', folder: f.id }) },
      { label: 'Rename', run: () => setRenaming({ kind: 'folder', id: f.id }) },
      ...(!f.parent_id ? [{ label: 'New folder inside', icon: <IPlus size={13} />, run: async () => { const c = await api.createFolder('New folder', f.id); await useStore.getState().loadVideos(); go({ name: 'library', folder: f.id }); setRenaming({ kind: 'folder', id: c.id }); } } as MenuItem] : []),
      {
        label: 'Move to…', icon: <IFolder size={14} />, disabled: kids && !f.parent_id, hint: 'Folders with folders inside stay at the top level',
        submenu: [
          { label: 'Library (top level)', disabled: !f.parent_id, run: () => moveFolder(f.id, null) },
          ...tops.map((t) => ({ label: t.name, icon: <IFolder size={14} />, disabled: t.id === f.parent_id, run: () => moveFolder(f.id, t.id) } as MenuItem)),
        ],
      },
      'sep',
      { label: 'Delete folder (keeps videos)', icon: <ITrash size={14} />, danger: true, run: async () => {
        await api.deleteFolder(f.id); useStore.getState().loadVideos();
        toast({ text: `Deleted “${f.name}”`, sub: 'Its videos moved up a level. Nothing was removed.' });
      } },
    ];
  };
  const emptyMenu = (): MenuItem[] => [
    { label: 'Add video…', icon: <IPlus size={13} />, kbd: '⌘O', run: () => addVideo() },
    { label: 'New folder', icon: <IFolder size={14} />, disabled: !!folder?.parent_id, hint: 'Folders go one level deep', run: newFolder },
    'sep',
    { label: 'Select all', kbd: '⌘A', disabled: !ids.length, run: () => setSel(new Set(ids)) },
  ];

  // ---------- drag & drop (pointer-based, so we control the ghost and the drop highlights) ----------
  const startPointer = (e: React.PointerEvent, kind: 'video' | 'folder', id: string, poster?: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, button.inline-action')) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const group = kind === 'video' && sel.has(id) ? [...sel] : [id];
    const targetAt = (x: number, y: number): DropTarget | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const f = el?.closest('[data-drop-folder]') as HTMLElement | null;
      if (f) {
        const fid = f.dataset.dropFolder || null;
        if (kind === 'folder' && fid === id) return null;
        return { type: 'folder', id: fid };
      }
      const v = el?.closest('[data-drop-video]') as HTMLElement | null;
      if (v && kind === 'video' && !query && !group.includes(v.dataset.dropVideo!)) {
        const r = v.getBoundingClientRect();
        const after = view === 'grid' ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
        return { type: 'before', id: v.dataset.dropVideo!, after };
      }
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
        document.documentElement.dataset.dragCursor = 'move';
        if (kind === 'video' && !sel.has(id)) setSel(new Set());
      }
      setDrag({ kind, ids: group, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY), poster });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!started) return;
      delete document.documentElement.dataset.dragCursor;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const t = targetAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (!t) return;
      if (kind === 'folder') { if (t.type === 'folder') moveFolder(id, t.id); return; }
      if (t.type === 'folder') { if (t.id !== current) moveTo(group, t.id); return; }
      // Reorder within this folder: switch to "Your order" so the drop sticks visibly.
      const idx = ids.indexOf(t.id);
      const beforeId = t.after ? ids.slice(idx + 1).find((x) => !group.includes(x)) ?? null : t.id;
      if (sort !== 'custom') {
        // Freeze the current visual order as the manual order first, then apply the move.
        api.moveVideos(ids, current, null).then(() => api.moveVideos(group, current, beforeId)).then(() => useStore.getState().loadVideos());
        setSort('custom');
        toast({ text: 'Sorted by your order', sub: 'Drag cards to arrange them. Change it any time from Sort.' });
      } else {
        // Optimistic reorder for instant feedback.
        const others = shown.filter((v) => !group.includes(v.id));
        let at = beforeId ? others.findIndex((v) => v.id === beforeId) : others.length;
        if (at < 0) at = others.length;
        const order = [...others.slice(0, at).map((v) => v.id), ...group, ...others.slice(at).map((v) => v.id)];
        useStore.setState((s) => ({ videos: s.videos.map((v) => (order.includes(v.id) ? { ...v, position: order.indexOf(v.id) } : v)) }));
        api.moveVideos(group, current, beforeId).then(() => useStore.getState().loadVideos());
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const isTarget = (t: DropTarget) => !!drag?.target && drag.target.type === t.type && drag.target.id === t.id && (t.type !== 'before' || (drag.target as any).after === (t as any).after);

  if (loaded && videos.length === 0 && folders.length === 0) return <Empty />;

  return (
    <div className={`library ${drag ? 'dragging' : ''}`}>
      <header className="topbar lib-top">
        <nav className="crumbs" aria-label="Folders">
          <button className={`crumb ${!current ? 'crumb-here' : ''} ${isTarget({ type: 'folder', id: null }) ? 'drop-hot' : ''}`} data-drop-folder="" onClick={() => go({ name: 'library' })}>Library</button>
          {parent && <><IChevronRight size={14} className="crumb-sep" /><button className={`crumb ${isTarget({ type: 'folder', id: parent.id }) ? 'drop-hot' : ''}`} data-drop-folder={parent.id} onClick={() => go({ name: 'library', folder: parent.id })}>{parent.name}</button></>}
          {folder && <><IChevronRight size={14} className="crumb-sep" /><span className="crumb crumb-here">{folder.name}</span></>}
        </nav>
        <div className="topbar-right">
          <label className="search">
            <ISearch size={15} />
            <input ref={searchRef} value={query} placeholder="Search" aria-label="Search videos" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur(); } }} />
            {query ? <button className="search-clear" onClick={() => setQuery('')} {...tip('Clear search', 'Esc')}><IX size={12} /></button> : <kbd className="keycap">/</kbd>}
          </label>
          <SortMenu sort={sort} setSort={setSort} />
          <div className="seg view-seg" role="radiogroup" aria-label="View">
            {(['grid', 'list'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={view === v} className={`seg-btn icon ${view === v ? 'on' : ''}`} onClick={() => setView(v)} {...tip(v === 'grid' ? 'Grid' : 'List', undefined, { side: 'bottom' })}>
                {view === v && <motion.span layoutId="view-active" className="seg-active" transition={spring.morph} />}
                <span className="seg-label">{v === 'grid' ? <IGrid size={15} /> : <IList size={15} />}</span>
              </button>
            ))}
          </div>
          <button className="round-btn" onClick={newFolder} aria-disabled={!!folder?.parent_id} {...tip(folder?.parent_id ? 'Folders go one level deep' : 'New folder', undefined, { side: 'bottom' })}><IFolderPlus /></button>
          <button className="btn primary" onClick={() => addVideo()} {...tip(folder ? `Add a video to “${folder.name}”` : 'Add a video from this Mac', ['⌘', 'O'], { side: 'bottom', aria: false })}>
            <IPlus size={16} /> Add video
          </button>
        </div>
      </header>

      <div className="lib-scroll" onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('lib-body')) setSel(new Set()); }} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest('[data-drop-video], .folder-tile')) showMenu(e, emptyMenu()); }}>
        <div className="lib-body">
          {query && <p className="lib-note">{shown.length ? `${shown.length} result${shown.length === 1 ? '' : 's'} in your whole library` : `Nothing matches “${query}”.`}</p>}

          {childFolders.length > 0 && (
            <section className="folders" aria-label="Folders">
              {childFolders.map((f) => {
                const count = videos.filter((v) => v.folder_id === f.id).length + folders.filter((x) => x.parent_id === f.id).length;
                const thumbs = videos.filter((v) => v.folder_id === f.id).slice(0, 3);
                return (
                  <motion.div
                    key={f.id}
                    layout
                    className={`folder-tile ${isTarget({ type: 'folder', id: f.id }) ? 'drop-hot' : ''} ${drag?.kind === 'folder' && drag.ids[0] === f.id ? 'lifted' : ''}`}
                    data-drop-folder={f.id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => startPointer(e, 'folder', f.id)}
                    onClick={() => { if (suppressClick.current) return; go({ name: 'library', folder: f.id }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'library', folder: f.id }); }}
                    onContextMenu={(e) => showMenu(e, folderMenu(f))}
                    transition={spring.soft}
                  >
                    <div className="folder-art">
                      <div className="folder-back" />
                      {thumbs.map((v, i) => v.latest && <img key={v.id} src={posterUrl(v.latest.id)} alt="" style={{ ['--i' as any]: i }} />)}
                      <div className="folder-front"><IFolder size={18} /></div>
                    </div>
                    {renaming?.kind === 'folder' && renaming.id === f.id
                      ? <RenameInput value={f.name} onDone={async (name) => { setRenaming(null); if (name && name !== f.name) { await api.updateFolder(f.id, { name }); useStore.getState().loadVideos(); } }} />
                      : <div className="folder-name">{f.name}</div>}
                    <div className="folder-meta">{count} item{count === 1 ? '' : 's'}</div>
                  </motion.div>
                );
              })}
            </section>
          )}

          {shown.length === 0 && !query && (
            <div className="lib-empty" onContextMenu={(e) => showMenu(e, emptyMenu())}>
              <div className="lib-empty-art"><IFilm size={22} /></div>
              <p className="pe-title">{folder ? `“${folder.name}” is empty` : 'No videos here yet'}</p>
              <p className="dim">Drag videos here, or <button className="link" onClick={() => addVideo()}>add one from this Mac</button>.</p>
            </div>
          )}

          {shown.length > 0 && (
            <section className={view === 'grid' ? 'lib-grid' : 'lib-list'} aria-label="Videos" aria-multiselectable>
              {view === 'list' && (
                <div className="lib-list-head" aria-hidden><span /><span>Name</span><span>Notes</span><span>Length</span><span>Updated</span></div>
              )}
              <AnimatePresence initial={false}>
                {shown.map((v, i) => {
                  const selected = sel.has(v.id);
                  const lifted = drag?.kind === 'video' && drag.ids.includes(v.id);
                  const hotBefore = isTarget({ type: 'before', id: v.id, after: false });
                  const hotAfter = isTarget({ type: 'before', id: v.id, after: true });
                  const folderName = query && v.folder_id ? folders.find((f) => f.id === v.folder_id)?.name : null;
                  const common = {
                    'data-drop-video': v.id,
                    'aria-selected': selected,
                    onPointerDown: (e: React.PointerEvent) => startPointer(e, 'video', v.id, v.latest ? posterUrl(v.latest.id) : undefined),
                    onClick: (e: React.MouseEvent) => clickVideo(e, v.id),
                    onContextMenu: (e: React.MouseEvent) => { if (!sel.has(v.id)) setSel(new Set()); showMenu(e, videoMenu(v)); },
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') playVideo(v.id); },
                  };
                  const title = renaming?.kind === 'video' && renaming.id === v.id
                    ? <RenameInput value={v.title} onDone={async (t) => { setRenaming(null); if (t && t !== v.title) { await api.rename(v.id, t); useStore.getState().loadVideos(); } }} />
                    : <div className="card-title">{v.title}</div>;
                  const notes = (
                    <>
                      {v.draft_count > 0 && <span className="led-meta" {...tip(`${v.draft_count} not sent to your agent yet`, undefined, { aria: false })}><i className="led amber" />{v.draft_count} unsent</span>}
                      {v.open_count > 0 && <span className="led-meta" {...tip(`${v.open_count} sent and still open`, undefined, { aria: false })}><i className="led on" />{v.open_count} open</span>}
                    </>
                  );
                  return view === 'grid' ? (
                    <motion.div
                      key={v.id}
                      layout="position"
                      role="option"
                      tabIndex={0}
                      className={`card ${selected ? 'selected' : ''} ${lifted ? 'lifted' : ''} ${hotBefore ? 'drop-before' : ''} ${hotAfter ? 'drop-after' : ''}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.025, duration: 0.28, ease } }}
                      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                      transition={spring.soft}
                      {...(common as any)}
                    >
                      <div className="card-media">
                        {v.latest && <img src={posterUrl(v.latest.id)} alt="" loading="lazy" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                        <div className="card-fallback"><IFilm size={26} /></div>
                        {v.latest && !drag && <HoverScrub versionId={v.latest.id} duration={v.latest.duration} />}
                        <div className="card-play"><IPlay size={18} /></div>
                        <span className="card-badge mono">v{v.latest?.number ?? 1}</span>
                        {v.latest && <span className="card-dur">{tc(v.latest.duration)}</span>}
                        {v.latest?.missing && <span className="card-missing">File moved</span>}
                        <span className="card-check" aria-hidden />
                      </div>
                      <div className="card-body">
                        {title}
                        <div className="card-meta">
                          {folderName && <span className="chip-mini"><IFolder size={11} /> {folderName}</span>}
                          {notes}
                          <span className="dim">{ago(v.updated_at)}</span>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={v.id}
                      layout="position"
                      role="option"
                      tabIndex={0}
                      className={`row-item ${selected ? 'selected' : ''} ${lifted ? 'lifted' : ''} ${hotBefore ? 'drop-before' : ''} ${hotAfter ? 'drop-after' : ''}`}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={spring.soft}
                      {...(common as any)}
                    >
                      <span className="row-thumb">{v.latest && <img src={posterUrl(v.latest.id)} alt="" draggable={false} />}{v.latest && !drag && <HoverScrub versionId={v.latest.id} duration={v.latest.duration} compact />}<span className="card-badge mono">v{v.latest?.number ?? 1}</span></span>
                      <span className="row-name">{title}{folderName && <span className="dim small"> · {folderName}</span>}</span>
                      <span className="row-notes">{notes}</span>
                      <span className="mono dim">{v.latest ? tc(v.latest.duration) : '–'}</span>
                      <span className="dim">{ago(v.updated_at)}</span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </section>
          )}
        </div>
      </div>

      <AnimatePresence>
        {sel.size > 0 && !drag && (
          <motion.div className="selbar" initial={{ y: 20, opacity: 0, x: '-50%' }} animate={{ y: 0, opacity: 1, x: '-50%' }} exit={{ y: 12, opacity: 0, x: '-50%' }} transition={spring.toast}>
            <span className="selbar-count"><i className="led on" />{sel.size} selected</span>
            <button className="pill-btn" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const v = shown.find((x) => sel.has(x.id))!; const m = videoMenu(v).find((it) => it !== 'sep' && (it as any).submenu) as any; showMenu({ clientX: r.left, clientY: r.top - 8 - 36 * (m.submenu.length) }, m.submenu); }}>Move to…</button>
            <button className="pill-btn danger" onClick={() => askRemove([...sel], () => setSel(new Set()))} {...tip('Remove from library', '⌫', { aria: false })}>Remove…</button>
            <button className="icon-btn" onClick={() => setSel(new Set())} {...tip('Clear selection', 'Esc')}><IX size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {drag && <DragGhost drag={drag} folders={folders} videos={videos} />}
    </div>
  );
}

/**
 * Hover-scrub: move the cursor left/right across a thumbnail to preview that moment.
 * A muted <video> is created on first hover only, and seeks are kept to one in flight
 * (always jumping to the latest cursor position) so it keeps up with fast movement.
 */
function HoverScrub({ versionId, duration, compact }: { versionId: string; duration: number; compact?: boolean }) {
  const [frac, setFrac] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const want = useRef(-1);
  const pump = () => {
    const v = vid.current;
    if (!v || v.seeking || want.current < 0 || v.readyState < 1) return;
    const w = want.current; want.current = -1;
    if (Math.abs(v.currentTime - w) > 0.01) v.currentTime = w; else setShown(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.buttons) return; // a drag is starting: leave it alone
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = clamp01((e.clientX - r.left) / r.width);
    setFrac(f);
    want.current = Math.min(Math.max(0, duration - 0.05), f * duration);
    pump();
  };
  return (
    <div className={`scrub ${frac !== null ? 'on' : ''} ${compact ? 'compact' : ''}`} onPointerMove={onMove} onPointerLeave={() => { setFrac(null); setShown(false); want.current = -1; }} aria-hidden>
      {frac !== null && (
        <>
          <video
            ref={vid}
            className="scrub-video"
            src={mediaUrl(versionId)}
            muted
            playsInline
            preload="auto"
            style={{ opacity: shown ? 1 : 0 }}
            onLoadedMetadata={pump}
            onSeeked={() => { setShown(true); pump(); }}
          />
          <span className="scrub-bar"><i style={{ transform: `scaleX(${frac})` }} /></span>
          {!compact && <span className="scrub-time mono">{tc(frac * duration)}</span>}
        </>
      )}
    </div>
  );
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function DragGhost({ drag, folders, videos }: { drag: Drag; folders: Folder[]; videos: VideoSummary[] }) {
  const label = drag.kind === 'folder'
    ? folders.find((f) => f.id === drag.ids[0])?.name
    : drag.ids.length > 1 ? `${drag.ids.length} videos` : videos.find((v) => v.id === drag.ids[0])?.title;
  const where = drag.target?.type === 'folder' ? (drag.target.id ? folders.find((f) => f.id === drag.target!.id)?.name : 'Library') : null;
  return (
    <motion.div className="drag-ghost" style={{ left: drag.x, top: drag.y }} initial={{ scale: 0.8, opacity: 0, rotate: 0 }} animate={{ scale: 1, opacity: 1, rotate: -3 }} transition={spring.pop}>
      {drag.kind === 'video' && drag.poster ? <img src={drag.poster} alt="" /> : <span className="drag-ghost-ic"><IFolder size={16} /></span>}
      <span className="drag-ghost-label">{label}{where && <span className="dim"> → {where}</span>}</span>
      {drag.ids.length > 1 && <span className="drag-ghost-count">{drag.ids.length}</span>}
    </motion.div>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (v: string) => { if (done.current) return; done.current = true; onDone(v.trim()); };
  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={value}
      aria-label="Name"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish((e.target as HTMLInputElement).value); if (e.key === 'Escape') finish(value); }}
    />
  );
}

function SortMenu({ sort, setSort }: { sort: Sort; setSort: (s: Sort) => void }) {
  return (
    <button
      className="pill-btn sort-btn"
      aria-haspopup="menu"
      onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu({ clientX: r.left, clientY: r.bottom + 6 }, SORTS.map(([id, label]) => ({ label, icon: <span className={`radio-mini ${sort === id ? 'on' : ''}`} />, run: () => setSort(id) }))); }}
      {...tip('Sort', undefined, { side: 'bottom' })}
    >
      {SORTS.find(([id]) => id === sort)?.[1]} <IChevronDownSmall />
    </button>
  );
}

const IChevronDownSmall = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>;
const IFolderPlus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></svg>;

function Empty() {
  return (
    <div className="empty-hero" onContextMenu={(e) => showMenu(e, [
      { label: 'Add video…', icon: <IPlus size={13} />, kbd: '⌘O', run: () => addVideo() },
      { label: 'New folder', icon: <IFolder size={14} />, run: async () => { await api.createFolder('New folder', null); useStore.getState().loadVideos(); } },
    ])}>
      <motion.div className="empty-mark" initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ ...spring.pop, delay: 0.05 }}>
        <div className="empty-glow" />
        <BottleMark size={56} />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.6, ease }}>
        Review a cut. <span className="dim">Hand it back.</span>
      </motion.h1>
      <motion.p className="empty-sub" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6, ease }}>
        Add any video on this Mac to your library. Draw on frames, talk over it, pin notes to the
        exact moment, then send it all to your agent. Your files stay where they are.
      </motion.p>
      <motion.div className="empty-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.6, ease }}>
        <button className="btn primary lg" onClick={() => addVideo()}>
          <IPlus size={18} /> Add video <kbd className="kbd-inline">⌘O</kbd>
        </button>
      </motion.div>
      <motion.div className="empty-agent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.8 }}>
        <span className="dim">or let your agent add one:</span> <code>add_video("/path/to/cut.mp4")</code>
        <button className="link" onClick={() => useStore.getState().set({ dialog: 'settings' })}>Connect to Claude →</button>
      </motion.div>
    </div>
  );
}
