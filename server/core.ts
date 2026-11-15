/**
 * The domain layer. Both the HTTP server and the MCP server use this module against the same
 * SQLite file, so they never need to talk to each other.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, newId, now } from './db.js';
import { probe, frameRGBA } from './media.js';
import { burnShapes, encodePNG } from './render.js';
import type { Comment, Drawing, Round, Settings, Shape, Version, Video, VideoDetail, VideoSummary } from './types.js';

export class UserError extends Error { status = 400; }
export class NotFound extends UserError { status = 404; }

// ---------------- settings ----------------
const DEFAULT_SETTINGS: Settings = {
  name: (() => {
    const u = os.userInfo().username || 'You';
    return u.charAt(0).toUpperCase() + u.slice(1);
  })(),
  webhook_enabled: false,
  webhook_url: '',
  revisions_md: true,
  transcriber: 'browser',
  whisper_bin: '',
  whisper_model: '',
};

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: any = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) { try { s[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  return s;
}
export function setSettings(patch: Partial<Settings>): Settings {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
  });
  tx();
  return getSettings();
}

// ---------------- rows ----------------
function rowToComment(r: any): Comment {
  return {
    ...r,
    audio_peaks: r.audio_peaks ? JSON.parse(r.audio_peaks) : null,
    drawing: r.drawing ? JSON.parse(r.drawing) : null,
  };
}
function withMissing(v: Version): Version {
  return { ...v, missing: !fs.existsSync(v.path) };
}

export function getVideo(id: string): Video {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Video | undefined;
  if (!v) throw new NotFound(`No video with id ${id}. Call list_videos to see available ids.`);
  return v;
}
export function getVersion(id: string): Version {
  const v = db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as Version | undefined;
  if (!v) throw new NotFound(`No version with id ${id}`);
  return v;
}
export function versionsOf(videoId: string): Version[] {
  return (db.prepare('SELECT * FROM versions WHERE video_id = ? ORDER BY number').all(videoId) as Version[]).map(withMissing);
}
export function latestVersion(videoId: string): Version | null {
  return (db.prepare('SELECT * FROM versions WHERE video_id = ? ORDER BY number DESC LIMIT 1').get(videoId) as Version) || null;
}
export function getComment(id: string): Comment {
  const r = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!r) throw new NotFound(`No revision/comment with id ${id}`);
  return rowToComment(r);
}

export function listVideos(): VideoSummary[] {
  const vids = db.prepare('SELECT * FROM videos ORDER BY updated_at DESC').all() as Video[];
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN c.status = 'open' AND r.status = 'submitted' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN c.status = 'open' AND (r.status IS NULL OR r.status = 'open') THEN 1 ELSE 0 END) AS draft_count
    FROM comments c LEFT JOIN rounds r ON r.id = c.round_id
    WHERE c.video_id = ? AND c.parent_id IS NULL`);
  const vc = db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ?');
  return vids.map((v) => {
    const c = counts.get(v.id) as any;
    const latest = latestVersion(v.id);
    return {
      ...v,
      latest: latest ? withMissing(latest) : null,
      version_count: (vc.get(v.id) as any).n,
      open_count: c.open_count || 0,
      draft_count: c.draft_count || 0,
    };
  });
}

export function videoDetail(id: string): VideoDetail {
  const video = getVideo(id);
  return {
    video,
    versions: versionsOf(id),
    comments: (db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY timestamp, created_at').all(id) as any[]).map(rowToComment),
    rounds: db.prepare('SELECT * FROM rounds WHERE video_id = ? ORDER BY number').all(id) as Round[],
  };
}

// ---------------- adding videos ----------------
/** "promo_v2.mp4", "Promo v3", "promo-final" all normalize to "promo". */
export function baseTitle(name: string): string {
  let t = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  for (let i = 0; i < 3; i++) {
    t = t.replace(/[\s_\-.]*(?:\(\d+\)|v(?:er(?:sion)?)?\s*\d+|cut\s*\d+|rev\s*\d+|final|draft|edit(?:ed)?|copy)$/i, '');
  }
  return t.replace(/[_]+/g, ' ').trim() || name;
}
const norm = (s: string) => baseTitle(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

export interface AddResult {
  outcome: 'new_video' | 'new_version' | 'unchanged';
  video: Video;
  version: Version;
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogg|mpg|mpeg|3gp|hevc)$/i;

/**
 * Registers a file by its absolute path (never copies it).
 * - `videoId` given → becomes the next version of that video.
 * - same path already registered and file unchanged → returns the existing version.
 * - same path but file changed on disk, or title matching an existing video → next version.
 * - otherwise → a new video at v1.
 */
export async function addVideo(input: string, opts: { title?: string; videoId?: string } = {}): Promise<AddResult> {
  if (!input || typeof input !== 'string') throw new UserError('path is required');
  let p = input.trim().replace(/^file:\/\//, '');
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(decodeURI(p));
  if (!fs.existsSync(p)) throw new UserError(`File not found: ${p}`);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new UserError(`Not a file: ${p}`);
  if (!VIDEO_EXT.test(p)) throw new UserError(`Doesn't look like a video file: ${path.basename(p)}`);

  let target: Video | null = null;
  if (opts.videoId) target = getVideo(opts.videoId);

  const samePath = db.prepare('SELECT * FROM versions WHERE path = ? ORDER BY created_at DESC LIMIT 1').get(p) as Version | undefined;
  if (!target && samePath) {
    const unchanged = samePath.size === st.size && samePath.mtime === Math.round(st.mtimeMs);
    if (unchanged) {
      return { outcome: 'unchanged', video: getVideo(samePath.video_id), version: withMissing(samePath) };
    }
    target = getVideo(samePath.video_id);
  }
  const title = (opts.title || '').trim() || baseTitle(path.basename(p));
  if (!target) {
    const key = norm(title);
    const vids = db.prepare('SELECT * FROM videos ORDER BY updated_at DESC').all() as Video[];
    target = vids.find((v) => norm(v.title) === key) || null;
  }

  const info = await probe(p);
  const t = now();
  const tx = db.transaction(() => {
    let outcome: AddResult['outcome'] = 'new_version';
    if (!target) {
      target = { id: newId('vid'), title, created_at: t, updated_at: t };
      db.prepare('INSERT INTO videos(id, title, created_at, updated_at) VALUES (?,?,?,?)').run(target.id, target.title, t, t);
      outcome = 'new_video';
    } else {
      db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(t, target.id);
    }
    const n = ((db.prepare('SELECT MAX(number) AS n FROM versions WHERE video_id = ?').get(target.id) as any).n || 0) + 1;
    const version: Version = {
      id: newId('ver'), video_id: target.id, number: n, path: p, filename: path.basename(p),
      size: st.size, mtime: Math.round(st.mtimeMs), duration: info.duration, width: info.width,
      height: info.height, fps: info.fps, codec: info.codec, created_at: t,
    };
    db.prepare(`INSERT INTO versions(id, video_id, number, path, filename, size, mtime, duration, width, height, fps, codec, created_at)
      VALUES (@id, @video_id, @number, @path, @filename, @size, @mtime, @duration, @width, @height, @fps, @codec, @created_at)`).run(version);
    return { outcome, version };
  });
  const { outcome, version } = tx();
  return { outcome, video: getVideo(target!.id), version: withMissing(version) };
}

export function renameVideo(id: string, title: string): Video {
  getVideo(id);
  db.prepare('UPDATE videos SET title = ?, updated_at = ? WHERE id = ?').run(title.trim() || 'Untitled', now(), id);
  return getVideo(id);
}
/** Removes from the library only. The file on disk is never touched. */
export function removeVideo(id: string) {
  getVideo(id);
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}
export function removeVersion(id: string) {
  const v = getVersion(id);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM versions WHERE video_id = ?').get(v.video_id) as any).n;
  if (count <= 1) throw new UserError('A video needs at least one version. Remove the video instead.');
  db.prepare('DELETE FROM versions WHERE id = ?').run(id);
}

// ---------------- rounds ----------------
export function openRound(videoId: string): Round {
  const r = db.prepare("SELECT * FROM rounds WHERE video_id = ? AND status = 'open' ORDER BY number DESC LIMIT 1").get(videoId) as Round | undefined;
  if (r) return r;
  const n = ((db.prepare('SELECT MAX(number) AS n FROM rounds WHERE video_id = ?').get(videoId) as any).n || 0) + 1;
  const round: Round = { id: newId('rnd'), video_id: videoId, number: n, status: 'open', submitted_at: null, delivered_at: null, created_at: now() };
  db.prepare('INSERT INTO rounds(id, video_id, number, status, submitted_at, delivered_at, created_at) VALUES (@id,@video_id,@number,@status,@submitted_at,@delivered_at,@created_at)').run(round);
  return round;
}

/** Closes the open round. Returns it with the comments it contains. */
export function submitRound(videoId: string): { round: Round; comments: Comment[] } {
  getVideo(videoId);
  const r = db.prepare("SELECT * FROM rounds WHERE video_id = ? AND status = 'open' ORDER BY number DESC LIMIT 1").get(videoId) as Round | undefined;
  const comments = r ? (db.prepare('SELECT * FROM comments WHERE round_id = ? AND parent_id IS NULL ORDER BY timestamp').all(r.id) as any[]).map(rowToComment) : [];
  if (!r || comments.length === 0) throw new UserError('Nothing to send yet — leave a comment first.');
  const t = now();
  db.prepare("UPDATE rounds SET status = 'submitted', submitted_at = ? WHERE id = ?").run(t, r.id);
  db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(t, videoId);
  return { round: { ...r, status: 'submitted', submitted_at: t }, comments };
}

// ---------------- comments ----------------
export interface NewComment {
  video_id?: string;
  version_id: string;
  parent_id?: string | null;
  timestamp?: number;
  text?: string;
  transcript?: string;
  drawing?: Drawing | null;
  author?: string;
  author_type?: 'human' | 'agent';
}

function cleanDrawing(d: any): Drawing | null {
  if (!d || !Array.isArray(d.shapes) || d.shapes.length === 0) return null;
  const tools = new Set(['pen', 'arrow', 'rect', 'ellipse']);
  const clamp = (n: any) => Math.max(-0.5, Math.min(1.5, Number(n) || 0));
  const shapes: Shape[] = d.shapes.filter((s: any) => tools.has(s?.tool) && Array.isArray(s.points) && s.points.length).slice(0, 200).map((s: any) => ({
    tool: s.tool,
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#ff4d4d',
    width: Math.max(0.001, Math.min(0.05, Number(s.width) || 0.006)),
    points: s.points.slice(0, 4000).map((p: any) => [+clamp(p[0]).toFixed(5), +clamp(p[1]).toFixed(5)]),
  }));
  return shapes.length ? { shapes } : null;
}

export function createComment(c: NewComment): Comment {
  const version = getVersion(c.version_id);
  let parent: Comment | null = null;
  if (c.parent_id) parent = getComment(c.parent_id);
  const drawing = cleanDrawing(c.drawing);
  const text = (c.text || '').trim();
  const transcript = (c.transcript || '').trim();
  const t = now();
  const id = newId(parent ? 'rep' : 'rev');
  const round = parent ? null : openRound(version.video_id);
  db.prepare(`INSERT INTO comments(id, video_id, version_id, round_id, parent_id, timestamp, text, transcript, drawing, author, author_type, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'open', ?, ?)`).run(
    id, version.video_id, version.id, round?.id ?? null, parent?.id ?? null,
    parent ? parent.timestamp : Math.max(0, Number(c.timestamp) || 0),
    text, transcript, drawing ? JSON.stringify(drawing) : null,
    c.author || getSettings().name, c.author_type || 'human', t, t,
  );
  db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(t, version.video_id);
  return getComment(id);
}

export function updateComment(id: string, patch: Partial<Pick<Comment, 'text' | 'status' | 'transcript' | 'timestamp' | 'drawing' | 'resolved_note'>> & { audio?: string | null; audio_duration?: number; audio_peaks?: number[] | null }): Comment {
  const c = getComment(id);
  const fields: string[] = [];
  const vals: any[] = [];
  const set = (k: string, v: any) => { fields.push(`${k} = ?`); vals.push(v); };
  if (patch.text !== undefined) set('text', String(patch.text).trim());
  if (patch.transcript !== undefined) set('transcript', String(patch.transcript).trim());
  if (patch.status !== undefined) {
    if (patch.status !== 'open' && patch.status !== 'resolved') throw new UserError('status must be open or resolved');
    set('status', patch.status);
  }
  if (patch.resolved_note !== undefined) set('resolved_note', patch.resolved_note);
  if (patch.timestamp !== undefined) set('timestamp', Math.max(0, Number(patch.timestamp) || 0));
  if (patch.drawing !== undefined) { const d = cleanDrawing(patch.drawing); set('drawing', d ? JSON.stringify(d) : null); }
  if (patch.audio !== undefined) set('audio', patch.audio);
  if (patch.audio_duration !== undefined) set('audio_duration', patch.audio_duration);
  if (patch.audio_peaks !== undefined) set('audio_peaks', patch.audio_peaks ? JSON.stringify(patch.audio_peaks.slice(0, 128)) : null);
  if (!fields.length) return c;
  set('updated_at', now());
  db.prepare(`UPDATE comments SET ${fields.join(', ')} WHERE id = ?`).run(...vals, id);
  return getComment(id);
}

export function deleteComment(id: string): Comment {
  const c = getComment(id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  return c;
}

export function replyToRevision(id: string, text: string, author = 'Agent', authorType: 'human' | 'agent' = 'agent'): Comment {
  const parent = getComment(id);
  const root = parent.parent_id ? getComment(parent.parent_id) : parent;
  if (!text?.trim()) throw new UserError('text is required');
  return createComment({ version_id: root.version_id, parent_id: root.id, text, author, author_type: authorType });
}

export function resolveRevision(id: string, note?: string, author = 'Agent', authorType: 'human' | 'agent' = 'agent'): Comment {
  const c = getComment(id);
  const root = c.parent_id ? getComment(c.parent_id) : c;
  if (note?.trim()) replyToRevision(root.id, note, author, authorType);
  return updateComment(root.id, { status: 'resolved', resolved_note: note?.trim() || '' });
}

// ---------------- agent-facing views ----------------
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};
export const timecode = fmt;

/** Plain-language summary of a drawing so text-only agents still know what was marked. */
export function describeDrawing(d: Drawing | null): string | null {
  if (!d?.shapes.length) return null;
  const pct = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
  const names: Record<string, string> = { pen: 'freehand mark', arrow: 'arrow', rect: 'box', ellipse: 'circle' };
  return d.shapes.map((s) => {
    const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
    if (s.tool === 'arrow') {
      const [, h] = [s.points[0], s.points[s.points.length - 1]];
      return `${names.arrow} pointing at (${pct(h[0])}% from left, ${pct(h[1])}% from top)`;
    }
    return `${names[s.tool]} around x ${pct(Math.min(...xs))}–${pct(Math.max(...xs))}%, y ${pct(Math.min(...ys))}–${pct(Math.max(...ys))}%`;
  }).join('; ');
}

export interface RevisionJSON {
  id: string;
  video_id: string;
  version: number;
  version_id: string;
  file: string;
  timestamp: number;
  timecode: string;
  frame: number;
  text: string;
  transcript: string;
  has_voice_note: boolean;
  drawing: string | null;
  author: string;
  status: 'open' | 'resolved';
  round: number | null;
  sent_to_agent: boolean;
  created_at: string;
  replies: { id: string; author: string; author_type: string; text: string; created_at: string }[];
}

export function revisionJSON(c: Comment, cache = new Map<string, any>()): RevisionJSON {
  const key = (k: string, f: () => any) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));
  const v: Version = key('v' + c.version_id, () => getVersion(c.version_id));
  const r: Round | null = c.round_id ? key('r' + c.round_id, () => db.prepare('SELECT * FROM rounds WHERE id = ?').get(c.round_id)) : null;
  const replies = db.prepare('SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at').all(c.id) as any[];
  return {
    id: c.id,
    video_id: c.video_id,
    version: v.number,
    version_id: v.id,
    file: v.path,
    timestamp: +c.timestamp.toFixed(3),
    timecode: fmt(c.timestamp),
    frame: Math.round(c.timestamp * v.fps),
    text: c.text,
    transcript: c.transcript,
    has_voice_note: !!c.audio,
    drawing: describeDrawing(c.drawing),
    author: c.author,
    status: c.status,
    round: r?.number ?? null,
    sent_to_agent: r?.status === 'submitted',
    created_at: new Date(c.created_at).toISOString(),
    replies: replies.map((x) => ({ id: x.id, author: x.author, author_type: x.author_type, text: x.text, created_at: new Date(x.created_at).toISOString() })),
  };
}

export function getRevisions(videoId: string, opts: { status?: 'open' | 'resolved' | 'all'; version?: number; includeDrafts?: boolean; roundId?: string } = {}) {
  const video = getVideo(videoId);
  const status = opts.status || 'open';
  const rows = (db.prepare(`SELECT c.* FROM comments c LEFT JOIN rounds r ON r.id = c.round_id
    WHERE c.video_id = ? AND c.parent_id IS NULL ORDER BY c.timestamp, c.created_at`).all(videoId) as any[]).map(rowToComment);
  const rounds = new Map((db.prepare('SELECT * FROM rounds WHERE video_id = ?').all(videoId) as Round[]).map((r) => [r.id, r]));
  const versions = versionsOf(videoId);
  const verById = new Map(versions.map((v) => [v.id, v]));
  let drafts = 0;
  const cache = new Map();
  const out = rows.filter((c) => {
    const submitted = c.round_id ? rounds.get(c.round_id)?.status === 'submitted' : false;
    if (!submitted && c.status === 'open') drafts++;
    if (!submitted && !opts.includeDrafts) return false;
    if (opts.roundId && c.round_id !== opts.roundId) return false;
    if (status !== 'all' && c.status !== status) return false;
    if (opts.version && verById.get(c.version_id)?.number !== opts.version) return false;
    return true;
  }).map((c) => revisionJSON(c, cache));
  const latest = versions[versions.length - 1];
  return {
    video: { id: video.id, title: video.title, latest_version: latest?.number ?? null, latest_file: latest?.path ?? null },
    revisions: out,
    unsent_drafts: opts.includeDrafts ? 0 : drafts,
    note: drafts && !opts.includeDrafts
      ? `${drafts} more comment(s) are still being written by the reviewer and haven't been sent yet.`
      : undefined,
  };
}

/** Markdown used for revisions.md and the "Copy message for my agent" button. */
export function agentMessage(videoId: string, opts: { roundId?: string; includeDrafts?: boolean } = {}): string {
  const { video, revisions } = getRevisions(videoId, { status: 'open', includeDrafts: opts.includeDrafts ?? true, roundId: opts.roundId });
  const lines: string[] = [];
  lines.push(`# Revisions for "${video.title}"`);
  lines.push('');
  lines.push(`Video: \`${video.latest_file}\` (latest is v${video.latest_version}, video_id \`${video.id}\`)`);
  lines.push(`Reviewed in Bottle. ${revisions.length} open revision${revisions.length === 1 ? '' : 's'}:`);
  lines.push('');
  revisions.forEach((r, i) => {
    lines.push(`${i + 1}. **[${r.timecode}]** (v${r.version}, frame ${r.frame}) — id \`${r.id}\``);
    if (r.text) lines.push(`   - Note: ${r.text.replace(/\n/g, '\n     ')}`);
    if (r.transcript) lines.push(`   - Voice note (transcript): "${r.transcript}"`);
    else if (r.has_voice_note) lines.push('   - Voice note recorded (no transcript available).');
    if (r.drawing) lines.push(`   - Drawn on frame: ${r.drawing}`);
    for (const rep of r.replies) lines.push(`   - Reply from ${rep.author}: ${rep.text}`);
  });
  lines.push('');
  lines.push('How to work on these:');
  lines.push(`- If you have the Bottle MCP tools: \`get_revisions("${video.id}")\`, then \`get_frame("${video.id}", <timestamp>)\` to see each frame with the drawing burned in.`);
  lines.push('- Fix the video, render a new file, then `add_video(<new path>)` — it becomes the next version automatically.');
  lines.push('- Reply with `reply_to_revision(id, text)` and close items with `resolve_revision(id, note)`.');
  return lines.join('\n');
}

// ---------------- frames ----------------
/** A frame as PNG with the drawings near that timestamp burned in. */
export async function frameWithDrawings(opts: { videoId?: string; versionId?: string; timestamp?: number; revisionId?: string; maxWidth?: number }) {
  let version: Version;
  let t = opts.timestamp ?? 0;
  let shapes: Shape[] = [];
  let used: Comment[] = [];
  if (opts.revisionId) {
    let c = getComment(opts.revisionId);
    if (c.parent_id) c = getComment(c.parent_id);
    version = getVersion(c.version_id);
    t = opts.timestamp ?? c.timestamp;
    if (c.drawing) { shapes = c.drawing.shapes; used = [c]; }
  } else {
    version = opts.versionId ? getVersion(opts.versionId) : (latestVersion(opts.videoId!) ?? (() => { throw new NotFound('Video has no versions'); })());
    if (opts.videoId) getVideo(opts.videoId);
    const tol = Math.max(0.5 / version.fps, 0.04) + 0.02;
    used = (db.prepare('SELECT * FROM comments WHERE version_id = ? AND parent_id IS NULL AND drawing IS NOT NULL AND ABS(timestamp - ?) <= ?')
      .all(version.id, t, tol) as any[]).map(rowToComment);
    shapes = used.flatMap((c) => c.drawing?.shapes ?? []);
  }
  if (!fs.existsSync(version.path)) throw new UserError(`The file for v${version.number} is missing: ${version.path}`);
  if (version.duration) t = Math.min(Math.max(0, t), Math.max(0, version.duration - 0.001));
  const frame = await frameRGBA(version.path, t, { width: version.width, height: version.height }, opts.maxWidth ?? 1280);
  if (shapes.length) burnShapes(frame, shapes);
  return { png: encodePNG(frame), version, timestamp: t, width: frame.width, height: frame.height, drawingsFrom: used.map((c) => c.id) };
}
