import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Comment, Version } from '../../../server/types';
import { useStore, addVideo } from '../lib/store';
import { mediaUrl } from '../lib/api';
import { player, timeBus } from '../lib/bus';
import { tc, ago, clamp } from '../lib/time';
import { spring } from '../lib/motion';
import { IChevronLeft, IChevronRight, IExpand, IMute, IPause, IPlay, IPlus, IVolume } from './Icons';
import { Popover } from './Popover';
import { tip } from './Tooltip';

export function Transport({ version, versions, comments, onComposeAt }: { version: Version; versions: Version[]; comments: Comment[]; onComposeAt: (t: number) => void }) {
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const muted = useStore((s) => s.muted);

  return (
    <div className="transport">
      <button className="round-btn play" onClick={() => player.toggle()} {...tip(playing ? 'Pause' : 'Play', 'Space')}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={playing ? 'pause' : 'play'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.pop} className="center">
            {playing ? <IPause size={16} /> : <IPlay size={16} />}
          </motion.span>
        </AnimatePresence>
      </button>

      <VersionChip version={version} versions={versions} />
      <TimeReadout duration={version.duration} />
      <Timeline version={version} comments={comments} onComposeAt={onComposeAt} />

      <div className="transport-right">
        <div className="joined">
          <button className="round-btn" onClick={() => player.step(-1)} {...tip('Previous frame', '←')}><IChevronLeft size={16} /></button>
          <button className="round-btn" onClick={() => player.step(1)} {...tip('Next frame', '→')}><IChevronRight size={16} /></button>
        </div>
        <Popover
          trigger={(open) => <button className={`pill-btn mono ${open ? 'on' : ''} ${rate < 0 ? 'rev' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip(`Playback speed · ${rate < 0 ? `reverse ${-rate}x` : `${rate}x`}`, ['J', 'K', 'L'], { aria: true })}>{rate < 0 ? `◂${-rate}x` : `${rate}x`}</button>}
          align="end"
        >
          {(close) => (
            <div className="menu">
              {[0.25, 0.5, 1, 1.5, 2].map((r) => (
                <button key={r} role="menuitemradio" aria-checked={Math.abs(rate) === r} className={`menu-item ${Math.abs(rate) === r ? 'on' : ''}`} onClick={() => { player.stopReverse(); player.setRate(r); close(); }}>
                  <span className="mono">{r}x</span>{r === 1 && <span className="dim">Normal</span>}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <button className={`round-btn ${muted ? 'on' : ''}`} onClick={() => { if (player.el) player.el.muted = !player.el.muted; else useStore.setState({ muted: !muted }); }} aria-pressed={muted} {...tip(muted ? 'Unmute' : 'Mute', 'M')}>
          {muted ? <IMute size={16} /> : <IVolume size={16} />}
        </button>
        <button className="round-btn" onClick={() => toggleFullscreen()} {...tip('Fullscreen', 'F')}><IExpand size={15} /></button>
      </div>
    </div>
  );
}

export function toggleFullscreen() {
  const el = document.querySelector('.review') as HTMLElement | null;
  if (document.fullscreenElement) document.exitFullscreen(); else el?.requestFullscreen?.();
}

function TimeReadout({ duration }: { duration: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => timeBus.on((t) => { if (ref.current) ref.current.textContent = tc(t); }), []);
  return (
    <div className="time mono" aria-label="Current time and duration">
      <span ref={ref} className="time-now">0:00</span><span className="time-sep">/</span><span className="dim">{tc(duration)}</span>
    </div>
  );
}

function VersionChip({ version, versions }: { version: Version; versions: Version[] }) {
  const set = useStore((s) => s.set);
  const comments = useStore((s) => s.detail?.comments ?? []);
  return (
    <Popover trigger={(open) => (
      <button className={`pill-btn mono ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip(versions.length > 1 ? `Version ${version.number} of ${versions.length} · switch version` : 'Versions', undefined, { aria: true })}>v{version.number}</button>
    )}>
      {(close) => (
        <div className="menu versions-menu">
          <div className="menu-label">Versions</div>
          {[...versions].reverse().map((v) => {
            const open = comments.filter((c) => c.version_id === v.id && !c.parent_id && c.status === 'open').length;
            return (
              <button key={v.id} className={`menu-item ${v.id === version.id ? 'on' : ''}`} onClick={() => {
                const t = player.time;
                const wasPlaying = !!player.el && !player.el.paused;
                set({ versionId: v.id, selectedId: null, draft: null, tool: null, autoplay: wasPlaying }); close();
                setTimeout(() => player.seek(Math.min(t, v.duration)), 80);
              }}>
                <span className="mono ver-n">v{v.number}</span>
                <span className="ver-file">{v.filename}</span>
                {v.missing ? <span className="tag warn">missing</span> : open ? <span className="tag">{open} open</span> : null}
                <span className="dim ver-ago">{ago(v.created_at)}</span>
              </button>
            );
          })}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { close(); addVideo(version.video_id); }}>
            <IPlus size={15} /> <span>Add new version…</span>
          </button>
        </div>
      )}
    </Popover>
  );
}

function Timeline({ version, comments, onComposeAt }: { version: Version; comments: Comment[]; onComposeAt: (t: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const bufRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number; lane: boolean } | null>(null);
  const dragging = useRef(false);
  const lastT = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  const selectedId = useStore((s) => s.selectedId);
  const dur = version.duration || player.duration || 1;

  useEffect(() => timeBus.on((t) => {
    const p = clamp(t / dur, 0, 1) * 100;
    if (progRef.current) progRef.current.style.transform = `scaleX(${p / 100})`;
    if (knobRef.current) knobRef.current.style.left = `${p}%`;
  }), [dur]);

  useEffect(() => {
    const v = player.el;
    if (!v) return;
    const upd = () => {
      try {
        const b = v.buffered; let end = 0;
        for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i));
        if (bufRef.current) bufRef.current.style.transform = `scaleX(${clamp(end / dur, 0, 1)})`;
      } catch { /* */ }
    };
    v.addEventListener('progress', upd); v.addEventListener('seeked', upd);
    return () => { v.removeEventListener('progress', upd); v.removeEventListener('seeked', upd); };
  }, [version.id, dur]);

  const tAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return { x: clamp(clientX - r.left, 0, r.width), t: clamp((clientX - r.left) / r.width, 0, 1) * dur };
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.marker')) return;
    const lane = (e.target as HTMLElement).closest('.lane');
    const { t } = tAt(e.clientX);
    if (lane) { onComposeAt(t); return; }
    dragging.current = true;
    lastT.current = t;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    // While scrubbing the cursor is "grabbing" everywhere, not just over the bar.
    document.documentElement.dataset.dragCursor = 'grabbing';
    setScrubbing(true);
    player.pause();
    player.scrubTo(t);
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, t } = tAt(e.clientX);
    const lane = !!(e.target as HTMLElement).closest('.lane');
    setHover({ x, t, lane });
    if (dragging.current) { lastT.current = t; player.scrubTo(t); }
  };
  // Releasing a click or drag on the bar always plays from there (keyboard stepping never does).
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    delete document.documentElement.dataset.dragCursor;
    setScrubbing(false);
    player.endScrub(lastT.current);
    player.play();
  };

  const roots = comments.filter((c) => !c.parent_id && c.version_id === version.id);

  return (
    <div className={`timeline ${scrubbing ? 'scrubbing' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp} onPointerLeave={() => !dragging.current && setHover(null)}>
      <div className="lane" aria-label="Comment lane: click to comment at a moment">
        <AnimatePresence>
          {roots.map((c) => (
            <Marker key={c.id} c={c} left={(c.timestamp / dur) * 100} selected={c.id === selectedId} />
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {hover?.lane && (
            <motion.div className="ghost-marker" style={{ left: hover.x }} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.pop}>
              <IPlus size={11} />
              <span className="ghost-label">Comment at {tc(hover.t)} <kbd className="keycap">C</kbd></span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="track" ref={trackRef}>
        <div className="track-bg" />
        <div className="track-buf" ref={bufRef} />
        <div className="track-prog" ref={progRef} />
        {roots.map((c) => <span key={c.id} className={`tick ${c.status}`} style={{ left: `${(c.timestamp / dur) * 100}%` }} />)}
        <div className="knob" ref={knobRef} />
      </div>
      <AnimatePresence>
        {hover && !hover.lane && <HoverPreview key="hp" version={version} x={hover.x} t={hover.t} />}
      </AnimatePresence>
    </div>
  );
}

function Marker({ c, left, selected }: { c: Comment; left: number; selected: boolean }) {
  const set = useStore((s) => s.set);
  const [hov, setHov] = useState(false);
  const preview = c.text || c.transcript || (c.drawing ? 'Drawing' : c.audio ? 'Voice note' : '');
  return (
    <motion.button
      className={`marker ${c.status} ${selected ? 'selected' : ''} ${c.audio ? 'voice' : ''}`}
      style={{ left: `${left}%` }}
      initial={{ scale: 0, y: 6 }}
      animate={{ scale: selected ? 1.25 : 1, y: 0 }}
      exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
      whileHover={{ scale: 1.35 }}
      transition={spring.pop}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={(e) => { e.stopPropagation(); player.pause(); player.seek(c.timestamp); set({ selectedId: c.id, panelOpen: true }); }}
      aria-label={`Comment at ${tc(c.timestamp)}: ${preview}`}
    >
      <span className="marker-dot">{c.author.charAt(0)}</span>
      <AnimatePresence>
        {hov && (
          <motion.span className="marker-tip" initial={{ opacity: 0, y: 4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 2 }} transition={spring.toast}>
            <b>{c.author}</b> <span className="mono dim">{tc(c.timestamp, true)}</span>
            <span className="marker-tip-text">{preview.slice(0, 90)}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** Hover-scrub thumbnail: a second, muted <video> seeks to the hovered time and paints a canvas. */
function HoverPreview({ version, x, t }: { version: Version; x: number; t: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const want = useRef(t);
  want.current = t;
  useEffect(() => { ensureScrubber(version.id); }, [version.id]);
  useEffect(() => {
    const v = scrubber.el;
    if (!v) return;
    const paint = () => {
      const cv = canvasRef.current;
      if (cv && v.videoWidth) cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height);
      if (Math.abs(v.currentTime - want.current) > 0.05) v.currentTime = want.current;
    };
    v.addEventListener('seeked', paint);
    if (!v.seeking) { if (Math.abs(v.currentTime - t) > 0.05) v.currentTime = t; else paint(); }
    return () => v.removeEventListener('seeked', paint);
  }, [t]);
  const aspect = version.width && version.height ? version.width / version.height : 16 / 9;
  const W = aspect >= 1 ? 176 : 96;
  const H = Math.round(W / aspect);
  const trackW = (document.querySelector('.timeline .track') as HTMLElement)?.clientWidth ?? 0;
  const left = clamp(x, W / 2, Math.max(W / 2, trackW - W / 2));
  return (
    <motion.div className="hover-preview" style={{ left, width: W }} initial={{ opacity: 0, y: 6, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.96, transition: { duration: 0.12 } }} transition={spring.toast}>
      <canvas ref={canvasRef} width={W * 2} height={H * 2} style={{ width: W, height: H }} />
      <span className="mono">{tc(t)}</span>
    </motion.div>
  );
}

const scrubber: { el: HTMLVideoElement | null; id: string } = { el: null, id: '' };
function ensureScrubber(versionId: string) {
  if (scrubber.id === versionId && scrubber.el) return;
  if (!scrubber.el) {
    scrubber.el = document.createElement('video');
    scrubber.el.muted = true; scrubber.el.preload = 'auto'; scrubber.el.playsInline = true;
  }
  scrubber.id = versionId;
  scrubber.el.src = mediaUrl(versionId);
}
