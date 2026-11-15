export function tc(s: number, precise = false): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = precise ? sec.toFixed(2).padStart(5, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
