import { useState } from 'react';
import { useStore, afterAdd } from '../lib/store';
import { api } from '../lib/api';
import { Dialog } from './Dialog';

/** Fallback when the OS has no native picker available (e.g. Linux without zenity). */
export function PasteDialog() {
  const open = useStore((s) => s.dialog === 'paste');
  const pasteFor = useStore((s) => s.pasteFor);
  const set = useStore((s) => s.set);
  const [path, setPath] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { set({ dialog: null }); setErr(''); };
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.addPath(path, pasteFor); close(); setPath(''); afterAdd(r); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={close} title="Add a video by path">
      <p className="muted">Paste the full path of a video on this computer. It’s added to your library and played right where it is. Nothing is copied.</p>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="row gap">
        <input autoFocus className="field grow mono" placeholder="/Users/you/Movies/cut_v1.mp4" value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="btn primary" disabled={!path.trim() || busy}>{busy ? 'Adding…' : 'Add video'}</button>
      </form>
      {err && <p className="error-text">{err}</p>}
    </Dialog>
  );
}
