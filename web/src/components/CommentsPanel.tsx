import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Comment, Round, Version } from '../../../server/types';
import { useStore } from '../lib/store';
import { api, audioUrl } from '../lib/api';
import { voice, useVoice } from '../lib/voice';
import { player } from '../lib/bus';
import { tc, ago } from '../lib/time';
import { spring } from '../lib/motion';
import { IPause, IPlay, ICheck, IMic, IPen, IReply, ITrash, IEye } from './Icons';
import { tip } from './Tooltip';
import { editCommentText, retimeComment } from '../lib/comments';
import { CLOUD } from '../lib/cloud';

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
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  // Online, clients can change only what they wrote (the server enforces this too).
  const me = useStore((s) => s.me);
  const mine = !(me?.role === 'client' && (c as any).user_id !== me.id);
  const startEdit = () => { if (!mine) return; setEditText(c.text); setEditing(true); };
  const saveEdit = async () => { if (!editing) return; setEditing(false); if (!(await editCommentText(c, editText))) setEditText(c.text); };
  // The time chip moves the comment to wherever the playhead is now (clicking the card still jumps to it).
  const moveHere = (e: React.MouseEvent) => { e.stopPropagation(); retimeComment(c, player.time); };
  const sent = round?.status === 'submitted';
  // Whole-video comments only jump when they carry a drawing (to show the marked frame).
  const jump = () => { if (!c.general || c.drawing) { player.pause(); player.seek(c.timestamp); } set({ selectedId: c.id }); };
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
      onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, textarea, .voice-note')) return; e.preventDefault(); startEdit(); }}
    >
      <div className="c-head">
        <span className={`avatar ${c.author_type}`}>{c.author.charAt(0)}</span>
        <span className="c-author">{c.author}</span>
        <span className="c-ago dim">{ago(c.created_at)}</span>
        <span className="grow" />
        {!sent && c.status === 'open' && <span className="tag draft" {...tip('Not sent to your editor yet', undefined, { aria: false })}>Unsent</span>}
        {sent && <span className="tag" {...tip(`Sent to your editor in round ${round!.number}`, undefined, { aria: false })}>R{round!.number}</span>}
        <button className={`time-chip mono sm ${c.general ? 'general' : ''}`} onClick={moveHere} {...tip(c.general ? 'About the whole video · click to pin it to the playhead' : 'Click to move this comment to the playhead', undefined, { side: 'left' })}>
          {c.general ? 'Whole video' : tc(c.timestamp, true)}
        </button>
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="field c-edit"
          value={editText}
          aria-label="Edit comment"
          rows={Math.min(6, Math.max(2, editText.split('\n').length))}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setEditText(c.text); }
          }}
        />
      ) : c.text ? <p className="c-text">{c.text}</p> : null}
      {(c.audio || c.transcript) && <VoiceNote c={c} />}
      {c.drawing && (
        <div className="c-drawing">
          <IPen size={12} /> {c.drawing.shapes.length} mark{c.drawing.shapes.length === 1 ? '' : 's'} on frame
          {!CLOUD && <a className="link sm" href={`/api/frame.png?revisionId=${c.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} {...tip('Open the frame with your drawing on it', undefined, { aria: false })}>
            <IEye size={12} /> View frame
          </a>}
        </div>
      )}
      {replies.length > 0 && (
        <div className="c-replies">
          <AnimatePresence initial={false}>
            {replies.map((r) => (
              <motion.div key={r.id} layout className={`reply ${r.author_type}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
                <span className={`avatar xs ${r.author_type}`}>{r.author.charAt(0)}</span>
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
        {mine && <button className="c-act" onClick={startEdit} {...tip('Edit comment · or double-click it')}><IPen size={13} /> Edit</button>}
        <button className={`c-act ${c.status === 'resolved' ? 'on' : ''}`} onClick={toggleResolve}><ICheck size={13} /> {c.status === 'resolved' ? 'Reopen' : 'Resolve'}</button>
        <span className="grow" />
        {mine && <button className="c-act icon danger" onClick={del} {...tip('Delete comment', undefined, { side: 'left' })}><ITrash size={13} /></button>}
      </div>
    </motion.article>
  );
}

function VoiceNote({ c }: { c: Comment }) {
  // All playback goes through the single app-wide controller (see lib/voice.ts).
  const { playing, progress } = useVoice(c.id);
  const peaks = c.audio_peaks ?? Array(32).fill(0.3);
  const bars = peaks.slice(0, 40);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (c.audio) voice.toggle(c.id, audioUrl(c.audio), c.audio_duration);
  };
  return (
    <div className={`voice-note ${playing ? 'playing' : ''}`}>
      {c.audio && (
        <button className="vn-play" onClick={toggle} aria-pressed={playing} {...tip(playing ? 'Pause voice note' : 'Play voice note')}>
          <svg className="vn-ring" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="14.5" pathLength="1" style={{ strokeDashoffset: 1 - progress }} /></svg>
          {playing ? <IPause size={12} /> : <IPlay size={12} />}
        </button>
      )}
      {c.audio && (
        <div className="vn-wave" aria-hidden>
          {bars.map((p, i) => (
            <span key={i} style={{ height: `${Math.max(12, p * 100)}%` }} className={i / bars.length < progress ? 'on' : ''} />
          ))}
        </div>
      )}
      {c.audio && <span className="mono dim vn-dur">{playing || progress > 0 ? tc(progress * (c.audio_duration || 0)) : tc(c.audio_duration)}</span>}
      {c.transcript ? <p className="vn-transcript"><IMic size={11} /> “{c.transcript}”</p> : c.audio ? <p className="vn-transcript dim">No transcript</p> : null}
    </div>
  );
}
