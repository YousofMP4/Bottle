import { useStore, removeFromLibrary } from '../lib/store';
import { Dialog } from './Dialog';

/**
 * Confirmation for "Remove from library". The wording is deliberate: Bottle only forgets its
 * reference (and the comments on it). The video file on disk is never deleted.
 */
export function RemoveDialog() {
  const open = useStore((s) => s.dialog === 'remove');
  const ask = useStore((s) => s.removeAsk);
  const videos = useStore((s) => s.videos);
  const set = useStore((s) => s.set);
  const close = () => set({ dialog: null, removeAsk: null });
  const picked = videos.filter((v) => ask?.ids.includes(v.id));
  const one = picked.length === 1 ? picked[0] : null;
  const notes = picked.reduce((n, v) => n + v.open_count + v.draft_count, 0);
  const confirm = () => {
    const ids = ask?.ids ?? [];
    const after = ask?.after;
    close();
    removeFromLibrary(ids).then(() => after?.());
  };
  return (
    <Dialog open={open && !!ask} onClose={close} title={one ? `Remove “${one.title}” from your library?` : `Remove ${picked.length} videos from your library?`}>
      <div className="confirm">
        <p className="confirm-lead">
          Bottle forgets {one ? 'this video' : 'these videos'}, every version, and {notes ? <b>{notes} open note{notes === 1 ? '' : 's'}</b> : 'all comments'} on {one ? 'it' : 'them'}.
        </p>
        <div className="confirm-safe">
          <span className="led on" aria-hidden />
          <div>
            <b>{one ? 'The file stays on your disk.' : 'The files stay on your disk.'}</b>
            <span className="dim small block">Nothing is deleted, moved or changed{one?.latest ? ':' : '.'}</span>
            {one?.latest && <code className="inline confirm-path">{one.latest.path}</code>}
          </div>
        </div>
        <p className="dim small">You can undo this for 8 seconds.</p>
        <div className="confirm-actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn danger" onClick={confirm} autoFocus>Remove from library</button>
        </div>
      </div>
    </Dialog>
  );
}
