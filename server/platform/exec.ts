import { spawn } from 'node:child_process';
export function exec(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const t = opts.timeoutMs ? setTimeout(() => p.kill(), opts.timeoutMs) : null;
    p.on('error', (e) => { if (t) clearTimeout(t); resolve({ code: 127, stdout, stderr: String(e) }); });
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}
export async function which(bin: string): Promise<boolean> {
  const r = await exec(process.platform === 'win32' ? 'where' : 'which', [bin]);
  return r.code === 0;
}
export class PickerUnavailable extends Error {}
