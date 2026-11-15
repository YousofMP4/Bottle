import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import type { Version } from '../../../server/types';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { player, timeBus } from '../lib/bus';
import { voice, useVoice } from '../lib/voice';
import { VoiceRecorder } from '../lib/recorder';
import { createTranscriber, type LiveTranscriber } from '../lib/transcriber';
import { tc } from '../lib/time';
import { spring } from '../lib/motion';
import { DotWave, IArrowUp, IChevronDown, IPause, IPen, IPlay, IStop, IX } from './Icons';
import { tip } from './Tooltip';
import { showMenu } from './ContextMenu';

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
  /** Waiting on the browser's microphone permission (can take a while if a prompt is open). */
  const [asking, setAsking] = useState(false);
  const askId = useRef(0);
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
    // Pressing R again while we're still waiting for permission cancels the request.
    if (asking) { askId.current++; setAsking(false); return; }
    anchor();
    const r = new VoiceRecorder();
    const id = ++askId.current;
    setAsking(true);
    const slow = window.setTimeout(() => {
      if (askId.current === id) useStore.getState().toast({ text: 'Waiting for your microphone', sub: 'Allow access in the browser prompt, or press R to cancel.', ms: 6000 });
    }, 2500);
    try { await r.start(); } catch (e: any) {
      clearTimeout(slow);
      if (askId.current !== id) return;
      setAsking(false);
      const blocked = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      useStore.getState().toast(blocked
        ? { text: 'Microphone is blocked', sub: 'Allow it in your browser’s site settings, then press R again.', tone: 'error' }
        : { text: 'No microphone found', sub: 'Connect one, then press R again.', tone: 'error' });
      return;
    }
    clearTimeout(slow);
    if (askId.current !== id) { r.cancel(); return; } // cancelled while waiting
    setAsking(false);
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
    const text = d?.text ?? '';
    if (!d || (!text.trim() && !d.shapes.length && !d.audio && !d.transcript)) {
      // Same damped nudge as the reference app: -4, 3.5, -2.5, 1.5, -0.5px.
      shake.start({ x: [0, -4, 3.5, -2.5, 1.5, -0.5, 0], transition: { duration: 0.4, ease: 'easeOut' } });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      let c = await api.createComment({ version_id: version.id, timestamp: d.t, text, transcript: d.transcript, drawing: d.shapes.length ? { shapes: d.shapes } : null });
      if (d.audio) c = await api.uploadAudio(c.id, d.audio.blob, d.audio.duration, d.audio.peaks);
      st.upsertComment(c);
      st.clearDraft();
      if (inputRef.current) { inputRef.current.style.height = ''; inputRef.current.blur(); }
      st.set({ selectedId: c.id });
      st.toast({ text: `Comment pinned at ${tc(c.timestamp)}`, sub: 'It goes to your agent when you press Send to agent.', tone: 'accent' });
      st.loadVideos();
    } catch (e: any) {
      st.toast({ text: e.message, tone: 'error' });
    } finally { setBusy(false); }
  };

  // Focus synchronously so keys typed right after pressing C land in the box, not on shortcuts.
  composer.focus = (t?: number) => { anchor(t); inputRef.current?.focus({ preventScroll: true }); };
  composer.toggleRecord = toggleRecord;
  composer.post = post;

  useEffect(() => () => { rec.current?.cancel(); tr.current?.stop(); }, []);
  useEffect(() => { if (!draft) { voice.release('draft'); if (inputRef.current) inputRef.current.style.height = ''; } }, [draft]);

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
        <motion.button layout className={`fb-voice ${asking ? 'asking' : ''}`} onClick={toggleRecord} transition={spring.bar} aria-pressed={recording} aria-busy={asking} {...tip(asking ? 'Waiting for microphone · click to cancel' : recording ? 'Stop recording' : draft?.audio ? 'Record the voice note again' : 'Record a voice note', 'R', { aria: false })}>
          <span className={`fb-wave ${recording ? 'live' : ''}`}><DotWave levels={recording ? levels.map((l) => Math.min(1, l * 1.6)) : undefined} live={recording} /></span>
          <AnimatePresence mode="popLayout" initial={false}>
            {asking ? (
              <motion.span key="ask" className="fb-voice-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.pop}>
                <i className="live-dot" /> Allow mic…
              </motion.span>
            ) : recording ? (
              <motion.span key="rec" className="fb-voice-label rec mono" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.pop}>
                <i className="led red blink" /> {tc(elapsed)} <IStop size={14} />
              </motion.span>
            ) : (
              <motion.span key="idle" className="fb-voice-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.pop}>
                {draft?.audio ? 'Re-record' : 'Voice note'}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
        <button
          className="fb-mode"
          aria-haspopup="menu"
          {...tip('Feedback options')}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const tr = settings?.transcriber ?? 'browser';
            const setTr = async (t: 'browser' | 'whisper' | 'off') => { const s = await api.saveSettings({ transcriber: t }); useStore.getState().set({ settings: s }); };
            showMenu({ clientX: r.left - 4, clientY: r.top - 8 - 6 * 34 }, [
              { label: recording ? 'Stop voice note' : 'Voice note', kbd: 'R', icon: <span className={`led ${recording ? 'red blink' : ''}`} />, run: toggleRecord },
              { label: 'Draw on the frame', kbd: 'D', icon: <IPen size={13} />, run: () => { anchor(); useStore.getState().set({ tool: 'pen' }); } },
              { label: 'Type a note', kbd: 'C', run: () => composer.focus() },
              'sep',
              { label: 'Transcribe voice notes', submenu: ([['browser', 'Live, in the browser'], ['whisper', 'whisper.cpp, on this Mac'], ['off', 'Off (audio only)']] as const).map(([id, label]) => ({ label, icon: <span className={`radio-mini ${tr === id ? 'on' : ''}`} />, run: () => setTr(id) })) },
            ]);
          }}
        ><IChevronDown size={14} /></button>

        <div className="fb-input">
          <button className={`time-chip mono ${hasDraft ? 'pinned' : ''}`} onClick={() => { if (draft) player.seek(draft.t); else anchor(); }} {...tip(hasDraft ? 'Pinned here · click to jump back' : 'Comment at this frame', hasDraft ? undefined : 'C')}>
            {hasDraft ? tc(draft!.t, true) : <span ref={nowRef}>{tc(timeBus.get(), true)}</span>}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            aria-label="Comment"
            value={draft?.text ?? ''}
            placeholder={recording ? 'Type while you talk…' : 'Leave feedback…'}
            onFocus={() => anchor()}
            onChange={(e) => {
              useStore.getState().patchDraft({ text: e.target.value });
              e.target.style.height = ''; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); post(); }
              if (e.key === 'Escape') { e.preventDefault(); askId.current++; setAsking(false); if (rec.current) { rec.current.cancel(); rec.current = null; tr.current?.stop(); } useStore.getState().clearDraft(); (e.target as HTMLTextAreaElement).blur(); }
              e.stopPropagation();
            }}
          />
          <AnimatePresence>
            {!!draft?.shapes.length && (
              <motion.span key="d" className="att" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.pop}>
                <IPen size={12} /> {draft.shapes.length}
                <button onClick={() => useStore.getState().patchDraft({ shapes: [] })} {...tip('Remove drawing')}><IX size={11} /></button>
              </motion.span>
            )}
            {draft?.audio && (
              <motion.span key="a" className="att voice" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.pop}>
                <DraftClipButton url={draft.audio.url} duration={draft.audio.duration} />
                <span className="mono">{tc(draft.audio.duration)}</span>
                <button onClick={() => { voice.release('draft'); useStore.getState().patchDraft({ audio: null, transcript: '' }); }} {...tip('Remove voice note')}><IX size={11} /></button>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <button className={`fb-icon ${tool ? 'on' : ''}`} onClick={() => { if (tool) useStore.getState().set({ tool: null }); else { anchor(); useStore.getState().set({ tool: 'pen' }); } }} aria-pressed={!!tool} {...tip(tool ? 'Stop drawing' : 'Draw on the frame', tool ? 'Esc' : 'D')}>
          <IPen size={17} />
        </button>
        <button className={`fb-send ${busy ? 'busy' : ''}`} onClick={post} aria-busy={busy} {...tip('Post comment', '↩')}>
          {busy ? <span className="spinner sm" /> : <IArrowUp size={16} />}
        </button>
      </motion.div>
    </motion.div>
  );
}

function DraftClipButton({ url, duration }: { url: string; duration: number }) {
  const { playing } = useVoice('draft');
  // A new recording gets a new blob URL; make sure the controller doesn't keep the old one.
  useEffect(() => () => voice.release('draft'), [url]);
  return (
    <button className="att-play" onClick={() => voice.toggle('draft', url, duration)} aria-pressed={playing} {...tip(playing ? 'Pause voice note' : 'Play voice note')}>
      {playing ? <IPause size={10} /> : <IPlay size={10} />}
    </button>
  );
}
