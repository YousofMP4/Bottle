import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore, askRemove } from '../lib/store';
import { api } from '../lib/api';
import { player } from '../lib/bus';
import { spring } from '../lib/motion';
import { Stage } from './Stage';
import { Transport } from './Transport';
import { FeedbackBar, composer } from './FeedbackBar';
import { CommentsPanel } from './CommentsPanel';
import { FloatingComposer } from './FloatingComposer';
import { Popover } from './Popover';
import { useReviewShortcuts } from '../lib/shortcuts';
import { tip } from './Tooltip';
import { ICopy, IFolder, IMore, IPanel, ISend, ITrash, IChevronRight, ICheck } from './Icons';
import { CLOUD } from '../lib/cloud';
import { downloadVersion } from '../lib/cloud';
import { IDownload } from './Icons';
import { isClient } from '../lib/store';
import { setRevising } from '../lib/cloud';
import { posterUrl } from '../lib/api';

export function Review({ id }: { id: string }) {
  const detail = useStore((s) => (s.detail?.video.id === id ? s.detail : null));
  const versionId = useStore((s) => s.versionId);
  const panelOpen = useStore((s) => s.panelOpen);
  const loadDetail = useStore((s) => s.loadDetail);
  const [box, setBox] = useState({ w: 640, stage: 800 });

  useEffect(() => { loadDetail(id); }, [id]);
  useEffect(() => {
    document.body.dataset.panel = panelOpen ? 'open' : 'closed';
    return () => { delete document.body.dataset.panel; };
  }, [panelOpen]);
  useReviewShortcuts();

  const version = useMemo(() => detail?.versions.find((v) => v.id === versionId) ?? detail?.versions[detail.versions.length - 1], [detail, versionId]);

  if (!detail || !version) {
    return <div className="review loading"><div className="spinner" /></div>;
  }
  const comments = detail.comments;
  const unsent = comments.filter((c) => !c.parent_id && c.status === 'open' && detail.rounds.find((r) => r.id === c.round_id)?.status !== 'submitted').length;
  const fbWidth = Math.min(box.stage, Math.max(box.w, 560));

  return (
    <div className="review">
      <div className="review-main">
        <TopBar title={detail.video.title} videoId={detail.video.id} versionId={version.id} versionNumber={version.number} unsent={unsent} revising={!!detail.video.revising_at} />
        {detail.video.revising_at && isClient() ? (
          <div className="stage-area">
            <div className="coming-soon-stage">
              <img src={posterUrl(version.id)} alt="" />
              <div className="coming-soon-card">
                <span className="led amber blink" />
                <h2>New version coming soon</h2>
                <p>{detail.video.revising_note || 'Gleam Films is working on the next cut of this video.'}</p>
                <p className="dim small">You’ll get a notification when it’s ready to review.</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="stage-area">
              <Stage version={version} comments={comments} onBox={(w, stage) => setBox({ w, stage })} />
              <FeedbackBar version={version} width={fbWidth} />
            </div>
            <Transport version={version} versions={detail.versions} comments={comments} onComposeAt={(t) => composer.focus(t)} />
          </>
        )}
      </div>
      <FloatingComposer />
      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.aside
            key="panel"
            className="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'var(--panel-w)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring.panel}
          >
            <motion.div className="panel-slide" initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} transition={spring.panel}>
              <CommentsPanel version={version} comments={comments} rounds={detail.rounds} />
            </motion.div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function TopBar({ title, videoId, versionId, versionNumber, unsent, revising }: { title: string; videoId: string; versionId: string; versionNumber: number; unsent: number; revising: boolean }) {
  const go = useStore((s) => s.go);
  const set = useStore((s) => s.set);
  const panelOpen = useStore((s) => s.panelOpen);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      const { text } = await api.agentMessage(videoId);
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
      toast({ text: 'Message copied', sub: 'Every open note, ready to paste wherever you need it.', tone: 'accent' });
    } catch { toast({ text: 'Couldn’t copy the message', sub: 'Your browser blocked clipboard access.', tone: 'error' }); }
  };
  const send = async () => {
    if (sending) return;
    if (unsent === 0) { toast({ text: 'Nothing new to send', sub: 'Leave a comment first. Everything else has already been sent.' }); return; }
    setSending(true);
    try {
      const r = await api.submit(videoId);
      const extra = r.results.filter((x) => x.channel !== 'mcp').map((x) => (x.ok ? `${x.channel} ✓` : `${x.channel} failed`));
      toast({ text: `Round ${r.round.number} sent to your editor`, sub: `${r.count} revision${r.count === 1 ? '' : 's'}${extra.length ? ' · ' + extra.join(' · ') : ''}`, tone: 'accent', action: { label: 'Copy message', run: copy }, ms: 6500 });
      setJustSent(true); setTimeout(() => setJustSent(false), 1800);
      useStore.getState().loadDetail(videoId); useStore.getState().loadVideos();
    } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
    finally { setSending(false); }
  };
  (window as any).__portalSend = send;

  return (
    <header className="topbar">
      <div className="crumbs">
        <button className="crumb" onClick={() => go({ name: 'library' })}>Library</button>
        <IChevronRight size={14} className="crumb-sep" />
        {editing ? (
          <input className="crumb-input" autoFocus defaultValue={title}
            onBlur={async (e) => { setEditing(false); if (e.target.value.trim() && e.target.value !== title) { await api.rename(videoId, e.target.value); useStore.getState().loadDetail(videoId); useStore.getState().loadVideos(); } }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <button className="crumb-current" onDoubleClick={() => { if (!isClient()) setEditing(true); }} {...tip('Double-click to rename', undefined, { side: 'bottom', aria: false })}>{title}</button>
        )}
        <Popover placement="down" trigger={(open) => <button className={`icon-btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip('More actions', undefined, { side: 'bottom' })}><IMore size={16} /></button>}>
          {(close) => (
            <div className="menu">
              {!isClient() && <button className="menu-item" onClick={() => { close(); setEditing(true); }}>Rename</button>}
              {CLOUD && !(revising && isClient()) && <button className="menu-item" onClick={() => { close(); downloadVersion(versionId); }}><IDownload size={15} /> Download v{versionNumber}</button>}
              {CLOUD && !isClient() && <button className="menu-item" onClick={async () => {
                close();
                const note = revising ? undefined : prompt('Note for the client (optional), e.g. “Tightening the intro”', '');
                if (!revising && note === null) return;
                await setRevising([videoId], !revising, note || undefined).catch((e) => useStore.getState().toast({ text: e.message, tone: 'error' }));
                useStore.getState().loadDetail(videoId); useStore.getState().loadVideos();
              }}>{revising ? 'Mark as ready (not being revised)' : 'Mark as being revised…'}</button>}
              {!CLOUD && <button className="menu-item" onClick={() => { close(); api.reveal(versionId); }}><IFolder size={15} /> Show file in Finder</button>}
              {!isClient() && <><div className="menu-sep" />
              <button className="menu-item danger" onClick={() => { close(); askRemove([videoId]); }}>
                <ITrash size={15} /> Remove from library…
              </button></>}
            </div>
          )}
        </Popover>
      </div>
      <div className="topbar-right">
        <button className="round-btn" onClick={copy} {...tip('Copy revisions as text', undefined, { side: 'bottom' })}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={copied ? 'ok' : 'copy'} className="center" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.pop}>
              {copied ? <ICheck size={16} /> : <ICopy size={16} />}
            </motion.span>
          </AnimatePresence>
        </button>
        <button className={`round-btn ${panelOpen ? 'on' : ''}`} onClick={() => set({ panelOpen: !panelOpen })} aria-pressed={panelOpen} {...tip(panelOpen ? 'Hide comments' : 'Show comments', '\\', { side: 'bottom' })}><IPanel size={16} /></button>
        <motion.button
          className={`btn primary send ${justSent ? 'sent' : ''} ${unsent === 0 && !justSent ? 'idle' : ''}`}
          onClick={send}
          aria-disabled={sending || unsent === 0}
          {...tip(unsent === 0 ? 'Nothing new to send' : `Send ${unsent} revision${unsent === 1 ? '' : 's'} to your editor`, unsent === 0 ? undefined : ['⌘', '↩'], { side: 'bottom', aria: false })}
          layout
          transition={spring.morph}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {justSent ? (
              <motion.span key="ok" className="row gap-s" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={spring.pop}><ICheck size={15} /> Sent</motion.span>
            ) : (
              <motion.span key="send" className="row gap-s" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={spring.pop}>
                <ISend size={15} /> <span className="send-label">Send to editor</span>
                <AnimatePresence>{unsent > 0 && <motion.span key={unsent} className="send-count" initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.pop}>{unsent}</motion.span>}</AnimatePresence>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </header>
  );
}

export { player };
