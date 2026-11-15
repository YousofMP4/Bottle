import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Settings } from '../../../server/types';
import { useStore } from '../lib/store';
import { api, type ConnectInfo } from '../lib/api';
import { spring } from '../lib/motion';
import { Dialog } from './Dialog';
import { ICheck, ICopy } from './Icons';

export function SettingsDialog() {
  const open = useStore((s) => s.dialog === 'settings');
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [connect, setConnect] = useState<ConnectInfo | null>(null);
  const [tab, setTab] = useState<'code' | 'desktop'>('code');
  const [hook, setHook] = useState<string | null>(null);

  useEffect(() => { if (open) api.connect().then(setConnect).catch(() => {}); }, [open]);

  const save = async (p: Partial<Settings>) => {
    set({ settings: { ...settings!, ...p } });
    try { set({ settings: await api.saveSettings(p) }); } catch (e: any) { toast({ text: e.message, tone: 'error' }); }
  };
  if (!settings) return null;

  return (
    <Dialog open={open} onClose={() => set({ dialog: null })} title="Settings" wide>
      <div className="settings">
        <section>
          <h3>Connect to Claude</h3>
          <p className="muted">Give Claude the Bottle tools so it can read your revisions, see your drawings, and post new versions. Pick where you use Claude, copy, done.</p>
          <div className="seg small" role="tablist">
            {([['code', 'Claude Code'], ['desktop', 'Claude Desktop']] as const).map(([id, label]) => (
              <button key={id} className={`seg-btn ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                {tab === id && <motion.span layoutId="connect-tab" className="seg-active" transition={spring.morph} />}
                <span className="seg-label">{label}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {connect ? (
                tab === 'code' ? (
                  <>
                    <p className="step">Run this once in Terminal:</p>
                    <CodeBlock text={connect.claudeCode} />
                    <p className="dim small">Then in Claude Code, try: <i>“Wait for my Bottle revisions and fix them.”</i></p>
                  </>
                ) : (
                  <>
                    <p className="step">Paste into <code className="inline">{connect.claudeDesktopPath}</code> (merge with any existing <code className="inline">mcpServers</code>), then restart Claude Desktop:</p>
                    <CodeBlock text={connect.claudeDesktop} />
                  </>
                )
              ) : <div className="skeleton" />}
              {connect && !connect.built && <p className="error-text small">The MCP server isn’t built yet — run Start.command once and it will be.</p>}
            </motion.div>
          </AnimatePresence>
        </section>

        <section>
          <h3>When you send revisions</h3>
          <Toggle label="Agent can wait for them" hint="The wait_for_revisions tool returns the moment you press Send." checked disabled onChange={() => {}} />
          <Toggle label="Write revisions.md next to the video" hint="A plain-text file any agent can read, saved beside your video file." checked={settings.revisions_md} onChange={(v) => save({ revisions_md: v })} />
          <Toggle label="Call a webhook" hint="POSTs the revisions as JSON to a URL you choose." checked={settings.webhook_enabled} onChange={(v) => save({ webhook_enabled: v })} />
          <AnimatePresence initial={false}>
            {settings.webhook_enabled && (
              <motion.div className="row gap indent" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.bar}>
                <input className="field grow mono" placeholder="https://example.com/hooks/bottle" defaultValue={settings.webhook_url} onBlur={(e) => save({ webhook_url: e.target.value.trim() })} />
                <button className="btn" onClick={async () => {
                  const url = (document.querySelector('.settings input.mono') as HTMLInputElement)?.value || settings.webhook_url;
                  setHook('…'); const r = await api.testWebhook(url); setHook(r.ok ? `✓ ${r.status}` : `✕ ${r.error || r.status}`);
                }}>Test</button>
                {hook && <span className="dim small">{hook}</span>}
              </motion.div>
            )}
          </AnimatePresence>
          <p className="dim small">“Copy message for my agent” is always available from the review screen.</p>
        </section>

        <section>
          <h3>Voice notes</h3>
          <p className="muted">Agents can’t hear audio, so Bottle saves a transcript with every voice note.</p>
          <div className="radio-list">
            {([
              ['browser', 'Live, in the browser', 'Words appear as you talk. Uses your browser’s speech engine (Chrome may send audio to Google to do this).'],
              ['whisper', 'whisper.cpp, on this Mac', 'Fully offline. Transcribed right after you stop recording.'],
              ['off', 'Off', 'Keep the audio only.'],
            ] as const).map(([id, label, hint]) => (
              <label key={id} className={`radio ${settings.transcriber === id ? 'on' : ''}`}>
                <input type="radio" name="tr" checked={settings.transcriber === id} onChange={() => save({ transcriber: id })} />
                <span className="radio-dot" />
                <span><b>{label}</b><span className="dim small block">{hint}</span></span>
              </label>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {settings.transcriber === 'whisper' && (
              <motion.div className="stack indent" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.bar}>
                <input className="field mono" placeholder="/opt/homebrew/bin/whisper-cli" defaultValue={settings.whisper_bin} onBlur={(e) => save({ whisper_bin: e.target.value.trim() })} />
                <input className="field mono" placeholder="/path/to/ggml-base.en.bin" defaultValue={settings.whisper_model} onBlur={(e) => save({ whisper_model: e.target.value.trim() })} />
                <p className="dim small">Install with <code className="inline">brew install whisper-cpp</code> and download a model (e.g. ggml-base.en.bin).</p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section>
          <h3>Feel</h3>
          <Toggle label="Click sounds" hint="A soft mechanical click when you press buttons, like real hardware." checked={settings.click_sound} onChange={(v) => { save({ click_sound: v }); if (v) import('../lib/sfx').then((m) => m.click()); }} />
        </section>

        <section>
          <h3>You</h3>
          <div className="row gap">
            <label className="dim small" htmlFor="name">Name on your comments</label>
            <input id="name" className="field" defaultValue={settings.name} onBlur={(e) => save({ name: e.target.value.trim() || 'You' })} />
          </div>
          {connect && <p className="dim small">Your data lives in <code className="inline">{connect.dataDir}</code>. Videos stay where they are.</p>}
        </section>
      </div>
    </Dialog>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
      <span><b>{label}</b>{hint && <span className="dim small block">{hint}</span>}</span>
      <button role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <motion.span className="switch-knob" layout transition={spring.pop} />
      </button>
    </label>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <pre>{text}</pre>
      <button className={`copy-btn ${copied ? 'ok' : ''}`} onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={copied ? 'y' : 'n'} className="row gap-s" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={spring.pop}>
            {copied ? <><ICheck size={14} /> Copied</> : <><ICopy size={14} /> Copy</>}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
