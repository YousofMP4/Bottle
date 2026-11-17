/**
 * Talks to Portal online (portal.gleamfilms.com) for Claude's tools: uploads a rendered file from
 * this Mac and reads/updates projects there. Signs in with a private access key kept in
 * ~/Library/Application Support/Portal/online.json (or PORTAL_ONLINE_URL / PORTAL_ONLINE_KEY).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG, probe } from './media.js';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ONLINE_CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'Portal', 'online.json');

function config(): { url: string; key: string } {
  let url = process.env.PORTAL_ONLINE_URL || '';
  let key = process.env.PORTAL_ONLINE_KEY || '';
  if ((!url || !key) && fs.existsSync(ONLINE_CONFIG)) {
    const c = JSON.parse(fs.readFileSync(ONLINE_CONFIG, 'utf8'));
    url ||= c.url; key ||= c.key;
  }
  if (!url || !key) throw new Error(`Portal online isn't connected on this Mac yet (no access key in ${ONLINE_CONFIG}).`);
  return { url: url.replace(/\/$/, ''), key };
}

async function call<T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const { url, key } = config();
  const init: RequestInit = { method, headers: { authorization: `Bearer ${key}`, ...headers } };
  if (body instanceof Blob || body instanceof Uint8Array) init.body = body as any;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as any)['content-type'] = 'application/json'; }
  const res = await fetch(url + p, init);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Portal online answered ${res.status}`);
  return data as T;
}

export const onlineUrl = () => config().url;
export const listOnlineProjects = () => call<any[]>('GET', '/api/projects');

export async function updateOnlineProject(project: string, patch: Record<string, unknown>) {
  const projects = await listOnlineProjects();
  const p = projects.find((x) => x.project_id === project) ?? projects.find((x) => x.name.toLowerCase() === project.trim().toLowerCase());
  if (!p) throw new Error(`No project named “${project}” online. Projects: ${projects.map((x) => x.name).join(', ') || 'none'}`);
  await call('PATCH', `/api/folders/${p.project_id}`, patch);
  return (await listOnlineProjects()).find((x) => x.project_id === p.project_id);
}

function posterJpeg(file: string, duration: number): Promise<Buffer | null> {
  const t = duration > 4 ? Math.min(duration * 0.1, 8) : 0;
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (err, out) => resolve(err || !out?.length ? null : out));
  });
}

/** Uploads a local video file to Portal online, as a new video or the next version of one. */
export async function uploadOnline(file: string, opts: { project?: string; title?: string; videoId?: string } = {}, onProgress?: (done: number, total: number) => void) {
  let p = file.trim().replace(/^file:\/\//, '');
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(p);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`File not found: ${p}`);
  const size = fs.statSync(p).size;
  const info = await probe(p);
  const name = path.basename(p);
  const type = /\.mov$/i.test(name) ? 'video/quicktime' : /\.webm$/i.test(name) ? 'video/webm' : 'video/mp4';
  const start = await call<{ key: string; uploadId: string; partSize: number }>('POST', '/api/uploads', { filename: name, size, type });
  const blob = await fs.openAsBlob(p, { type });
  const parts: { partNumber: number; etag: string }[] = [];
  const total = Math.max(1, Math.ceil(size / start.partSize));
  try {
    for (let i = 0; i < total; i++) {
      const chunk = blob.slice(i * start.partSize, Math.min(size, (i + 1) * start.partSize));
      let attempt = 0;
      for (;;) {
        try {
          parts.push(await call('PUT', `/api/uploads/part?key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}&part=${i + 1}`, chunk));
          break;
        } catch (e) { if (++attempt > 2) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
      }
      onProgress?.(Math.min(size, (i + 1) * start.partSize), size);
    }
  } catch (e) {
    await call('POST', '/api/uploads/abort', { key: start.key, uploadId: start.uploadId }).catch(() => {});
    throw e;
  }
  const r = await call<any>('POST', '/api/uploads/complete', {
    key: start.key, uploadId: start.uploadId, parts, filename: name, title: opts.title, videoId: opts.videoId, project: opts.project,
    duration: info.duration, width: info.width, height: info.height, fps: info.fps,
  });
  const jpg = await posterJpeg(p, info.duration);
  if (jpg) await call('PUT', `/api/versions/${r.version.id}/poster`, new Uint8Array(jpg), { 'content-type': 'image/jpeg' }).catch(() => {});
  return { ...r, review_url: `${config().url}/#/v/${r.video.id}` };
}

/**
 * Downloads a video's original file from Portal online to this Mac (default ~/Downloads).
 * `video` is a video id or title; `version` defaults to the latest. Never overwrites a file.
 */
export async function downloadOnline(video: string, opts: { version?: number; dest?: string } = {}) {
  const { url, key } = config();
  const vids = await call<any[]>('GET', '/api/videos');
  const q = video.trim().toLowerCase();
  const v = vids.find((x) => x.id === video) ?? vids.find((x) => x.title.toLowerCase() === q) ?? vids.find((x) => x.title.toLowerCase().includes(q));
  if (!v) throw new Error(`No video matching “${video}” online. Videos: ${vids.map((x) => x.title).slice(0, 30).join(', ') || 'none'}`);
  const detail = await call<any>('GET', `/api/videos/${v.id}`);
  const ver = opts.version ? detail.versions.find((x: any) => x.number === opts.version) : detail.versions[detail.versions.length - 1];
  if (!ver) throw new Error(`“${v.title}” has no v${opts.version}. It has v${detail.versions.map((x: any) => x.number).join(', v')}.`);
  let dir = opts.dest?.trim() || path.join(os.homedir(), 'Downloads');
  if (dir.startsWith('~')) dir = path.join(os.homedir(), dir.slice(1));
  dir = path.resolve(dir);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(ver.filename) || '.mp4';
  const stem = path.basename(ver.filename, ext);
  let out = path.join(dir, ver.filename);
  for (let i = 2; fs.existsSync(out); i++) out = path.join(dir, `${stem} (${i})${ext}`);
  const res = await fetch(`${url}/media/${ver.id}?download=1`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const tmp = out + '.part';
  try {
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, out);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return { video_id: v.id, title: v.title, version: ver.number, path: out, size: fs.statSync(out).size };
}

/** Marks online videos (ids or titles) as being revised so clients see "New version coming soon", or clears it. */
export async function setRevisingOnline(videos: string[], on: boolean, note?: string) {
  const all = await call<any[]>('GET', '/api/videos');
  const ids = videos.map((q) => {
    const t = q.trim().toLowerCase();
    const v = all.find((x) => x.id === q) ?? all.find((x) => x.title.toLowerCase() === t) ?? all.find((x) => x.title.toLowerCase().includes(t));
    if (!v) throw new Error(`No video matching “${q}” online. Videos: ${all.map((x) => x.title).slice(0, 30).join(', ') || 'none'}`);
    return v.id;
  });
  const out = await call<any[]>('POST', '/api/videos/revising', { ids: [...new Set(ids)], on, note });
  return out.map((v) => ({ video_id: v.id, title: v.title, being_revised: !!v.revising_at, note: v.revising_note ?? null }));
}
