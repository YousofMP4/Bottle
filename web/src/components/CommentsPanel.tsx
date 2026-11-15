import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Comment, Round, Version } from '../../../server/types';
import { useStore } from '../lib/store';
import { api, audioUrl } from '../lib/api';
import { player } from '../lib/bus';
import { tc, ago } from '../lib/time';
import { spring } from '../lib/motion';
import { IPause, IPlay, IBot, ICheck, IMic, IPen, IReply, ITrash, IEye } from './Icons';
import { tip } from './Tooltip';

export function CommentsPanel({ version, comments, rounds }: { version: Version; comments: Comment[]; rounds: Round[] }) {
  const filter = useStore((s) => s.filter);
  const set = useStore((s) => s.set);
  const selectedId = useStore((s) => s.selectedId);
  const roots = comments.filter((c) => !c.parent_id && c.version_id === version.id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const counts = { open: roots.filter((c) => c.status === 'open').length, resolved: roots.filter((c) => c.status === 'resolved').length, all: roots.length };
  const shown = roots.filter((c) => filter === 'all' || c.status === filter);
  const roundOf = new Map(rounds.map((r) => [r.id, r]));
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <div className="seg" role="tablist">
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`seg-btn ${filter === f ? 'on' : ''}`} onClick={() => set({ filter: f })}>
              {filter === f && <motion.span layoutId="seg-active" className="seg-active" transition={spring.morph} />}
              <span className="seg-label">{f[0].toUpperCase() + f.slice(1)}</span>
              <span className="seg-count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="panel-list" ref={listRef}>
        <AnimatePresence initial={false} mode="popLayout">
          {shown.length === 0 && (
            <motion.div key="empty" className="panel-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.soft}>
              {roots.length === 0 ? (
                <>
                  <div className="pe-art"><span /><span /><span /></div>
                  <p className="pe-title">Nothing pinned to v{version.number} yet</p>
                  <p className="dim">Pause anywhere and press <kbd>C</kbd> to comment, <kbd>D</kbd> to draw, or <kbd>R</kbd> to talk.</p>
                </>
              ) : filter === 'open' ? (
                <><p className="pe-title">All clear ✦</p><p className="dim">Every comment on v{version.number} is resolved.</p></>
              ) : (
                <p className="dim">No {filter} comments.</p>
              )}
            </motion.div>
          )}
          {shown.map((c) => (
            <CommentCard key={c.id} c={c} replies={repliesOf(c.id)} round={c.round_id ? roundOf.get(c.round_id) : undefined} selected={c.id === selectedId} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function CommentCard({ c, replies, round, selected }: { c: Comment; replies: Comment[]; round?: Round; selected: boolean }) {
  const set = useStore((s) => s.set);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const sent = round?.status === 'submitted';
  const jump = () => { player.pause(); player.seek(c.timestamp); set({ selectedId: c.id }); };
  const toggleResolve = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const u = await api.updateComment(c.id, { status: c.status === 'open' ? 'resolved' : 'open' });
    useStore.getState().upsertComment(u); useStore.getState().loadVideos();
  };
  // Deleting is undoable: hide it now, delete on the server only if Undo isn't pressed.
  const del = (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = useStore.getState();
    const d = st.detail;
    if (!d) return;
    const removed = d.comments.filter((x) => x.id === c.id || x.parent_id === c.id);
    useStore.setState({ detail: { ...d, comments: d.comments.filter((x) => !removed.includes(x)) }, selectedId: st.selectedId === c.id ? null : st.selectedId });
    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try { await api.deleteComment(c.id); } catch { /* already gone */ }
      useStore.getState().loadVideos();
    }, 5000);
    st.toast({
      text: 'Comment deleted',
      ms: 5000,
      action: { label: 'Undo', run: () => {
        undone = true; clearTimeout(timer);
        const cur = useStore.getState().detail;
        if (cur && cur.video.id === c.video_id) useStore.setState({ detail: { ...cur, comments: [...cur.comments, ...removed] } });
      } },
    });
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    const r = await api.reply(c.id, reply);
    useStore.getState().upsertComment(r);
    setReply(''); setReplying(false);
  };

  return (
    <motion.article
      layout
      data-id={c.id}
      className={`comment ${c.status} ${selected ? 'selected' : ''}`}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={spring.soft}
      onClick={jump}
    >
      <div className="c-head">
        <span className={`avatar ${c.author_type}`}>{c.author_type === 'agent' ? <IBot size={13} /> : c.author.charAt(0)}</span>
        <span className="c-author">{c.author}</span>
        <span className="c-ago dim">{ago(c.created_at)}</span>
        <span className="grow" />
        {!sent && c.status === 'open' && <span className="tag draft" {...tip('Not sent to your agent yet', undefined, { aria: false })}>Unsent</span>}
        {sent && <span className="tag" {...tip(`Sent to your agent in round ${round!.number}`, undefined, { aria: false })}>R{round!.number}</span>}
        <button className="time-chip mono sm" onClick={(e) => { e.stopPropagation(); jump(); }} {...tip(`Jump to ${tc(c.timestamp, true)}`, undefined, { side: 'left' })}>{tc(c.timestamp, true)}</button>
      </div>
      {c.text && <p className="c-text">{c.text}</p>}
      {(c.audio || c.transcript) && <VoiceNote c={c} />}
      {c.drawing && (
        <div className="c-drawing">
          <IPen size={12} /> {c.drawing.shapes.length} mark{c.drawing.shapes.length === 1 ? '' : 's'} on frame
          <a className="link sm" href={`/api/frame.png?revisionId=${c.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} {...tip('Open exactly what your agent will see', undefined, { aria: false })}>
            <IEye size={12} /> Agent view
          </a>
        </div>
      )}
      {replies.length > 0 && (
        <div className="c-replies">
          <AnimatePresence initial={false}>
            {replies.map((r) => (
              <motion.div key={r.id} layout className={`reply ${r.author_type}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
                <span className={`avatar xs ${r.author_type}`}>{r.author_type === 'agent' ? <IBot size={11} /> : r.author.charAt(0)}</span>
                <div>
                  <div className="r-head"><b>{r.author}</b> <span className="dim">{ago(r.created_at)}</span></div>
                  <p>{r.text}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      <AnimatePresence>
        {replying && (
          <motion.form className="reply-form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.bar}
            onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); sendReply(); }}>
            <input autoFocus className="field sm" value={reply} placeholder="Reply…  ↩ to send, Esc to cancel" aria-label="Reply" onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setReplying(false); }} />
          </motion.form>
        )}
      </AnimatePresence>
      <div className="c-actions" onClick={(e) => e.stopPropagation()}>
        <button className="c-act" onClick={() => setReplying((r) => !r)}><IReply size={13} /> Reply</button>
        <button className={`c-act ${c.status === 'resolved' ? 'on' : ''}`} onClick={toggleResolve}><ICheck size={13} /> {c.status === 'resolved' ? 'Reopen' : 'Resolve'}</button>
        <span className="grow" />
        <button className="c-act icon danger" onClick={del} {...tip('Delete comment', undefined, { side: 'left' })}><ITrash size={13} /></button>
      </div>
    </motion.article>
  );
}

function VoiceNote({ c }: { c: Comment }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const peaks = c.audio_peaks ?? Array(32).fill(0.3);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!c.audio) return;
    if (!audio.current) {
      const a = new Audio(audioUrl(c.audio));
      a.ontimeupdate = () => setProg(a.duration && isFinite(a.duration) ? a.currentTime / a.duration : a.currentTime / (c.audio_duration || 1));
      a.onended = () => { setPlaying(false); setProg(0); };
      audio.current = a;
    }
    if (playing) { audio.current.pause(); setPlaying(false); } else { audio.current.play(); setPlaying(true); }
  };
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <div className="voice-note">
      {c.audio && (
        <button className="vn-play" onClick={toggle} {...tip(playing ? 'Pause voice note' : 'Play voice note')}>
          {playing ? <IPause size={12} /> : <IPlay size={12} />}
        </button>
      )}
      {c.audio && (
        <div className="vn-wave" aria-hidden>
          {peaks.slice(0, 40).map((p, i) => (
            <span key={i} style={{ height: `${Math.max(12, p * 100)}%` }} className={i / Math.min(40, peaks.length) <= prog ? 'on' : ''} />
          ))}
        </div>
      )}
      {c.audio && <span className="mono dim vn-dur">{tc(c.audio_duration)}</span>}
      {c.transcript ? <p className="vn-transcript"><IMic size={11} /> “{c.transcript}”</p> : c.audio ? <p className="vn-transcript dim">No transcript</p> : null}
    </div>
  );
}
