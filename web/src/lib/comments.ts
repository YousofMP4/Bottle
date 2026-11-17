import type { Comment } from '../../../server/types';
import { useStore } from './store';
import { api } from './api';
import { tc } from './time';

/** Moves a comment to a new moment (also pins a whole-video comment), with an Undo toast. */
export async function retimeComment(c: Comment, t: number) {
  t = +Math.max(0, t).toFixed(3);
  if (!c.general && Math.abs(c.timestamp - t) < 0.005) return;
  const st = useStore.getState();
  const prev = { timestamp: c.timestamp, general: c.general };
  st.upsertComment({ ...c, timestamp: t, general: false }); // optimistic, so the marker doesn't snap back
  try {
    st.upsertComment(await api.updateComment(c.id, { timestamp: t, general: false }));
  } catch (e: any) {
    st.upsertComment(c);
    st.toast({ text: e.message, tone: 'error' });
    return;
  }
  st.toast({
    text: `Comment moved to ${tc(t, true)}`,
    action: { label: 'Undo', run: async () => useStore.getState().upsertComment(await api.updateComment(c.id, prev)) },
  });
}

/** Saves edited comment text. Returns false (and keeps the old text) if nothing would be left. */
export async function editCommentText(c: Comment, text: string): Promise<boolean> {
  text = text.trim();
  if (text === c.text) return true;
  if (!text && !c.transcript && !c.audio && !c.drawing) return false;
  const st = useStore.getState();
  st.upsertComment({ ...c, text });
  try {
    st.upsertComment(await api.updateComment(c.id, { text }));
    return true;
  } catch (e: any) {
    st.upsertComment(c);
    st.toast({ text: e.message, tone: 'error' });
    return false;
  }
}
