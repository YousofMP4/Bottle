import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import type { Version } from '../../../server/types';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { player, timeBus } from '../lib/bus';
import { VoiceRecorder } from '../lib/recorder';
import { createTranscriber, type LiveTranscriber } from '../lib/transcriber';
import { tc } from '../lib/time';
import { spring } from '../lib/motion';
import { DotWave, IArrowUp, IPen, IStop, IX } from './Icons';

/** Imperative handle so keyboard shortcuts and the timeline can drive the composer. */
export const composer = {
  focus: (_t?: number) => {},
  toggleRecord: () => {},
  post: () => {},
};

export function FeedbackBar({ version, width }: { version: Version; width: number }) {
  const draft = useStore((s) => s.draft);
  const tool = useStore((s) => s.tool);
  const settings = useStore((s) => s.settings);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<VoiceRecorder | null>(null);
  const tr = useRef<LiveTranscriber | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [trFailed, setTrFailed] = useState(false);
  const shake = useAnimationControls();
  const nowRef = useRef<HTMLSpanElement>(null);

  // When there's no draft, the time chip follows the playhead.
  useEffect(() => timeBus.on((t) => { if (nowRef.current) nowRef.current.textContent = tc(t, true); }), []);

  const anchor = (t?: number) => {
    const st = useStore.getState();
    player.pause();
    if (t !== undefined) { player.seek(t); if (st.draft) st.patchDraft({ t }); else st.startDraft(t); }
    else st.startDraft(player.time);
  };

  const startRecording = async () => {
    if (!VoiceRecorder.supported()) { useStore.getState().toast({ text: 'Recording isn’t supported in this browser.', tone: 'error' }); return; }
    anchor();
    const r = new VoiceRecorder();
    try { await r.start(); } catch {
      useStore.getState().toast({ text: 'Microphone access was blocked. Allow it in the browser’s site settings.', tone: 'error' });
      return;
    }
    rec.current = r;
    const lv: number[] = [];
    r.onLevel = (l) => { if ((tr.current as any)?.failed) setTrFailed(true); lv.push(l); if (lv.length > 40) lv.shift(); setLevels([...lv]); setElapsed(r.elapsed()); };
    useStore.getState().patchDraft({ recording: true, audio: null, transcript: '', interim: '' });
    setTrFailed(false);
    const t = createTranscriber(settings?.transcriber ?? 'browser');
    tr.current = t;
    t.start((finalText, interim) => useStore.getState().patchDraft({ transcript: finalText, interim }));
  };

  const stopRecording = async () => {
    const r = rec.current; rec.current = null;
    if (!r) return;
    const [audio, text] = await Promise.all([r.stop(), tr.current?.stop() ?? Promise.resolve('')]);
    tr.current = null;
    const d = useStore.getState().draft;
    useStore.getState().patchDraft({ recording: false, audio, transcript: (text || d?.transcript || '').trim(), interim: '' });
    setLevels([]);
  };

  const toggleRecord = () => (rec.current ? stopRecording() : startRecording());

  const post = async () => {
    if (busy) return;
    if (rec.current) await stopRecording();
    const st = useStore.getState();
    const d = st.draft;
    const text = inputRef.current?.value ?? d?.text ?? '';
    if (!d || (!text.trim() && !d.shapes.length && !d.audio && !d.transcript)) {
      shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.35 } });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      let c = await api.createComment({ version_id: version.id, timestamp: d.t, text, transcript: d.transcript, drawing: d.shapes.length ? { shapes: d.shapes } : null });
      if (d.audio) c = await api.uploadAudio(c.id, d.audio.blob, d.audio.duration, d.audio.peaks);
      st.upsertComment(c);
      st.clearDraft();
      if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = ''; inputRef.current.blur(); }
      st.set({ selectedId: c.id });
      st.toast({ text: `Comment pinned at ${tc(c.timestamp)}`, tone: 'accent' });
      st.loadVideos();
    } catch (e: any) {
      st.toast({ text: e.message, tone: 'error' });
    } finally { setBusy(false); }
  };

  composer.focus = (t?: number) => { anchor(t); requestAnimationFrame(() => inputRef.current?.focus()); };
  composer.toggleRecord = toggleRecord;
  composer.post = post;

  useEffect(() => () => { rec.current?.cancel(); tr.current?.stop(); }, []);
  useEffect(() => { if (!draft && inputRef.current) inputRef.current.value = ''; }, [draft]);

  const recording = !!draft?.recording;
  const hasDraft = !!draft;
  const liveText = [draft?.transcript, draft?.interim].filter(Boolean).join(' ');

  return (
    <motion.div className="feedback" style={{ width }} animate={shake}>
      <AnimatePresence>
        {(recording || draft?.transcript) && (
          <motion.div className="transcript-line" initial={{ opacity: 0, y: 6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: 4, height: 0 }} transition={spring.bar}>
            <span className="tl-label">{recording ? 'Listening' : 'Transcript'}</span>
            <span className={liveText ? '' : 'dim'}>
              {liveText || (trFailed ? 'Live transcription isn’t available right now — your voice note is still recorded.' : createTranscriber(settings?.transcriber ?? 'browser').available ? 'Start talking…' : settings?.transcriber === 'whisper' ? 'Will be transcribed locally with whisper.cpp' : 'Live transcription isn’t available in this browser')}
              {draft?.interim && <span className="dim"> </span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div layout className={`fb-bar ${recording ? 'recording' : ''} ${hasDraft ? 'composing' : ''}`} transition={spring.bar}>
        <motion.button layout className="fb-voice" onClick={toggleRecord} transition={spring.bar} title={recording ? 'Stop recording (R)' : 'Record a voice note (R)'} aria-pressed={recording}>
          <span className={`fb-wave ${recording ? 'live' : ''}`}><DotWave levels={recording ? levels.map((l) => Math.min(1, l * 1.6)) : undefined} live={recording} /></span>
          <AnimatePresence mode="popLayout" initial={false}>
            {recording ? (
              <motion.span key="rec" className="fb-voice-label rec mono" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.pop}>
                {tc(elapsed)} <IStop size={14} />
              </motion.span>
            ) : (
              <motion.span key="idle" className="fb-voice-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.pop}>
                {draft?.audio ? 'Re-record' : 'Voice note'}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        <div className="fb-input">
          <button className={`time-chip mono ${hasDraft ? 'pinned' : ''}`} onClick={() => { if (draft) player.seek(draft.t); else anchor(); }} title={hasDraft ? 'This comment is pinned here — click to jump back' : 'Comment at the current frame'}>
            {hasDraft ? tc(draft!.t, true) : <span ref={nowRef}>{tc(timeBus.get(), true)}</span>}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={recording ? 'Type while you talk…' : 'Leave feedback…'}
            onFocus={() => anchor()}
            onChange={(e) => {
              useStore.getState().patchDraft({ text: e.target.value });
              e.target.style.height = ''; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); post(); }
              if (e.key === 'Escape') { e.preventDefault(); if (rec.current) { rec.current.cancel(); rec.current = null; tr.current?.stop(); } useStore.getState().clearDraft(); (e.target as HTMLTextAreaElement).blur(); }
              e.stopPropagation();
            }}
          />
          <AnimatePresence>
            {!!draft?.shapes.length && (
              <motion.span key="d" className="att" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.pop}>
                <IPen size={12} /> {draft.shapes.length}
                <button onClick={() => useStore.getState().patchDraft({ shapes: [] })} aria-label="Remove drawing"><IX size={11} /></button>
              </motion.span>
            )}
            {draft?.audio && (
              <motion.span key="a" className="att voice" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.pop}>
                <button className="att-play" onClick={() => new Audio(draft.audio!.url).play()} aria-label="Play voice note">▶</button>
                <span className="mono">{tc(draft.audio.duration)}</span>
                <button onClick={() => useStore.getState().patchDraft({ audio: null, transcript: '' })} aria-label="Remove voice note"><IX size={11} /></button>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <button className={`fb-icon ${tool ? 'on' : ''}`} onClick={() => { if (tool) useStore.getState().set({ tool: null }); else { anchor(); useStore.getState().set({ tool: 'pen' }); } }} title="Draw on the frame (D)" aria-pressed={!!tool}>
          <IPen size={17} />
        </button>
        <motion.button className="fb-send" onClick={post} whileTap={{ scale: 0.88 }} transition={spring.pop} title="Post comment (Enter)" aria-label="Post comment" disabled={busy}>
          <IArrowUp size={16} />
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
