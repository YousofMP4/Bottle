import { create } from 'zustand';
import type { Comment, Folder, Settings, Shape, Tool, VideoDetail, VideoSummary } from '../../../server/types';
import { api } from './api';
import type { Recording } from './recorder';

export interface Toast { id: number; text: string; sub?: string; tone?: 'default' | 'accent' | 'error'; action?: { label: string; run: () => void }; ms?: number }

export type Route = { name: 'library'; folder?: string } | { name: 'review'; id: string; v?: number };

/** A pending "Remove from library" confirmation. */
export interface RemoveAsk { ids: string[]; after?: () => void }

export interface Draft {
  t: number;
  text: string;
  shapes: Shape[];
  transcript: string;
  interim: string;
  recording: boolean;
  audio: Recording | null;
}

const emptyDraft = (t = 0): Draft => ({ t, text: '', shapes: [], transcript: '', interim: '', recording: false, audio: null });

interface State {
  route: Route;
  videos: VideoSummary[];
  folders: Folder[];
  removeAsk: RemoveAsk | null;
  videosLoaded: boolean;
  detail: VideoDetail | null;
  settings: Settings | null;
  platform: { id: string; canPick: boolean } | null;
  toasts: Toast[];
  dialog: null | 'settings' | 'shortcuts' | 'paste' | 'remove';
  pasteFor: string | undefined;

  // review
  versionId: string | null;
  panelOpen: boolean;
  draft: Draft | null;
  tool: Tool | null;
  color: string;
  selectedId: string | null;
  filter: 'open' | 'resolved' | 'all';
  playing: boolean;
  /** Set right before routing into a video from a click, so the player starts on its own. */
  autoplay: boolean;
  muted: boolean;
  /** Where the floating comment box sits after a drawing stroke (viewport px), or null. */
  float: { x: number; y: number; drawing: boolean } | null;
  rate: number;

  go(r: Route): void;
  loadVideos(): Promise<void>;
  loadDetail(id: string): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  set(p: Partial<State>): void;
  startDraft(t: number): void;
  patchDraft(p: Partial<Draft>): void;
  clearDraft(): void;
  upsertComment(c: Comment): void;
}

let toastId = 1;

export const useStore = create<State>((set, get) => ({
  route: parseHash(),
  videos: [],
  folders: [],
  removeAsk: null,
  videosLoaded: false,
  detail: null,
  settings: null,
  platform: null,
  toasts: [],
  dialog: null,
  pasteFor: undefined,
  versionId: null,
  // Below 1180px the panel floats over the video, so start with it closed there.
  panelOpen: typeof window !== 'undefined' ? window.innerWidth >= 1180 : true,
  draft: null,
  tool: null,
  color: '#ff5a4e',
  selectedId: null,
  filter: 'open',
  playing: false,
  autoplay: false,
  muted: false,
  float: null,
  rate: 1,

  go(r) {
    const hash = r.name === 'library' ? (r.folder ? `#/f/${r.folder}` : '#/') : `#/v/${r.id}${r.v ? `/${r.v}` : ''}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ route: r });
  },
  async loadVideos() {
    try {
      const [videos, folders] = await Promise.all([api.videos(), api.folders()]);
      set({ videos, folders, videosLoaded: true });
    } catch { set({ videosLoaded: true }); }
  },
  async loadDetail(id) {
    try {
      const d = await api.video(id);
      const cur = get();
      let versionId = cur.versionId;
      if (!versionId || !d.versions.some((v) => v.id === versionId) || cur.detail?.video.id !== id) {
        const wanted = cur.route.name === 'review' && cur.route.v ? d.versions.find((v) => v.number === (cur.route as any).v) : null;
        versionId = (wanted ?? d.versions[d.versions.length - 1])?.id ?? null;
      }
      set({ detail: d, versionId });
      // A new cut arrived while you were watching (e.g. your agent called add_video).
      const prev = cur.detail?.video.id === id ? cur.detail.versions.length : null;
      if (prev !== null && d.versions.length > prev) {
        const nv = d.versions[d.versions.length - 1];
        get().toast({
          text: `v${nv.number} just arrived`,
          sub: nv.filename,
          tone: 'accent',
          action: { label: `Play v${nv.number}`, run: () => get().set({ versionId: nv.id, selectedId: null, draft: null, tool: null, autoplay: true }) },
          ms: 8000,
        });
      }
    } catch (e: any) {
      if (e.status === 404) { get().go({ name: 'library' }); get().toast({ text: 'That video is no longer in your library.' }); }
    }
  },
  toast(t) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.ms ?? (t.action || t.tone === 'error' ? 6000 : t.sub ? 4200 : 3200));
  },
  dismiss(id) { set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })); },
  set(p) { set(p); },
  startDraft(t) { if (!get().draft) set({ draft: emptyDraft(t) }); },
  patchDraft(p) { const d = get().draft ?? emptyDraft(0); set({ draft: { ...d, ...p } }); },
  clearDraft() { set({ draft: null, tool: null, float: null }); },
  upsertComment(c) {
    const d = get().detail;
    if (!d || d.video.id !== c.video_id) return;
    const exists = d.comments.some((x) => x.id === c.id);
    set({ detail: { ...d, comments: exists ? d.comments.map((x) => (x.id === c.id ? c : x)) : [...d.comments, c] } });
  },
}));

export function parseHash(): Route {
  const m = /^#\/v\/([a-z0-9_]+)(?:\/(\d+))?/i.exec(location.hash);
  if (m) return { name: 'review', id: m[1], v: m[2] ? Number(m[2]) : undefined };
  const f = /^#\/f\/([a-z0-9_]+)/i.exec(location.hash);
  return f ? { name: 'library', folder: f[1] } : { name: 'library' };
}

/** Open the native file picker (or the paste dialog), add the file to the library and route into it. */
export async function addVideo(videoId?: string) {
  const s = useStore.getState();
  // Adding from inside a folder files the video there.
  const folderId = s.route.name === 'library' ? s.route.folder ?? null : null;
  try {
    const r = await api.pick(videoId, folderId);
    if (r.cancelled) return;
    afterAdd(r);
  } catch (e: any) {
    if (e.status === 501) { s.set({ dialog: 'paste', pasteFor: videoId }); return; }
    s.toast({ text: e.message, tone: 'error' });
  }
}

export function afterAdd(r: { outcome: string; video: { id: string; title: string }; version: { id: string; number: number } }) {
  const s = useStore.getState();
  s.loadVideos();
  s.set({ versionId: r.version.id, draft: null, tool: null, selectedId: null, autoplay: true });
  s.go({ name: 'review', id: r.video.id });
  s.loadDetail(r.video.id);
  if (r.outcome === 'new_version') s.toast({ text: `Added to your library as v${r.version.number} of “${r.video.title}”`, tone: 'accent' });
  else if (r.outcome === 'unchanged') s.toast({ text: 'Already in your library. Opened it for you.' });
  else s.toast({ text: `Added “${r.video.title}” to your library`, tone: 'accent' });
}

/** Route into a video from a click (library card, sidebar row). The click is the user gesture, so it autoplays. */
export function playVideo(id: string) {
  const s = useStore.getState();
  s.set({ versionId: null, draft: null, tool: null, selectedId: null, autoplay: true });
  s.go({ name: 'review', id });
  s.loadDetail(id); // start fetching now, not after the view transition
}

/** Ask before removing videos from the library (the confirm dialog explains files stay on disk). */
export function askRemove(ids: string[], after?: () => void) {
  if (!ids.length) return;
  useStore.getState().set({ removeAsk: { ids, after }, dialog: 'remove' });
}

/** Actually remove (soft, undoable for 8s). Never touches files on disk. */
export async function removeFromLibrary(ids: string[]) {
  const s = useStore.getState();
  const gone = new Set(ids);
  const prev = s.videos;
  s.set({ videos: prev.filter((v) => !gone.has(v.id)) }); // optimistic: feels instant
  try { await api.removeVideos(ids); }
  catch (e: any) { s.set({ videos: prev }); s.toast({ text: 'Couldn’t remove that', sub: e.message, tone: 'error' }); return; }
  if (s.route.name === 'review' && gone.has(s.route.id)) s.go({ name: 'library' });
  s.toast({
    text: ids.length === 1 ? 'Removed from your library' : `Removed ${ids.length} videos from your library`,
    sub: 'The files on your disk are untouched.',
    ms: 8000,
    action: { label: 'Undo', run: async () => { await api.restoreVideos(ids); useStore.getState().loadVideos(); } },
  });
  s.loadVideos();
}
