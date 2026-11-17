import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Activity } from '../../../server/types';
import { useStore, playVideo } from '../lib/store';
import { api } from '../lib/api';
import { ago } from '../lib/time';
import { pop } from '../lib/motion';
import { IBell } from './Icons';
import { tip } from './Tooltip';

const KIND_LABEL: Record<Activity['kind'], string> = {
  video_added: 'Upload', version_added: 'New version', project_created: 'Project', project_moved: 'Moved',
  project_renamed: 'Renamed', project_updated: 'Updated', project_deleted: 'Deleted', agent_reply: 'Reply',
  revision_resolved: 'Resolved', revisions_sent: 'Sent', project_cleaned: 'Cleaned', versions_cleared: 'Cleared', video_revising: 'In progress',
};

/** Bell with a red dot when someone else (your editor, or Portal itself) did something since you last looked. */
export function Notifications() {
  const unread = useStore((s) => s.unread);
  const items = useStore((s) => s.activity);
  const seenAt = useStore((s) => s.activitySeenAt);
  const [open, setOpen] = useState(false);
  // Remember what was new when the panel opened, so it stays highlighted while you read it.
  const [newSince, setNewSince] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setNewSince(seenAt);
    setOpen(true);
    useStore.getState().loadActivity();
    if (unread) { useStore.setState({ unread: 0 }); api.activitySeen().catch(() => {}); }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  const goTo = (a: Activity) => {
    setOpen(false);
    const s = useStore.getState();
    if (a.video_id && s.videos.some((v) => v.id === a.video_id)) playVideo(a.video_id);
    else if (a.folder_id && s.folders.some((f) => f.id === a.folder_id)) s.go({ name: 'library', folder: a.folder_id });
    else if (a.kind.startsWith('project')) s.go({ name: 'projects' });
  };

  return (
    <div className="bell-anchor" ref={ref}>
      <button className={`icon-btn bell ${open ? 'on' : ''}`} onClick={toggle} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} aria-expanded={open} {...tip('Notifications', undefined, { side: 'bottom', aria: false })}>
        <IBell size={17} />
        <AnimatePresence>{unread > 0 && <motion.span className="bell-dot" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={pop} />}</AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="notif menu"
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: pop }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          >
            <div className="notif-head">Notifications</div>
            <div className="notif-list">
              {items.length === 0 && <p className="notif-empty">Nothing yet. Uploads, new versions, project moves and editor replies show up here.</p>}
              {items.map((a) => (
                <button key={a.id} className={`notif-item ${a.created_at > newSince && (a.mine === undefined ? a.actor !== 'you' : !a.mine) ? 'new' : ''}`} onClick={() => goTo(a)}>
                  <span className="notif-kind">{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className="notif-text">{a.text}</span>
                  <span className="notif-meta">{a.actor === 'agent' ? 'Editor' : a.actor === 'portal' ? 'Portal' : a.mine !== false ? 'You' : a.actor_name || 'Someone'} · {ago(a.created_at)}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
