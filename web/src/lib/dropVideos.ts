/**
 * Dropping videos on a workspace (sidebar item, Library tile, board tab): a video lives in a
 * project, so it goes straight into the workspace's only project, or asks which one right where
 * you dropped (with "New project…" at the bottom).
 */
import { useStore } from './store';
import { api } from './api';
import { showMenu, type MenuItem } from '../components/ContextMenu';

export async function moveVideosInto(ids: string[], folderId: string | null) {
  const st = useStore.getState();
  const name = folderId ? st.folders.find((f) => f.id === folderId)?.name : 'Library';
  useStore.setState((s) => ({ videos: s.videos.map((v) => (ids.includes(v.id) ? { ...v, folder_id: folderId } : v)) }));
  try {
    await api.moveVideos(ids, folderId);
    const one = ids.length === 1 ? `“${st.videos.find((v) => v.id === ids[0])?.title ?? 'Video'}”` : `${ids.length} videos`;
    st.toast({ text: `Moved ${one} to ${name}`, tone: 'accent' });
  } catch (e: any) {
    st.toast({ text: 'Couldn’t move that', sub: e.message, tone: 'error' });
  }
  useStore.getState().loadVideos();
}

export function dropVideosOnWorkspace(ids: string[], wsId: string, at: { x: number; y: number }) {
  const st = useStore.getState();
  const ws = st.workspaces.find((w) => w.id === wsId);
  if (!ws || !ids.length) return;
  const projects = st.folders.filter((f) => !f.parent_id && f.workspace_id === wsId).sort((a, b) => a.position - b.position);
  if (projects.length === 1) { moveVideosInto(ids, projects[0].id); return; }
  const first = st.videos.find((v) => v.id === ids[0]);
  const newProject = async () => {
    const name = prompt(`New project in ${ws.name}`, ids.length === 1 && first ? first.title : 'New project');
    if (!name?.trim()) return;
    try {
      const f = await api.createFolder(name.trim(), null, 'ready', wsId);
      useStore.setState((s) => ({ folders: [...s.folders, f] }));
      await moveVideosInto(ids, f.id);
    } catch (e: any) { st.toast({ text: e.message, tone: 'error' }); }
  };
  const items: MenuItem[] = [
    { label: projects.length ? `Move to which ${ws.name} project?` : `${ws.name} has no projects yet`, disabled: true },
    ...projects.map((p) => ({ label: p.name, run: () => moveVideosInto(ids, p.id) }) as MenuItem),
    'sep',
    { label: 'New project…', run: newProject },
  ];
  // Open the menu after the pointerup that ended the drag, so it isn't closed by that same click.
  setTimeout(() => showMenu({ clientX: at.x, clientY: at.y }, items), 0);
}
