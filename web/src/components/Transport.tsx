import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Comment, Version } from '../../../server/types';
import { useStore, addVideo } from '../lib/store';
import { mediaUrl } from '../lib/api';
import { player, timeBus } from '../lib/bus';
import { tc, ago, clamp } from '../lib/time';
import { spring } from '../lib/motion';
import { IChevronLeft, IChevronRight, IExpand, IPause, IPlay, IPlus } from './Icons';
import { Popover } from './Popover';
import { tip } from './Tooltip';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function Transport({ version, versions, comments, onComposeAt }: { version: Version; versions: Version[]; comments: Comment[]; onComposeAt: (t: number) => void }) {
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.rate);
  const step = (dir: 1 | -1) => {
    const cur = Math.abs(rate) || 1;
    const i = SPEEDS.findIndex((x) => x >= cur - 0.001);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + dir))];
    player.stopReverse(); player.setRate(next);
  };

  return (
    <div className="transport-wrap">
      <div className="transport-top">
        <VersionChip version={version} versions={versions} wide />
      </div>
      <div className="transport">
        <button className="round-btn play" onClick={() => player.toggle()} {...tip(playing ? 'Pause' : 'Play', 'Space')}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={playing ? 'pause' : 'play'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.pop} className="center">
              {playing ? <IPause size={15} /> : <IPlay size={15} />}
            </motion.span>
          </AnimatePresence>
        </button>

        <VersionChip version={version} versions={versions} />
        <TimeReadout duration={version.duration} playing={playing} />
        <Timeline version={version} comments={comments} onComposeAt={onComposeAt} />

        <div className="transport-right">
          <div className="stepper" role="group" aria-label="Playback speed">
            <button className="step-btn" onClick={() => step(-1)} aria-disabled={Math.abs(rate) <= SPEEDS[0]} {...tip('Slower', 'J')}><IMinus size={14} /></button>
            <Popover
              trigger={(open) => <button className={`step-read mono ${open ? 'on' : ''} ${rate < 0 ? 'rev' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip(`Speed ${rate < 0 ? `reverse ${-rate}` : rate}x · click for presets`, undefined, { aria: true })}>{rate < 0 ? `◂${-rate}` : rate}<span className="step-x">x</span></button>}
              align="end"
            >
              {(close) => (
                <div className="menu">
                  {SPEEDS.map((r) => (
                    <button key={r} role="menuitemradio" aria-checked={Math.abs(rate) === r} className={`menu-item ${Math.abs(rate) === r ? 'on' : ''}`} onClick={() => { player.stopReverse(); player.setRate(r); close(); }}>
                      <span className={`radio-mini ${Math.abs(rate) === r ? 'on' : ''}`} /><span className="mono">{r}x</span>{r === 1 && <span className="dim">Normal</span>}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
            <button className="step-btn" onClick={() => step(1)} aria-disabled={Math.abs(rate) >= SPEEDS[SPEEDS.length - 1]} {...tip('Faster', 'L')}><IPlus size={14} /></button>
          </div>
          <VolumeKnob />
          <button className="round-btn" onClick={() => toggleFullscreen()} {...tip('Fullscreen', 'F')}><IExpand size={15} /></button>
          <Popover align="end" trigger={(open) => <button className={`round-btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip('View options')}><ISliders size={15} /></button>}>
            {(close) => (
              <div className="menu">
                <button className="menu-item" onClick={() => { player.step(-1); }}><IChevronLeft size={14} /> <span className="menu-label-text">Previous frame</span><span className="menu-kbd">←</span></button>
                <button className="menu-item" onClick={() => { player.step(1); }}><IChevronRight size={14} /> <span className="menu-label-text">Next frame</span><span className="menu-kbd">→</span></button>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { close(); useStore.getState().set({ panelOpen: !useStore.getState().panelOpen }); }}><span className="menu-label-text">Comments panel</span><span className="menu-kbd">{'\\'}</span></button>
                <button className="menu-item" onClick={() => { close(); useStore.getState().set({ dialog: 'shortcuts' }); }}><span className="menu-label-text">Keyboard shortcuts</span><span className="menu-kbd">?</span></button>
                <button className="menu-item" onClick={() => { close(); useStore.getState().set({ dialog: 'settings' }); }}><span className="menu-label-text">Settings…</span><span className="menu-kbd">⌘,</span></button>
              </div>
            )}
          </Popover>
        </div>
      </div>
    </div>
  );
}

/**
 * Rotary volume knob: drag up/down (or scroll) to turn, click to mute, double-click for 100%.
 * Arrow keys work when focused. The lit arc shows the level like a hardware pot.
 */
function VolumeKnob() {
  const volume = useStore((s) => s.volume);
  const muted = useStore((s) => s.muted);
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null);
  const set = (v: number) => {
    const nv = Math.round(clamp(v, 0, 1) * 100) / 100;
    useStore.setState({ volume: nv });
    if (player.el) { player.el.volume = nv; if (nv > 0 && player.el.muted) player.el.muted = false; }
  };
  const toggleMute = () => { if (player.el) player.el.muted = !player.el.muted; else useStore.setState({ muted: !muted }); };
  const shown = muted ? 0 : volume;
  const angle = -135 + shown * 270;
  // arc from -135deg to the current angle (r=15 on a 36 box)
  const arc = (a: number) => { const r = (a - 90) * Math.PI / 180; return [18 + 15 * Math.cos(r), 18 + 15 * Math.sin(r)]; };
  const [x0, y0] = arc(-135), [x1, y1] = arc(angle);
  const large = angle - -135 > 180 ? 1 : 0;
  return (
    <div
      className={`vol-knob ${muted ? 'muted' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}
      aria-valuetext={muted ? 'Muted' : `${Math.round(volume * 100)}%`}
      {...tip(muted ? 'Muted · click to unmute' : `Volume ${Math.round(volume * 100)}% · drag or scroll`, 'M', { aria: false })}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: volume, moved: false };
        document.documentElement.dataset.dragCursor = 'grabbing';
      }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        const dy = d.y - e.clientY;
        if (Math.abs(dy) > 2) d.moved = true;
        if (d.moved) set(d.v + dy / 140);
      }}
      onPointerUp={() => {
        const d = drag.current; drag.current = null;
        delete document.documentElement.dataset.dragCursor;
        if (d && !d.moved) toggleMute();
      }}
      onDoubleClick={() => set(1)}
      onWheel={(e) => { set(volume - e.deltaY / 600); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(volume + 0.05); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); set(volume - 0.05); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleMute(); }
      }}
    >
      <svg className="vol-arc" viewBox="0 0 36 36" aria-hidden>
        <path d={`M ${x0} ${y0} A 15 15 0 1 1 ${arc(135)[0]} ${arc(135)[1]}`} className="vol-track" />
        {shown > 0.005 && <path d={`M ${x0} ${y0} A 15 15 0 ${large} 1 ${x1} ${y1}`} className="vol-fill" />}
      </svg>
      <span className="vol-cap" style={{ rotate: `${angle}deg` }}><i className="vol-notch" /></span>
    </div>
  );
}

const IMinus = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>;
const ISliders = ({ size = 15 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>;

export function toggleFullscreen() {
  const el = document.querySelector('.review') as HTMLElement | null;
  if (document.fullscreenElement) document.exitFullscreen(); else el?.requestFullscreen?.();
}

function TimeReadout({ duration, playing }: { duration: number; playing: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => timeBus.on((t) => { if (ref.current) ref.current.textContent = tc(t); }), []);
  return (
    <div className="time mono" aria-label="Current time and duration">
      <i className={`led ${playing ? 'on' : ''}`} {...tip(playing ? 'Playing' : 'Paused', undefined, { aria: false })} />
      <span ref={ref} className="time-now">0:00</span><span className="time-sep">/</span><span className="time-dur">{tc(duration)}</span>
    </div>
  );
}

function VersionChip({ version, versions, wide }: { version: Version; versions: Version[]; wide?: boolean }) {
  const set = useStore((s) => s.set);
  const comments = useStore((s) => s.detail?.comments ?? []);
  return (
    <Popover trigger={(open) => (
      wide
        ? <button className={`pill-btn versions-btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip(`${versions.length} version${versions.length === 1 ? '' : 's'}`, undefined, { aria: false })}>Versions{versions.length > 1 && <span className="versions-count mono">{versions.length}</span>}</button>
        : <button className={`ver-chip mono ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} {...tip(versions.length > 1 ? `Version ${version.number} of ${versions.length} · switch` : 'Versions', undefined, { aria: true })}>v{version.number}</button>
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
