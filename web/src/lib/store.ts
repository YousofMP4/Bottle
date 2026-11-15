import { create } from 'zustand';
import type { Comment, Settings, Shape, Tool, VideoDetail, VideoSummary } from '../../../server/types';
import { api } from './api';
import type { Recording } from './recorder';

export interface Toast { id: number; text: string; tone?: 'default' | 'accent' | 'error'; action?: { label: string; run: () => void }; ms?: number }

export type Route = { name: 'library' } | { name: 'review'; id: string; v?: number };

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
  videosLoaded: boolean;
  detail: VideoDetail | null;
  settings: Settings | null;
  platform: { id: string; canPick: boolean } | null;
  toasts: Toast[];
  dialog: null | 'settings' | 'shortcuts' | 'paste';
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
  videosLoaded: false,
  detail: null,
  settings: null,
  platform: null,
  toasts: [],
  dialog: null,
  pasteFor: undefined,
  versionId: null,
  panelOpen: typeof window !== 'undefined' ? window.innerWidth >= 1100 : true,
  draft: null,
  tool: null,
  color: '#ff5a4e',
  selectedId: null,
  filter: 'open',
  playing: false,
  rate: 1,

  go(r) {
    const hash = r.name === 'library' ? '#/' : `#/v/${r.id}${r.v ? `/${r.v}` : ''}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ route: r });
  },
  async loadVideos() {
    try { set({ videos: await api.videos(), videosLoaded: true }); } catch { set({ videosLoaded: true }); }
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
    } catch (e: any) {
      if (e.status === 404) { get().go({ name: 'library' }); get().toast({ text: 'That video is no longer in Bottle.' }); }
    }
  },
  toast(t) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.ms ?? (t.action ? 6000 : 3200));
  },
  dismiss(id) { set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })); },
  set(p) { set(p); },
  startDraft(t) { if (!get().draft) set({ draft: emptyDraft(t) }); },
  patchDraft(p) { const d = get().draft ?? emptyDraft(0); set({ draft: { ...d, ...p } }); },
  clearDraft() { set({ draft: null, tool: null }); },
  upsertComment(c) {
    const d = get().detail;
    if (!d || d.video.id !== c.video_id) return;
    const exists = d.comments.some((x) => x.id === c.id);
    set({ detail: { ...d, comments: exists ? d.comments.map((x) => (x.id === c.id ? c : x)) : [...d.comments, c] } });
  },
}));

export function parseHash(): Route {
  const m = /^#\/v\/([a-z0-9_]+)(?:\/(\d+))?/i.exec(location.hash);
  return m ? { name: 'review', id: m[1], v: m[2] ? Number(m[2]) : undefined } : { name: 'library' };
}

/** Open the native file picker (or the paste dialog) and route into the review. */
export async function openVideo(videoId?: string) {
  const s = useStore.getState();
  try {
    const r = await api.pick(videoId);
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
  s.set({ versionId: r.version.id, draft: null, tool: null, selectedId: null });
  s.go({ name: 'review', id: r.video.id });
  s.loadDetail(r.video.id);
  if (r.outcome === 'new_version') s.toast({ text: `Added as v${r.version.number} of “${r.video.title}”`, tone: 'accent' });
  else if (r.outcome === 'unchanged') s.toast({ text: 'Already in Bottle — opened it for you.' });
}
