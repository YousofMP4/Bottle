import type { Comment, Settings, VideoDetail, VideoSummary, Video, Version, Round, Drawing, Folder } from '../../../server/types';

async function req<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof Blob) { init.body = body; }
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as any)['content-type'] = 'application/json'; }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e: any = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data as T;
}

export interface AddResult { outcome: 'new_video' | 'new_version' | 'unchanged'; video: Video; version: Version }
export interface ConnectInfo { built: boolean; node: string; entry: string; root: string; dataDir: string; claudeCode: string; claudeDesktop: string; claudeDesktopPath: string }

export const api = {
  videos: () => req<VideoSummary[]>('GET', '/api/videos'),
  video: (id: string) => req<VideoDetail>('GET', `/api/videos/${id}`),
  platform: () => req<{ id: string; canPick: boolean }>('GET', '/api/platform'),
  pick: (videoId?: string, folderId?: string | null) => req<AddResult & { cancelled?: boolean }>('POST', '/api/videos/pick', { videoId, folderId }),
  addPath: (path: string, videoId?: string, folderId?: string | null) => req<AddResult>('POST', '/api/videos', { path, videoId, folderId }),
  folders: () => req<Folder[]>('GET', '/api/folders'),
  createFolder: (name: string, parent_id: string | null) => req<Folder>('POST', '/api/folders', { name, parent_id }),
  updateFolder: (id: string, patch: { name?: string; parent_id?: string | null; position?: number }) => req<Folder>('PATCH', `/api/folders/${id}`, patch),
  deleteFolder: (id: string) => req('DELETE', `/api/folders/${id}`),
  moveVideos: (ids: string[], folder_id: string | null, before_id?: string | null) => req('POST', '/api/videos/move', { ids, folder_id, before_id }),
  removeVideos: (ids: string[]) => req<{ removed: number }>('POST', '/api/videos/remove', { ids }),
  restoreVideos: (ids: string[]) => req<{ restored: number }>('POST', '/api/videos/restore', { ids }),
  rename: (id: string, title: string) => req<Video>('PATCH', `/api/videos/${id}`, { title }),
  removeVideo: (id: string) => req('DELETE', `/api/videos/${id}`),
  reveal: (versionId: string) => req('POST', `/api/versions/${versionId}/reveal`),
  createComment: (c: { version_id: string; timestamp: number; text: string; transcript?: string; drawing?: Drawing | null }) => req<Comment>('POST', '/api/comments', c),
  updateComment: (id: string, patch: Partial<Comment>) => req<Comment>('PATCH', `/api/comments/${id}`, patch),
  deleteComment: (id: string) => req('DELETE', `/api/comments/${id}`),
  reply: (id: string, text: string) => req<Comment>('POST', `/api/comments/${id}/replies`, { text }),
  uploadAudio: (id: string, blob: Blob, duration: number, peaks: number[]) =>
    req<Comment>('POST', `/api/comments/${id}/audio?duration=${duration.toFixed(2)}&peaks=${encodeURIComponent(JSON.stringify(peaks))}`, blob, { 'content-type': blob.type || 'audio/webm' }),
  submit: (videoId: string) => req<{ round: Round; count: number; results: { channel: string; ok: boolean; detail: string }[] }>('POST', `/api/videos/${videoId}/submit`),
  agentMessage: (videoId: string) => req<{ text: string }>('GET', `/api/videos/${videoId}/agent-message`),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),
  testWebhook: (url: string) => req<{ ok: boolean; status?: number; error?: string }>('POST', '/api/settings/test-webhook', { url }),
  connect: () => req<ConnectInfo>('GET', '/api/connect'),
};

export const mediaUrl = (versionId: string) => `/media/${versionId}`;
export const posterUrl = (versionId: string) => `/api/versions/${versionId}/poster.jpg`;
export const audioUrl = (file: string) => `/audio/${file}`;
