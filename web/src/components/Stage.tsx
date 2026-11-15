import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Comment, Shape, Version } from '../../../server/types';
import { useStore } from '../lib/store';
import { mediaUrl } from '../lib/api';
import { player, timeBus } from '../lib/bus';
import { drawShape, simplify } from '../lib/shapes';
import { DrawToolbar } from './DrawToolbar';
import { spring } from '../lib/motion';

const SHOW_FOR = 1.5; // seconds a drawing stays up during playback
const FADE_OUT = 0.3;

/** Video + vector drawing overlay. The overlay box always matches the video's content rect. */
export function Stage({ version, comments, onBox }: { version: Version; comments: Comment[]; onBox?: (w: number, h: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.draft);
  const color = useStore((s) => s.color);
  const selectedId = useStore((s) => s.selectedId);
  const live = useRef<Shape | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aspect = version.width && version.height ? version.width / version.height : 16 / 9;

  // Fit the video into the stage (contain), as an explicit box so the canvas can match it exactly.
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const W = r.width, H = r.height;
      let w = W, h = W / aspect;
      if (h > H) { h = H; w = H * aspect; }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
      onBox?.(Math.floor(w), Math.floor(W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Wire the imperative player + time bus.
  useEffect(() => {
    const v = videoRef.current!;
    player.el = v; player.fps = version.fps || 30; player.duration = version.duration;
    setError(null);
    let raf = 0;
    let last = -1;
    const loop = () => {
      const t = v.currentTime;
      if (t !== last) { last = t; timeBus.emit(t); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onPlay = () => useStore.setState({ playing: true });
    const onPause = () => useStore.setState({ playing: false });
    const onRate = () => useStore.setState({ rate: v.playbackRate });
    const onErr = () => setError(v.error?.code === 4 ? 'This browser can’t play this file’s format. Try an H.264 or HEVC .mp4/.mov.' : 'The video file couldn’t be loaded. Was it moved?');
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause); v.addEventListener('ratechange', onRate); v.addEventListener('error', onErr);
    player.onShuttle = (r) => useStore.setState({ rate: r });
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('ratechange', onRate); v.removeEventListener('error', onErr);
      if (player.el === v) player.el = null;
    };
  }, [version.id]);

  // Render overlay: saved drawings near the playhead + the draft being drawn.
  const drawings = comments.filter((c) => c.drawing && !c.parent_id && c.version_id === version.id);
  const stateRef = useRef({ drawings, draft, selectedId });
  stateRef.current = { drawings, draft, selectedId };

  useEffect(() => {
    const cv = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(box.w * dpr)); cv.height = Math.max(1, Math.round(box.h * dpr));
    const ctx = cv.getContext('2d')!;
    const render = (t: number) => {
      const { drawings, draft, selectedId } = stateRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);
      const eps = 0.6 / (player.fps || 30);
      for (const c of drawings) {
        if (draft && draft.shapes.length) break; // keep the canvas clean while composing
        const dt = t - c.timestamp;
        let a = 0;
        if (c.id === selectedId && Math.abs(dt) < 0.25) a = 1;
        else if (dt >= -eps && dt <= SHOW_FOR) {
          a = dt < 0.12 ? Math.max(0.25, dt / 0.12) : dt > SHOW_FOR - FADE_OUT ? (SHOW_FOR - dt) / FADE_OUT : 1;
          if (player.el?.paused && dt < 0.5) a = 1;
        }
        if (c.status === 'resolved') a *= 0.45;
        if (a > 0) for (const s of c.drawing!.shapes) drawShape(ctx, s, box.w, box.h, a);
      }
      if (draft) for (const s of draft.shapes) drawShape(ctx, s, box.w, box.h);
      if (live.current) drawShape(ctx, live.current, box.w, box.h);
    };
    const off = timeBus.on(render);
    const unsub = useStore.subscribe(() => render(timeBus.get()));
    (cv as any).__render = () => render(timeBus.get());
    return () => { off(); unsub(); };
  }, [box.w, box.h]);

  // Pointer drawing in normalized coordinates.
  const norm = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [+((e.clientX - r.left) / r.width).toFixed(5), +((e.clientY - r.top) / r.height).toFixed(5)];
  };
  const onDown = (e: React.PointerEvent) => {
    if (!tool) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    player.pause();
    const st = useStore.getState();
    st.startDraft(player.time);
    const p = norm(e);
    live.current = { tool, color: st.color, width: tool === 'pen' ? 0.0055 : 0.0065, points: tool === 'pen' ? [p] : [p, p] };
    (canvasRef.current as any).__render();
  };
  const onMove = (e: React.PointerEvent) => {
    const s = live.current;
    if (!s) return;
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    if (s.tool === 'pen') {
      const r = canvasRef.current!.getBoundingClientRect();
      for (const ev of events) s.points.push([(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]);
    } else s.points[1] = norm(e);
    (canvasRef.current as any).__render();
  };
  const onUp = () => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const tiny = s.tool !== 'pen' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01;
    if (tiny) { (canvasRef.current as any).__render(); return; }
    if (s.tool === 'pen') s.points = simplify(s.points.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]));
    const st = useStore.getState();
    st.patchDraft({ shapes: [...(st.draft?.shapes ?? []), s] });
  };

  return (
    <div className="stage" ref={wrapRef}>
      <div className={`video-box ${tool ? 'drawing' : ''}`} style={{ width: box.w, height: box.h }}>
        <video
          ref={videoRef}
          key={version.id}
          src={mediaUrl(version.id)}
          preload="auto"
          playsInline
          onClick={() => !tool && player.toggle()}
          onDoubleClick={() => !tool && document.querySelector('.review')?.requestFullscreen?.()}
        />
        <canvas
          ref={canvasRef}
          className="overlay"
          style={{ pointerEvents: tool ? 'auto' : 'none', cursor: tool ? 'crosshair' : 'default' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <AnimatePresence>{tool && <DrawToolbar key="tb" />}</AnimatePresence>
        <AnimatePresence>
          {tool && (
            <motion.div key="ring" className="draw-ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring.soft} style={{ ['--c' as any]: color }} />
          )}
        </AnimatePresence>
        {error && <div className="video-error"><p>{error}</p><code>{version.path}</code></div>}
      </div>
    </div>
  );
}
