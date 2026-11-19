import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { auth, join } from '../lib/cloud';
import { Wordmark } from './Icons';

/** Online sign-in. `setup` is the one-time owner account creation (needs the setup code). */
export function SignIn({ mode, onDone }: { mode: 'login' | 'setup'; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) || '');
    setBusy(true); setError('');
    try {
      if (mode === 'setup') {
        if (v('password') !== v('confirm')) throw new Error('The two passwords don’t match.');
        await auth.setup({ code: v('code'), email: v('email'), name: v('name'), password: v('password') });
      } else {
        await auth.login(v('email'), v('password'));
      }
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <motion.form className="signin-card" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}>
        <div className="signin-mark"><Wordmark height={44} /></div>
        <h1>{mode === 'setup' ? 'Set up Portal' : 'Sign in'}</h1>
        <p className="dim">{mode === 'setup' ? 'Create the owner account. You’ll need the setup code you were given.' : 'Your projects and reviews from Gleam Films.'}</p>
        {mode === 'setup' && (
          <>
            <label>Setup code<input className="field" name="code" autoComplete="one-time-code" required /></label>
            <label>Your name<input className="field" name="name" autoComplete="name" required /></label>
          </>
        )}
        <label>Email<input className="field" name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input className="field" name="password" type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} minLength={mode === 'setup' ? 10 : undefined} required /></label>
        {mode === 'setup' && <label>Confirm password<input className="field" name="confirm" type="password" autoComplete="new-password" required /></label>}
        {error && <p className="error-text small">{error}</p>}
        <button className="btn primary lg" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'setup' ? 'Create account' : 'Sign in'}</button>
      </motion.form>
    </div>
  );
}

/** Where an invite link lands: one short form, then straight into the workspace. */
export function Join({ token }: { token: string }) {
  const [info, setInfo] = useState<{ valid: boolean; name?: string; workspace?: string; from?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { join.info(token).then(setInfo).catch(() => setInfo({ valid: false })); }, [token]);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError('');
    try {
      await join.accept(token, { name: String(f.get('name') || ''), email: String(f.get('email') || ''), password: String(f.get('password') || '') });
      location.replace('/#/projects');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  if (!info) return <div className="signin" />;
  return (
    <div className="signin">
      <motion.form className="signin-card" onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}>
        <div className="signin-mark"><Wordmark height={44} /></div>
        {info.valid ? (
          <>
            <h1>Welcome{info.name ? `, ${info.name.split(' ')[0]}` : ''}</h1>
            <p className="dim">{info.from} invited you to review <b>{info.workspace}</b> videos on Portal. Pick a password and you’re in.</p>
            <label>Your name<input className="field" name="name" defaultValue={info.name} autoComplete="name" required /></label>
            <label>Email<input className="field" name="email" type="email" autoComplete="email" required autoFocus /></label>
            <label>Password<input className="field" name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
            {error && <p className="error-text small">{error}</p>}
            <button className="btn primary lg" type="submit" disabled={busy}>{busy ? 'One moment…' : 'Join'}</button>
            <p className="dim small signin-foot">Next time, sign in at portal.gleamfilms.com with this email and password.</p>
          </>
        ) : (
          <>
            <h1>This link has expired</h1>
            <p className="dim">Invite links work once and last 30 days. Ask Gleam Films for a new one, or sign in if you already joined.</p>
            <a className="btn primary lg" href="/">Go to sign in</a>
          </>
        )}
      </motion.form>
    </div>
  );
}
