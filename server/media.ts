import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { POSTER_DIR } from './paths.js';

const require = createRequire(import.meta.url);

/** Path to the bundled ffmpeg binary (ffmpeg-static), with a PATH fallback. */
export const FFMPEG: string = (() => {
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return 'ffmpeg';
})();

function run(args: string[], input?: Buffer): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { if (err.length < 200_000) err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err }));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

/** Reads basic stream info from `ffmpeg -i` (ffmpeg-static ships no ffprobe). Never decodes the file. */
export async function probe(file: string): Promise<Probe> {
  const { stderr } = await run(['-hide_banner', '-i', file]);
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const vline = stderr.split('\n').find((l) => /Stream #.*Video:/.test(l)) || '';
  const codec = /Video:\s*([a-z0-9_]+)/i.exec(vline)?.[1] || '';
  const dims = /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(vline);
  let width = dims ? +dims[1] : 0;
  let height = dims ? +dims[2] : 0;
  const fpsM = /([\d.]+)\s*fps/.exec(vline) || /([\d.]+)\s*tbr/.exec(vline);
  const fps = fpsM ? +fpsM[1] : 30;
  const rot = /rotation of (-?[\d.]+) degrees/.exec(stderr) || /rotate\s*:\s*(-?\d+)/.exec(stderr);
  if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) [width, height] = [height, width];
  if (!vline) throw new Error('No video stream found — is this a video file?');
  return { duration, width, height, fps: fps > 0 && fps < 1000 ? fps : 30, codec };
}

export interface RGBAFrame { width: number; height: number; data: Buffer }

/**
 * Decodes exactly one frame at `t` seconds to raw RGBA. Input seeking (-ss before -i) makes this
 * fast even for huge files. Output size is clamped to `maxWidth` while keeping aspect ratio.
 */
export async function frameRGBA(file: string, t: number, src: { width: number; height: number }, maxWidth = 1280): Promise<RGBAFrame> {
  const scale = Math.min(1, maxWidth / Math.max(1, src.width));
  const width = Math.max(2, Math.round((src.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((src.height * scale) / 2) * 2);
  const ss = Math.max(0, t).toFixed(3);
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', ss, '-i', file, '-frames:v', '1',
    '-vf', `scale=${width}:${height}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
  let r = await run(args);
  if (r.stdout.length < width * height * 4) {
    // Seeking past the last keyframe near the end can yield nothing; back off slightly.
    args[4] = Math.max(0, t - 0.5).toFixed(3);
    r = await run(args);
  }
  if (r.stdout.length < width * height * 4) throw new Error(`Could not decode a frame at ${t}s: ${r.stderr.trim().slice(0, 300)}`);
  return { width, height, data: r.stdout.subarray(0, width * height * 4) };
}

/** Cached JPEG poster for library cards. */
export async function poster(versionId: string, file: string, duration: number): Promise<string> {
  const out = path.join(POSTER_DIR, `${versionId}.jpg`);
  if (fs.existsSync(out)) return out;
  const t = duration > 4 ? Math.min(duration * 0.1, 8) : 0;
  const tmp = out + '.tmp.jpg';
  const r = await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', file,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error('poster failed');
  fs.renameSync(tmp, out);
  return out;
}

/** Converts any audio to 16kHz mono WAV (for whisper.cpp). */
export async function toWav16k(input: string, output: string): Promise<void> {
  const r = await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', output]);
  if (r.code !== 0) throw new Error(r.stderr);
}
