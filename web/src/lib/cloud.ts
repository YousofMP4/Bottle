/**
 * Portal online (portal.gleamfilms.com) runs the same app against a Cloudflare Worker. There is no
 * local disk there: videos are uploaded from the browser, people sign in, and Mac-only actions
 * (Show in Finder, file paths) are hidden.
 */
import type { AddResult } from './api';
import type { Workspace } from '../../../server/types';

/** The cloud build sets VITE_PORTAL_CLOUD (cloud/vite.config.ts); the Mac app never does. */
export const CLOUD = (import.meta as any).env?.VITE_PORTAL_CLOUD === '1';

async function req<T>(method: string, url: string, body?: BodyInit | object, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body as BodyInit;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as any)['content-type'] = 'application/json'; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e: any = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data as T;
}

export interface Me { id: string; email: string; name: string; role: 'owner' | 'editor' | 'client' }
export interface Members { people: { id: string; name: string; email: string; role: string }[]; pending: { id: string; name: string; created_at: number; expires_at: number }[] }
export const workspacesApi = {
  list: () => req<Workspace[]>('GET', '/api/workspaces'),
  create: (name: string) => req<Workspace>('POST', '/api/workspaces', { name }),
  rename: (id: string, name: string) => req<Workspace>('PATCH', `/api/workspaces/${id}`, { name }),
  remove: (id: string) => req('DELETE', `/api/workspaces/${id}`),
  members: (id: string) => req<Members>('GET', `/api/workspaces/${id}/members`),
  removeMember: (id: string, userId: string) => req('DELETE', `/api/workspaces/${id}/members/${userId}`),
  invite: (workspace_id: string, name: string) => req<{ url: string; name: string; workspace: string; expires_days: number }>('POST', '/api/invites', { workspace_id, name }),
  cancelInvite: (id: string) => req('DELETE', `/api/invites/${id}`),
};
export const join = {
  info: (token: string) => req<{ valid: boolean; name?: string; workspace?: string; from?: string }>('GET', `/api/join/${token}`),
  accept: (token: string, b: { name: string; email: string; password: string }) => req('POST', `/api/join/${token}`, b),
};

export interface AuthState { setup_needed: boolean; user: Me | null }
export const auth = {
  state: () => req<AuthState>('GET', '/api/auth/state'),
  login: (email: string, password: string) => req('POST', '/api/auth/login', { email, password }),
  setup: (b: { code: string; email: string; name: string; password: string }) => req('POST', '/api/auth/setup', b),
  logout: () => req('POST', '/api/auth/logout'),
};

/** Opens the browser's file picker for one video. Resolves null if cancelled. */
export function chooseVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.mov,.mp4,.m4v,.webm,.mkv';
    let settled = false;
    const done = (f: File | null) => { if (!settled) { settled = true; resolve(f); } };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Duration, size and a poster frame, read in the browser before uploading. */
async function probe(file: File): Promise<{ duration: number; width: number; height: number; poster: Blob | null }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('This browser can’t read that video.')); setTimeout(() => res(), 8000); });
    const duration = isFinite(v.duration) ? v.duration : 0;
    let poster: Blob | null = null;
    try {
      v.currentTime = Math.min(Math.max(0.5, duration * 0.1), Math.max(0, duration - 0.1));
      await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 5000); });
      const w = Math.min(960, v.videoWidth || 960), h = Math.round(w * ((v.videoHeight || 540) / (v.videoWidth || 960)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(v, 0, 0, w, h);
      poster = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    } catch { /* poster is optional */ }
    return { duration, width: v.videoWidth, height: v.videoHeight, poster };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src'); v.load();
  }
}

/**
 * Uploads in parts (Workers accept at most 100 MB per request), straight into R2 through the Worker.
 * Calls onProgress with 0..1.
 */
export async function uploadVideo(file: File, opts: { videoId?: string; folderId?: string | null }, onProgress: (p: number) => void): Promise<AddResult> {
  const meta = await probe(file);
  const start = await req<{ key: string; uploadId: string; partSize: number }>('POST', '/api/uploads', { filename: file.name, size: file.size, type: file.type || 'video/mp4' });
  const parts: { partNumber: number; etag: string }[] = [];
  const total = Math.max(1, Math.ceil(file.size / start.partSize));
  try {
    for (let i = 0; i < total; i++) {
      const chunk = file.slice(i * start.partSize, Math.min(file.size, (i + 1) * start.partSize));
      const part = await putWithProgress(`/api/uploads/part?key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}&part=${i + 1}`, chunk,
        (loaded) => onProgress(Math.min(0.99, (i * start.partSize + loaded) / file.size)));
      parts.push(part);
    }
  } catch (e) {
    req('POST', '/api/uploads/abort', { key: start.key, uploadId: start.uploadId }).catch(() => {});
    throw e;
  }
  const r = await req<AddResult>('POST', '/api/uploads/complete', {
    key: start.key, uploadId: start.uploadId, parts, filename: file.name,
    videoId: opts.videoId, folderId: opts.folderId ?? null,
    duration: meta.duration, width: meta.width, height: meta.height, fps: 30,
  });
  if (meta.poster) await req('PUT', `/api/versions/${r.version.id}/poster`, meta.poster, { 'content-type': 'image/jpeg' }).catch(() => {});
  onProgress(1);
  return r;
}

/** fetch() can't report upload progress, so parts go up with XHR. Retries a part twice. */
async function putWithProgress(url: string, blob: Blob, onLoaded: (n: number) => void): Promise<{ partNumber: number; etag: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('PUT', url);
        x.upload.onprogress = (e) => onLoaded(e.loaded);
        x.onload = () => {
          let data: any = {};
          try { data = JSON.parse(x.responseText); } catch { /* ignore */ }
          if (x.status >= 200 && x.status < 300) resolve(data);
          else reject(Object.assign(new Error(data.error || `Upload failed (${x.status})`), { status: x.status }));
        };
        x.onerror = () => reject(new Error('Upload interrupted. Check your connection.'));
        x.send(blob);
      });
    } catch (e: any) {
      if (attempt >= 2 || e.status === 401 || e.status === 400) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** Saves a version's original file (online). The Worker answers with Content-Disposition: attachment. */
export function downloadVersion(versionId: string) {
  const a = document.createElement('a');
  a.href = `/media/${versionId}?download=1`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
