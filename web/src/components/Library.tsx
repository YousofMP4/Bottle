import { motion } from 'motion/react';
import { useStore, addVideo, playVideo } from '../lib/store';
import { tip } from './Tooltip';
import { posterUrl } from '../lib/api';
import { tc, ago } from '../lib/time';
import { BottleMark, IFilm, IPlay, IPlus } from './Icons';
import { ease, spring } from '../lib/motion';

export function Library() {
  const videos = useStore((s) => s.videos);
  const loaded = useStore((s) => s.videosLoaded);

  if (loaded && videos.length === 0) return <Empty />;

  return (
    <div className="library">
      <header className="topbar">
        <div className="crumbs"><span className="crumb-current">Library</span></div>
        <div className="topbar-right">
          <button className="btn primary" onClick={() => addVideo()} {...tip('Add a video from this Mac', ['⌘', 'O'], { side: 'bottom', aria: false })}>
            <IPlus size={16} /> Add video
          </button>
        </div>
      </header>
      <div className="lib-scroll">
        <div className="lib-grid">
          {videos.map((v, i) => (
            <motion.button
              key={v.id}
              className="card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03, duration: 0.3, ease } }}
              onClick={() => playVideo(v.id)}
              aria-label={`Play ${v.title}`}
            >
              <div className="card-media">
                {v.latest && <img src={posterUrl(v.latest.id)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                <div className="card-fallback"><IFilm size={26} /></div>
                <div className="card-play"><IPlay size={18} /></div>
                {v.latest && <span className="card-dur">{tc(v.latest.duration)}</span>}
                {v.latest?.missing && <span className="card-missing">File moved</span>}
              </div>
              <div className="card-body">
                <div className="card-title">{v.title}</div>
                <div className="card-meta">
                  <span className="chip-mini">v{v.latest?.number ?? 1}</span>
                  {v.open_count > 0 && <span className="dot-meta accent">{v.open_count} open</span>}
                  {v.draft_count > 0 && <span className="dot-meta">{v.draft_count} unsent</span>}
                  <span className="dim">{ago(v.updated_at)}</span>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty-hero">
      <motion.div className="empty-mark" initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ ...spring.pop, delay: 0.05 }}>
        <div className="empty-glow" />
        <BottleMark size={56} />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.6, ease }}>
        Review a cut. <span className="dim">Hand it back.</span>
      </motion.h1>
      <motion.p className="empty-sub" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6, ease }}>
        Add any video on this Mac to your library. Draw on frames, talk over it, pin notes to the
        exact moment, then send it all to your agent. Your files stay where they are.
      </motion.p>
      <motion.div className="empty-actions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.6, ease }}>
        <button className="btn primary lg" onClick={() => addVideo()}>
          <IPlus size={18} /> Add video <kbd className="kbd-inline">⌘O</kbd>
        </button>
      </motion.div>
      <motion.div className="empty-agent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.8 }}>
        <span className="dim">or let your agent add one:</span> <code>add_video("/path/to/cut.mp4")</code>
        <button className="link" onClick={() => useStore.getState().set({ dialog: 'settings' })}>Connect to Claude →</button>
      </motion.div>
    </div>
  );
}
