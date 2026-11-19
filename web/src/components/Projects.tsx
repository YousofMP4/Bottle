import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Folder, ProjectStatus } from '../../../server/types';
import { COLUMN_TITLE, DONE_PRUNE_DAYS, PROJECT_STATUSES, STATUS_LABEL } from '../../../server/types';
import { useStore, useIsClient } from '../lib/store';
import { CLOUD, workspacesApi, type Members } from '../lib/cloud';
import { Dialog } from './Dialog';
import { api, posterUrl } from '../lib/api';
import { ago } from '../lib/time';
import { showMenu, type MenuItem } from './ContextMenu';
import { IFolder, ILinkSm, IPlus, ITrash, IArrowRight, IPeople, ICopy, ICheck } from './Icons';
import { tip } from './Tooltip';
import { spring } from '../lib/motion';

const HINT: Record<ProjectStatus, string> = {
  ready: 'Briefed and waiting',
  working: 'Being edited',
  revising: 'Client revisions in progress',
  done: 'Delivered. Overlays and other unessential files get deleted; old versions leave Portal after 7 days.',
};

/** Change a project's stage (optionally its position) with an optimistic update. */
export async function moveProject(id: string, status: ProjectStatus, position?: number) {
  const st = useStore.getState();
  const prev = st.folders;
  const f = prev.find((x) => x.id === id);
  if (!f || (f.status === status && position === undefined)) return;
  st.set({ folders: prev.map((x) => (x.id === id ? { ...x, status, position: position ?? x.position, status_at: x.status === status ? x.status_at : Date.now() } : x)) });
  try { await api.updateFolder(id, { status, ...(position !== undefined ? { position } : {}) }); }
  catch (e: any) { st.set({ folders: prev }); st.toast({ text: 'Couldn’t move that project', sub: e.message, tone: 'error' }); return; }
  if (f.status !== status) {
    st.toast({ text: `“${f.name}” moved to ${STATUS_LABEL[status]}`, action: { label: 'Undo', run: () => moveProject(id, f.status, f.position) } });
  }
  st.loadVideos();
}

export function Projects() {
  const folders = useStore((s) => s.folders);
  const route = useStore((s) => s.route);
  const workspaces = useStore((s) => s.workspaces);
  const me = useStore((s) => s.me);
  const client = useIsClient();
  const wsId = route.name === 'projects' ? route.ws : undefined;
  const ws = workspaces.find((w) => w.id === wsId) ?? null;
  const [people, setPeople] = useState(false);
  const [tabHot, setTabHot] = useState<string | null>(null);
  const videos = useStore((s) => s.videos);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: ProjectStatus; before: string | null } | null>(null);

  const projects = folders.filter((f) => !f.parent_id && (!ws || f.workspace_id === ws.id));
  const wsName = (id?: string | null) => workspaces.find((w) => w.id === id)?.name;
  const byStatus = (s: ProjectStatus) => projects.filter((p) => p.status === s).sort((a, b) => a.position - b.position || a.created_at - b.created_at);
  const inside = (f: Folder) => {
    const ids = new Set([f.id, ...folders.filter((c) => c.parent_id === f.id).map((c) => c.id)]);
    return videos.filter((v) => v.folder_id && ids.has(v.folder_id));
  };

  const create = async (status: ProjectStatus) => {
    try {
      const f = await api.createFolder('New project', null, status, ws?.id ?? null);
      useStore.setState((s) => ({ folders: [...s.folders, f] }));
      setRenaming(f.id);
      useStore.getState().loadVideos();
    } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
  };
  const rename = async (f: Folder, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === f.name) return;
    useStore.setState((s) => ({ folders: s.folders.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)) }));
    try { await api.updateFolder(f.id, { name: name.trim() }); } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
    useStore.getState().loadVideos();
  };
  const remove = async (f: Folder) => {
    try { await api.deleteFolder(f.id); useStore.getState().loadVideos(); toast({ text: `Deleted “${f.name}”`, sub: 'Its videos are back in the Library. Nothing was removed from your disk.' }); }
    catch (e: any) { toast({ text: e.message, tone: 'error' }); }
  };
  const menu = (f: Folder): MenuItem[] => client ? [
    { label: 'Open', icon: <IFolder size={14} />, run: () => go({ name: 'library', folder: f.id }) },
  ] : [
    { label: 'Open', icon: <IFolder size={14} />, run: () => go({ name: 'library', folder: f.id }) },
    { label: 'Rename', run: () => setRenaming(f.id) },
    ...(CLOUD && workspaces.length ? [{ label: 'Workspace', submenu: [{ label: 'None', disabled: !f.workspace_id, run: () => setWorkspace(f, null) }, ...workspaces.map((w) => ({ label: w.name, disabled: f.workspace_id === w.id, run: () => setWorkspace(f, w.id) }))] } as MenuItem] : []),
    { label: 'Move to', icon: <IArrowRight size={14} />, submenu: PROJECT_STATUSES.map((s) => ({ label: STATUS_LABEL[s], disabled: s === f.status, run: () => moveProject(f.id, s) })) },
    'sep',
    { label: 'Delete project…', icon: <ITrash size={14} />, danger: true, hint: 'Videos move back to the Library', run: () => { if (confirm(`Delete the project “${f.name}”?\n\nIts videos stay in your Library and on your disk.`)) remove(f); } },
  ];

  const setWorkspace = async (f: Folder, id: string | null) => {
    useStore.setState((s) => ({ folders: s.folders.map((x) => (x.id === f.id ? { ...x, workspace_id: id } : x)) }));
    try { await api.updateFolder(f.id, { workspace_id: id }); } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
    useStore.getState().loadVideos();
  };
  const newWorkspace = async () => {
    const name = prompt('Client or company name (e.g. First Mention)');
    if (!name?.trim()) return;
    try { const w = await workspacesApi.create(name.trim()); await useStore.getState().loadVideos(); go({ name: 'projects', ws: w.id }); }
    catch (e: any) { toast({ text: e.message, tone: 'error' }); }
  };
  const wsMenu = (id: string): MenuItem[] => [
    { label: 'Rename…', run: async () => { const w = workspaces.find((x) => x.id === id); const n = prompt('Rename workspace', w?.name); if (n?.trim()) { await workspacesApi.rename(id, n.trim()).catch((e) => toast({ text: e.message, tone: 'error' })); useStore.getState().loadVideos(); } } },
    'sep',
    { label: 'Delete workspace…', icon: <ITrash size={14} />, danger: true, hint: 'Projects stay, unassigned', run: async () => { if (!confirm('Delete this workspace? Its projects stay (unassigned) and its people lose access.')) return; await workspacesApi.remove(id).catch((e) => toast({ text: e.message, tone: 'error' })); go({ name: 'projects' }); useStore.getState().loadVideos(); } },
  ];

  // Where a drop lands: before the card under the pointer, or at the end of the column.
  const dropPosition = (status: ProjectStatus, before: string | null) => {
    const col = byStatus(status).filter((p) => p.id !== dragId);
    if (!before) return Math.max(0, ...projects.filter((p) => p.id !== dragId).map((p) => p.position)) + 1;
    const i = col.findIndex((p) => p.id === before);
    const prev = col[i - 1]?.position ?? (col[i].position - 2);
    return (prev + col[i].position) / 2;
  };
  const drop = (status: ProjectStatus) => {
    if (dragId) moveProject(dragId, status, dropPosition(status, over?.before ?? null));
    setDragId(null); setOver(null);
  };

  return (
    <div className="projects">
      <header className="topbar">
        <div className="crumbs">
          {ws ? <><button className="crumb" onClick={() => go({ name: 'projects' })}>{CLOUD ? 'Workspaces' : 'Projects'}</button><span className="crumb-sep">/</span><span className="crumb crumb-here">{ws.name}</span></> : <span className="crumb crumb-here">{client && workspaces.length === 1 ? workspaces[0].name : CLOUD ? 'Workspaces' : 'Projects'}</span>}
        </div>
        <div className="topbar-right">
          {ws && me?.role === 'owner' && <button className="btn" onClick={() => setPeople(true)}><IPeople size={16} /> Invite</button>}
          {!client && <button className="btn primary" onClick={() => create('ready')}><IPlus size={16} /> <span className="btn-label">New project</span></button>}
        </div>
      </header>
      {CLOUD && (workspaces.length > 0 || !client) && !(client && workspaces.length === 1) && (
        <nav className="ws-tabs" aria-label="Workspaces">
          <button className={`ws-tab ${!ws ? 'on' : ''}`} onClick={() => go({ name: 'projects' })}>All</button>
          {workspaces.map((w) => (
            <button key={w.id} data-drop-workspace={w.id} className={`ws-tab ${ws?.id === w.id ? 'on' : ''} ${tabHot === w.id ? 'drop-hot' : ''}`} onClick={() => go({ name: 'projects', ws: w.id })}
              onDragOver={(e) => { if (!dragId || client) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setTabHot(w.id); }}
              onDragLeave={() => setTabHot((h) => (h === w.id ? null : h))}
              onDrop={(e) => { e.preventDefault(); setTabHot(null); const f = folders.find((x) => x.id === dragId); setDragId(null); setOver(null); if (f && f.workspace_id !== w.id) { setWorkspace(f, w.id); toast({ text: `Moved “${f.name}” to ${w.name}`, tone: 'accent' }); } }} onContextMenu={client ? undefined : (e) => showMenu(e, wsMenu(w.id))}>{w.name}</button>
          ))}
          {!client && <button className="ws-tab add" onClick={newWorkspace}><IPlus size={13} /> Workspace</button>}
        </nav>
      )}
      {ws && <PeopleDialog open={people} onClose={() => setPeople(false)} wsId={ws.id} wsName={ws.name} />}
      <div className="board">
        {PROJECT_STATUSES.map((status) => {
          const col = byStatus(status);
          return (
            <section
              key={status}
              className={`col st-${status} ${over?.status === status ? 'hot' : ''}`}
              aria-label={STATUS_LABEL[status]}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card]'); const before = card && card.dataset.card !== dragId ? card.dataset.card! : null; if (over?.status !== status || over.before !== before) setOver({ status, before }); }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o?.status === status ? null : o)); }}
              onDrop={(e) => { e.preventDefault(); drop(status); }}
            >
              <div className="col-head">
                <span className="col-dot" />
                <span className="col-title">{COLUMN_TITLE[status]}</span>
                <span className="col-count">{col.length}</span>
                {!client && <button className="icon-btn col-new" onClick={() => create(status)} {...tip(`New project in ${STATUS_LABEL[status]}`, undefined, { side: 'bottom' })}><IPlus size={15} /></button>}
              </div>
              <div className="col-list">
                <AnimatePresence initial={false}>
                  {col.map((f) => {
                    const vids = inside(f);
                    const open = vids.reduce((n, v) => n + v.open_count, 0);
                    return (
                      <motion.div
                        key={f.id}
                        layout
                        layoutId={`proj-${f.id}`}
                        transition={spring.soft}
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        className={`pcard ${dragId === f.id ? 'lifted' : ''} ${over?.before === f.id ? 'drop-before' : ''}`}
                        data-card={f.id}
                      >
                        <div
                          className="pcard-inner"
                          draggable={!client && renaming !== f.id}
                          role="button"
                          tabIndex={0}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', f.name); e.dataTransfer.effectAllowed = 'move'; setDragId(f.id); }}
                          onDragEnd={() => { setDragId(null); setOver(null); }}
                          onClick={() => renaming !== f.id && go({ name: 'library', folder: f.id })}
                          onKeyDown={(e) => { if (e.key === 'Enter' && renaming !== f.id) go({ name: 'library', folder: f.id }); }}
                          onContextMenu={(e) => showMenu(e, menu(f))}
                        >
                          {vids.length > 0 && (
                            <div className="pcard-thumbs">
                              {vids.slice(0, 3).map((v) => v.latest && <img key={v.id} src={posterUrl(v.latest.id)} alt="" loading="lazy" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />)}
                            </div>
                          )}
                          {renaming === f.id
                            ? <NameInput value={f.name} onDone={(v) => rename(f, v)} />
                            : <div className="pcard-name" onDoubleClick={(e) => { if (client) return; e.stopPropagation(); setRenaming(f.id); }}>{f.name}</div>}
                          {CLOUD && !ws && !client && wsName(f.workspace_id) && <div className="pcard-ws">{wsName(f.workspace_id)}</div>}
                          {f.notes && <div className="pcard-notes">{f.notes}</div>}
                          {f.status === 'done' && <DoneState f={f} />}
                          <div className="pcard-meta">
                            <span>{vids.length ? `${vids.length} video${vids.length === 1 ? '' : 's'}` : 'No videos yet'}</span>
                            {open > 0 && <span className="pcard-open">{open} open</span>}
                            {f.links.length > 0 && <span className="pcard-links"><ILinkSm size={12} /> {f.links.length}</span>}
                            {f.status_at && <span className="pcard-age" {...tip(`In ${STATUS_LABEL[f.status]} since ${new Date(f.status_at).toLocaleString()}`, undefined, { side: 'top' })}>{ago(f.status_at)}</span>}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {col.length === 0 && <div className="col-empty">{client ? 'Nothing here right now' : HINT[status]}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** On Done cards: whether clean-up has happened yet, and when old versions leave Portal. */
function DoneState({ f }: { f: Folder }) {
  const left = f.status_at ? Math.ceil((f.status_at + DONE_PRUNE_DAYS * 86_400_000 - Date.now()) / 86_400_000) : null;
  return (
    <div className="pcard-done">
      <span className={`done-chip ${f.cleaned_at ? 'ok' : 'todo'}`} {...tip(f.cleaned_at ? `Unessential files deleted ${ago(f.cleaned_at)}` : 'Overlays and other unessential files still need deleting', undefined, { side: 'top' })}>
        {f.cleaned_at ? 'Files cleaned' : 'Needs clean-up'}
      </span>
      {left !== null && left > 0 && <span className="dim" {...tip('Older versions are removed from Portal (not from your disk) after a week in Done', undefined, { side: 'top' })}>Old versions clear in {left}d</span>}
    </div>
  );
}

function NameInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (v: string) => { if (done.current) return; done.current = true; onDone(v); };
  return (
    <input
      ref={ref}
      className="rename-input pcard-rename"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(e.currentTarget.value); if (e.key === 'Escape') finish(value); }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/** Stage, notes and links for a project, shown at the top of its folder page. */
export function ProjectHeader({ f }: { f: Folder }) {
  const toast = useStore((s) => s.toast);
  const client = useIsClient();
  const workspaces = useStore((s) => s.workspaces);
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState(f.notes);
  useEffect(() => setNotes(f.notes), [f.id, f.notes]);
  const save = async (patch: Parameters<typeof api.updateFolder>[1]) => {
    useStore.setState((s) => ({ folders: s.folders.map((x) => (x.id === f.id ? { ...x, ...patch } as Folder : x)) }));
    try { await api.updateFolder(f.id, patch); } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
    useStore.getState().loadVideos();
  };
  const addLink = (label: string, url: string) => {
    if (!url.trim()) return;
    save({ links: [...f.links, { id: '', label: label.trim(), url: url.trim() }] });
    setAdding(false);
  };
  if (client) {
    // Clients see where things stand, and the links and notes, but can't change them.
    return (
      <section className="proj-head" aria-label="Project">
        <div className="proj-row"><span className={`stage-badge st-${f.status}`}><i className="col-dot" />{STATUS_LABEL[f.status]}</span>
          {f.status_at && <span className="dim small">since {ago(f.status_at)}{ago(f.status_at) === 'just now' ? '' : ' ago'}</span>}</div>
        {f.links.length > 0 && <div className="proj-links">{f.links.map((l) => <span key={l.id} className="link-chip"><a href={l.url} target="_blank" rel="noreferrer noopener"><ILinkSm size={13} /> {l.label}</a></span>)}</div>}
        {f.notes && <p className="proj-notes-read">{f.notes}</p>}
      </section>
    );
  }
  return (
    <section className="proj-head" aria-label="Project">
      <div className="proj-row">
        <div className="seg proj-stages" role="radiogroup" aria-label="Stage">
          {PROJECT_STATUSES.map((s) => (
            <button key={s} role="radio" aria-checked={f.status === s} className={`seg-btn st-${s} ${f.status === s ? 'on' : ''}`} onClick={() => moveProject(f.id, s)}>
              {f.status === s && <motion.span layoutId="proj-stage" className="seg-active" transition={spring.morph} />}
              <span className="seg-label"><i className="col-dot" />{STATUS_LABEL[s]}</span>
            </button>
          ))}
        </div>
        {f.status_at && <span className="dim small">since {ago(f.status_at)}{ago(f.status_at) === 'just now' ? '' : ' ago'}</span>}
        {CLOUD && (
          <label className="proj-ws">
            <span className="dim small">Workspace</span>
            <select className="field sm" value={f.workspace_id ?? ''} onChange={(e) => save({ workspace_id: e.target.value || null })}>
              <option value="">None</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="proj-links">
        {f.links.map((l) => (
          <span key={l.id} className="link-chip">
            <a href={l.url} target="_blank" rel="noreferrer noopener" {...tip(l.url, undefined, { side: 'bottom' })}><ILinkSm size={13} /> {l.label}</a>
            <button onClick={() => save({ links: f.links.filter((x) => x.id !== l.id) })} aria-label={`Remove link ${l.label}`}>×</button>
          </span>
        ))}
        {adding ? <LinkForm onAdd={addLink} onCancel={() => setAdding(false)} /> : <button className="link-add" onClick={() => setAdding(true)}><IPlus size={13} /> Add link</button>}
      </div>
      <textarea
        className="proj-notes field"
        placeholder="Notes for this project: brief, deliverables, deadline…"
        value={notes}
        rows={Math.min(8, Math.max(2, notes.split('\n').length))}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if (notes !== f.notes) save({ notes }); }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </section>
  );
}

function LinkForm({ onAdd, onCancel }: { onAdd: (label: string, url: string) => void; onCancel: () => void }) {
  const url = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLInputElement>(null);
  useEffect(() => url.current?.focus(), []);
  const submit = () => onAdd(label.current?.value ?? '', url.current?.value ?? '');
  const keys = (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); };
  return (
    <span className="link-form">
      <input ref={url} className="field sm mono" placeholder="https://…" onKeyDown={keys} />
      <input ref={label} className="field sm" placeholder="Label (optional)" onKeyDown={keys} />
      <button className="pill-btn" onClick={submit}>Add</button>
      <button className="icon-btn" onClick={onCancel} aria-label="Cancel">×</button>
    </span>
  );
}

/** Who can see a workspace, plus making an invite link for someone new. */
function PeopleDialog({ open, onClose, wsId, wsName }: { open: boolean; onClose: () => void; wsId: string; wsName: string }) {
  const toast = useStore((s) => s.toast);
  const [m, setM] = useState<Members | null>(null);
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => workspacesApi.members(wsId).then(setM).catch(() => {});
  useEffect(() => { if (open) { setLink(null); load(); } }, [open, wsId]);
  const make = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') || '').trim();
    if (!name) return;
    setBusy(true);
    try { const r = await workspacesApi.invite(wsId, name); setLink(r); setCopied(false); load(); }
    catch (err: any) { toast({ text: err.message, tone: 'error' }); } finally { setBusy(false); }
  };
  const copy = async () => { if (!link) return; await navigator.clipboard.writeText(link.url).catch(() => {}); setCopied(true); };
  return (
    <Dialog open={open} onClose={onClose} title={`People in ${wsName}`}>
      <div className="people">
        <p className="muted">People you invite see every {wsName} project, can watch, comment and download, and can upload into their projects. They can’t see other clients.</p>
        {m && (m.people.length > 0 || m.pending.length > 0) && (
          <ul className="people-list">
            {m.people.map((p) => (
              <li key={p.id}><span className="avatar sm">{p.name.charAt(0)}</span><span className="grow"><b>{p.name}</b><span className="dim small block">{p.email}</span></span>
                <button className="c-act danger" onClick={async () => { if (!confirm(`Remove ${p.name} from ${wsName}?`)) return; await workspacesApi.removeMember(wsId, p.id); load(); }}>Remove</button></li>
            ))}
            {m.pending.map((p) => (
              <li key={p.id}><span className="avatar sm">{p.name.charAt(0)}</span><span className="grow"><b>{p.name}</b><span className="dim small block">Invited, hasn’t joined yet</span></span>
                <button className="c-act" onClick={async () => { await workspacesApi.cancelInvite(p.id); load(); }}>Cancel</button></li>
            ))}
          </ul>
        )}
        {link ? (
          <div className="invite-out">
            <p><b>Send this link to {link.name}.</b> <span className="dim">It works once, for 30 days.</span></p>
            <div className="invite-link"><code>{link.url}</code><button className={`btn ${copied ? '' : 'primary'}`} onClick={copy}>{copied ? <><ICheck size={14} /> Copied</> : <><ICopy size={14} /> Copy link</>}</button></div>
            <button className="link sm" onClick={() => setLink(null)}>Invite someone else</button>
          </div>
        ) : (
          <form className="invite-form" onSubmit={make}>
            <input className="field grow" name="name" placeholder="Their name, e.g. Theo" autoComplete="off" required />
            <button className="btn primary" disabled={busy}>{busy ? 'Making link…' : 'Make invite link'}</button>
          </form>
        )}
      </div>
    </Dialog>
  );
}
