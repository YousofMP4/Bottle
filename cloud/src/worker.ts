/**
 * Portal in the cloud: one Worker serves the web app (static assets) and this API.
 * Data lives in D1, video files in R2. The API mirrors the local server (server/index.ts) so the
 * same React app runs in both places; anything that needs the local disk is left out here.
 */

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** One-time code that unlocks creating the owner account (secret). */
  SETUP_CODE?: string;
  /** Only this email may create the owner account (secret). */
  OWNER_EMAIL?: string;
}

type Row = Record<string, any>;
type User = { id: string; email: string; name: string; role: 'owner' | 'editor' | 'client'; via?: 'session' | 'key' };

const STATUSES = ['ready', 'working', 'revising', 'done'] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = { ready: 'Ready to start', working: 'Working', revising: 'Revising', done: 'Done' };
const DONE_PRUNE_DAYS = 7;
const PART_SIZE = 50 * 1024 * 1024; // R2 multipart: every part but the last must be the same size
const SESSION_DAYS = 30;

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const bad = (m: string) => new HttpError(400, m);
const notFound = (m: string) => new HttpError(404, m);

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const now = () => Date.now();
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newId(prefix: string) {
  const b = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return `${prefix}_${s}`;
}
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- schema
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, position REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ready', status_at INTEGER, links TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', cleaned_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT NOT NULL, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, position REAL NOT NULL DEFAULT 0, removed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, number INTEGER NOT NULL, key TEXT NOT NULL, poster_key TEXT, filename TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, duration REAL NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, fps REAL NOT NULL DEFAULT 30, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', submitted_at INTEGER, delivered_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE, round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL, parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE, timestamp REAL NOT NULL DEFAULT 0, general INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL DEFAULT '', transcript TEXT NOT NULL DEFAULT '', audio TEXT, audio_duration REAL NOT NULL DEFAULT 0, audio_peaks TEXT, drawing TEXT, author TEXT NOT NULL, author_type TEXT NOT NULL DEFAULT 'human', status TEXT NOT NULL DEFAULT 'open', resolved_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS comments_video ON comments(video_id, version_id, timestamp)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL, video_id TEXT, folder_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS activity_time ON activity(created_at)`,
  `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT)`,
  `INSERT OR IGNORE INTO meta(key, value) VALUES ('rev', '0')`,
];
/** Columns added after the first release (ALTER fails harmlessly once a column exists). */
const ADDED_COLUMNS = [
  `ALTER TABLE activity ADD COLUMN user_id TEXT`,
  `ALTER TABLE activity ADD COLUMN actor_name TEXT`,
  `ALTER TABLE folders ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL`,
  `ALTER TABLE comments ADD COLUMN user_id TEXT`,
  `ALTER TABLE videos ADD COLUMN revising_at INTEGER`,
  `ALTER TABLE videos ADD COLUMN revising_note TEXT`,
];
let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env) {
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)))
    .then(async () => { for (const a of ADDED_COLUMNS) await env.DB.prepare(a).run().catch(() => {}); })
    .catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------------------------------------------------------------- db helpers
class Db {
  constructor(private d: D1Database) {}
  all<T = Row>(sql: string, ...args: any[]) { return this.d.prepare(sql).bind(...args).all<T>().then((r) => r.results ?? []); }
  first<T = Row>(sql: string, ...args: any[]) { return this.d.prepare(sql).bind(...args).first<T>(); }
  run(sql: string, ...args: any[]) { return this.d.prepare(sql).bind(...args).run(); }
  stmt(sql: string, ...args: any[]) { return this.d.prepare(sql).bind(...args); }
  batch(stmts: D1PreparedStatement[]) { return stmts.length ? this.d.batch(stmts) : Promise.resolve([]); }
  /** Bumped on every write; /api/events watches it so open tabs refresh. */
  touch() { return this.run("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'"); }
}

// ---------------------------------------------------------------- auth
async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 256);
  return hex(bits);
}
async function sha256(s: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function cookie(req: Request, name: string) {
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const SESSION_COOKIE = 'portal_session';
async function startSession(db: Db, userId: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const t = now();
  await db.run('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES (?,?,?,?)', await sha256(token), userId, t, t + SESSION_DAYS * 86_400_000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
async function currentUserById(db: Db, id: string): Promise<User | null> {
  const u = await db.first<User>('SELECT id, email, name, role FROM users WHERE id = ?', id);
  return u ? { ...u, via: 'session' } : null;
}
async function currentUser(db: Db, req: Request): Promise<User | null> {
  // Access keys (Authorization: Bearer pk_…) let Claude's tools on the Mac upload and update projects.
  const bearer = /^Bearer\s+(pk_[A-Za-z0-9]+)$/.exec(req.headers.get('authorization') || '')?.[1];
  if (bearer) {
    const h = await sha256(bearer);
    const u = await db.first<User>('SELECT u.id, u.email, u.name, u.role FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?', h);
    if (!u) return null;
    await db.run('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?', now(), h);
    return { ...u, via: 'key' };
  }
  const token = cookie(req, SESSION_COOKIE);
  if (!token) return null;
  const u = await db.first<User>(`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`, await sha256(token), now());
  return u ? { ...u, via: 'session' } : null;
}

// ---------------------------------------------------------------- rows
function toFolder(r: Row): Row {
  let links = [];
  try { links = JSON.parse(r.links || '[]'); } catch { /* keep empty */ }
  return { ...r, links, notes: r.notes ?? '', status: r.status || 'ready', status_at: r.status_at ?? null, cleaned_at: r.cleaned_at ?? null };
}
function toVersion(r: Row) {
  return { id: r.id, video_id: r.video_id, number: r.number, path: r.filename, filename: r.filename, size: r.size, mtime: r.created_at, duration: r.duration, width: r.width, height: r.height, fps: r.fps, codec: r.mime, created_at: r.created_at, missing: false, poster: !!r.poster_key };
}
function toComment(r: Row): Row {
  return { ...r, general: !!r.general, audio_peaks: r.audio_peaks ? JSON.parse(r.audio_peaks) : null, drawing: r.drawing ? JSON.parse(r.drawing) : null };
}
function cleanDrawing(d: any) {
  if (!d || !Array.isArray(d.shapes) || d.shapes.length === 0) return null;
  const tools = new Set(['pen', 'arrow', 'rect', 'ellipse']);
  const clamp = (n: any) => Math.max(-0.5, Math.min(1.5, Number(n) || 0));
  const shapes = d.shapes.filter((s: any) => tools.has(s?.tool) && Array.isArray(s.points) && s.points.length).slice(0, 200).map((s: any) => ({
    tool: s.tool,
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#ff4d4d',
    width: Math.max(0.001, Math.min(0.05, Number(s.width) || 0.006)),
    points: s.points.slice(0, 4000).map((p: any) => [+clamp(p[0]).toFixed(5), +clamp(p[1]).toFixed(5)]),
  }));
  return shapes.length ? { shapes } : null;
}
function baseTitle(name: string) {
  let t = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  for (let i = 0; i < 3; i++) t = t.replace(/[\s_\-.]*(?:\(\d+\)|v(?:er(?:sion)?)?\s*\d+|cut\s*\d+|rev\s*\d+|final|draft|edit(?:ed)?|copy)$/i, '');
  return t.replace(/[_]+/g, ' ').trim() || name;
}
const norm = (s: string) => baseTitle(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const fmt = (s: number) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
};

// ---------------------------------------------------------------- the app
class Portal {
  db: Db;
  /** Clients only reach folders in this set (their projects and the folders inside them); null = everything. */
  scope: Set<string> | null = null;
  /** Workspaces a client belongs to; null = all. */
  workspaceScope: Set<string> | null = null;
  constructor(public env: Env, public user: User | null, public ctx?: ExecutionContext) { this.db = new Db(env.DB); }
  get isClient() { return this.user?.role === 'client'; }

  async loadScope() {
    if (!this.isClient) return this;
    const ws = await this.db.all<{ workspace_id: string }>('SELECT workspace_id FROM workspace_members WHERE user_id = ?', this.user!.id);
    this.workspaceScope = new Set(ws.map((w) => w.workspace_id));
    const marks = [...this.workspaceScope].map(() => '?').join(',') || "''";
    const rows = await this.db.all<{ id: string }>(`SELECT id FROM folders WHERE workspace_id IN (${marks})
      OR parent_id IN (SELECT id FROM folders WHERE workspace_id IN (${marks}))`, ...this.workspaceScope, ...this.workspaceScope);
    this.scope = new Set(rows.map((r) => r.id));
    return this;
  }
  canSee(folderId: string | null | undefined) { return !this.scope || (!!folderId && this.scope.has(folderId)); }
  /** Owner/editor only (clients get a 403). */
  staff() { if (this.isClient) throw new HttpError(403, 'Only Gleam Films can do that.'); }

  async log(kind: string, text: string, refs: { video_id?: string | null; folder_id?: string | null } = {}, actor?: string) {
    const a = actor ?? (this.user?.via === 'key' ? 'agent' : this.isClient ? 'client' : 'you');
    await this.db.run('INSERT INTO activity(id, kind, actor, text, video_id, folder_id, created_at, user_id, actor_name) VALUES (?,?,?,?,?,?,?,?,?)',
      newId('act'), kind, a, text, refs.video_id ?? null, refs.folder_id ?? null, now(), a === 'portal' ? null : this.user?.id ?? null, a === 'portal' ? 'Portal' : this.user?.name ?? null);
  }

  // settings
  async settings() {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const s: any = { name: this.user?.name || 'You', webhook_enabled: false, webhook_url: '', revisions_md: false, transcriber: 'browser', whisper_bin: '', whisper_model: '', click_sound: false };
    for (const r of rows) if (r.key in s && r.key !== 'name') { try { s[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
    return s;
  }
  async saveSettings(patch: Row) {
    const keys = this.isClient ? [] : ['click_sound', 'transcriber'];
    const stmts = Object.entries(patch || {}).filter(([k]) => keys.includes(k)).map(([k, v]) =>
      this.db.stmt('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v)));
    if (typeof patch?.name === 'string' && patch.name.trim() && this.user) stmts.push(this.db.stmt('UPDATE users SET name = ? WHERE id = ?', patch.name.trim(), this.user.id));
    await this.db.batch(stmts);
    if (this.user && patch?.name) this.user.name = patch.name.trim();
    return this.settings();
  }

  // folders / projects
  async folders() { return (await this.db.all('SELECT * FROM folders ORDER BY position, created_at')).map(toFolder).filter((f) => this.canSee(f.id)); }
  async folder(id: string) {
    const r = await this.db.first('SELECT * FROM folders WHERE id = ?', id);
    if (!r || !this.canSee(r.id)) throw notFound(`No folder with id ${id}`);
    return toFolder(r);
  }
  /** A project by id or name (case-insensitive); optionally created in Ready to start. */
  async projectId(idOrName: string, create = false, workspace?: string | null): Promise<string> {
    const byId = await this.db.first<{ id: string }>('SELECT id FROM folders WHERE id = ?', idOrName);
    if (byId) return byId.id;
    const byName = await this.db.first<{ id: string }>('SELECT id FROM folders WHERE lower(name) = lower(?) ORDER BY parent_id IS NOT NULL, created_at LIMIT 1', idOrName.trim());
    if (byName) return byName.id;
    if (!create) throw notFound(`No project named “${idOrName}”`);
    return (await this.createFolder(idOrName, null, 'ready', workspace ? await this.workspaceId(workspace, true) : null)).id;
  }
  async projectOf(folderId: string | null | undefined) {
    if (!folderId) return null;
    try { const f = await this.folder(folderId); return f.parent_id ? await this.folder(f.parent_id) : f; } catch { return null; }
  }
  async checkParent(parentId: string | null, selfId?: string) {
    if (!parentId) return;
    const p = await this.folder(parentId);
    if (p.parent_id) throw bad('Folders nest one level deep. Pick a top-level folder.');
    if (selfId) {
      if (parentId === selfId) throw bad('A folder can’t go inside itself.');
      const kids = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM folders WHERE parent_id = ?', selfId);
      if (kids?.n) throw bad('This folder has folders inside it, so it can only live at the top level.');
    }
  }
  async createFolder(name: string, parentId: string | null, status: Status = 'ready', workspaceId: string | null = null) {
    const n = (name || '').trim() || 'New folder';
    await this.checkParent(parentId);
    if (!STATUSES.includes(status)) throw bad('Unknown status');
    const max = await this.db.first<{ p: number | null }>('SELECT MAX(position) AS p FROM folders WHERE parent_id IS ?', parentId);
    const id = newId('fld');
    const t = now();
    const ws = parentId ? null : workspaceId ? (await this.workspace(workspaceId)).id : null;
    await this.db.run("INSERT INTO folders(id, name, parent_id, position, created_at, status, status_at, links, notes, workspace_id) VALUES (?,?,?,?,?,?,?,'[]','',?)", id, n, parentId, (max?.p ?? 0) + 1, t, status, t, ws);
    if (!parentId) await this.log('project_created', `New project “${n}” in ${STATUS_LABEL[status]}`, { folder_id: id });
    return this.folder(id);
  }
  async updateFolder(id: string, patch: Row) {
    const f = await this.folder(id);
    if (patch.parent_id !== undefined) await this.checkParent(patch.parent_id, id);
    if (patch.status !== undefined && !STATUSES.includes(patch.status)) throw bad('Unknown status');
    const name = patch.name !== undefined ? (String(patch.name).trim() || f.name) : f.name;
    const status: Status = patch.status ?? f.status;
    const links = patch.links !== undefined ? cleanLinks(patch.links) : f.links;
    const notes = patch.notes !== undefined ? String(patch.notes) : f.notes;
    const parent = patch.parent_id !== undefined ? patch.parent_id : f.parent_id;
    const moved = status !== f.status;
    const workspaceId = parent ? null : patch.workspace_id !== undefined ? (patch.workspace_id ? (await this.workspace(patch.workspace_id)).id : null) : f.workspace_id ?? null;
    const cleanedAt = patch.cleaned === true ? now() : patch.cleaned === false || moved ? null : f.cleaned_at;
    await this.db.run('UPDATE folders SET name = ?, parent_id = ?, position = ?, status = ?, status_at = ?, links = ?, notes = ?, cleaned_at = ?, workspace_id = ? WHERE id = ?',
      name, parent, patch.position ?? f.position, status, moved ? now() : f.status_at, JSON.stringify(links), notes, cleanedAt, workspaceId, id);
    if (!parent) {
      if (moved) await this.log('project_moved', `“${name}” moved to ${STATUS_LABEL[status]}`, { folder_id: id });
      if (name !== f.name) await this.log('project_renamed', `“${f.name}” renamed to “${name}”`, { folder_id: id });
      const added = links.filter((l: any) => !f.links.some((o: any) => o.url === l.url));
      const removed = f.links.filter((l: any) => !links.some((o: any) => o.url === l.url));
      if (added.length) await this.log('project_updated', `Link added to “${name}”: ${added.map((l: any) => l.label).join(', ')}`, { folder_id: id });
      if (removed.length) await this.log('project_updated', `Link removed from “${name}”: ${removed.map((l: any) => l.label).join(', ')}`, { folder_id: id });
      if (notes !== f.notes) await this.log('project_updated', `Notes updated on “${name}”`, { folder_id: id });
    }
    return this.folder(id);
  }
  async deleteFolder(id: string) {
    const f = await this.folder(id);
    await this.db.batch([
      this.db.stmt('UPDATE videos SET folder_id = ? WHERE folder_id = ?', f.parent_id, id),
      this.db.stmt('UPDATE folders SET parent_id = ? WHERE parent_id = ?', f.parent_id, id),
      this.db.stmt('DELETE FROM folders WHERE id = ?', id),
    ]);
    if (!f.parent_id) await this.log('project_deleted', `Project “${f.name}” deleted (its videos moved to the Library)`);
  }

  // videos
  async video(id: string) {
    const v = await this.db.first('SELECT id, title, folder_id, position, created_at, updated_at, revising_at, revising_note FROM videos WHERE id = ? AND removed_at IS NULL', id);
    if (!v || !this.canSee(v.folder_id)) throw notFound(`No video with id ${id}`);
    return v;
  }
  async listVideos() {
    const [vids, versions, counts] = await Promise.all([
      this.db.all('SELECT id, title, folder_id, position, created_at, updated_at, revising_at, revising_note FROM videos WHERE removed_at IS NULL ORDER BY updated_at DESC'),
      this.db.all('SELECT * FROM versions ORDER BY number'),
      this.db.all(`SELECT c.video_id,
          SUM(CASE WHEN c.status = 'open' AND r.status = 'submitted' THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN c.status = 'open' AND (r.status IS NULL OR r.status = 'open') THEN 1 ELSE 0 END) AS draft_count
        FROM comments c LEFT JOIN rounds r ON r.id = c.round_id WHERE c.parent_id IS NULL GROUP BY c.video_id`),
    ]);
    const byVideo = new Map<string, Row[]>();
    for (const v of versions) { const a = byVideo.get(v.video_id) ?? []; a.push(v); byVideo.set(v.video_id, a); }
    const cnt = new Map(counts.map((c) => [c.video_id, c]));
    return vids.filter((v) => this.canSee(v.folder_id)).map((v) => {
      const vs = byVideo.get(v.id) ?? [];
      const c = cnt.get(v.id);
      return { ...v, latest: vs.length ? toVersion(vs[vs.length - 1]) : null, version_count: vs.length, open_count: c?.open_count || 0, draft_count: c?.draft_count || 0 } as Row;
    });
  }
  async videoDetail(id: string) {
    const video = await this.video(id);
    const [versions, comments, rounds] = await Promise.all([
      this.db.all('SELECT * FROM versions WHERE video_id = ? ORDER BY number', id),
      this.db.all('SELECT * FROM comments WHERE video_id = ? ORDER BY general DESC, timestamp, created_at', id),
      this.db.all('SELECT * FROM rounds WHERE video_id = ? ORDER BY number', id),
    ]);
    return { video, versions: versions.map(toVersion), comments: comments.map(toComment), rounds };
  }
  async version(id: string) {
    const v = await this.db.first('SELECT * FROM versions WHERE id = ?', id);
    if (!v) throw notFound(`No version with id ${id}`);
    if (this.scope) await this.video(v.video_id);
    return v;
  }
  /**
   * "Being revised": while set, clients can't watch or download any version of the video (they see
   * "New version coming soon"). Uploading the next version clears it.
   */
  async setRevising(ids: string[], on: boolean, note?: string) {
    this.staff();
    const t = now();
    const out: Row[] = [];
    for (const id of ids) {
      const v = await this.video(id);
      const n = on ? String(note ?? '').trim().slice(0, 200) || null : null;
      await this.db.run('UPDATE videos SET revising_at = ?, revising_note = ? WHERE id = ?', on ? t : null, n, id);
      const proj = await this.projectOf(v.folder_id);
      if (on && !v.revising_at) await this.log('video_revising', `A new version of “${v.title}” is being made${n ? `: ${n}` : ''}`, { video_id: v.id, folder_id: proj?.id });
      out.push(await this.video(id));
    }
    return out;
  }
  async renameVideo(id: string, title: string) {
    await this.video(id);
    const t = (title || '').trim();
    if (!t) throw bad('Title can’t be empty');
    await this.db.run('UPDATE videos SET title = ?, updated_at = ? WHERE id = ?', t, now(), id);
    return this.video(id);
  }
  async moveVideos(ids: string[], folderId: string | null, beforeId?: string | null) {
    if (folderId) await this.folder(folderId);
    const siblings = (await this.db.all<{ id: string }>('SELECT id FROM videos WHERE removed_at IS NULL AND folder_id IS ? ORDER BY position, updated_at DESC', folderId)).filter((v) => !ids.includes(v.id));
    let at = beforeId ? siblings.findIndex((v) => v.id === beforeId) : -1;
    if (at < 0) at = siblings.length;
    const order = [...siblings.slice(0, at).map((v) => v.id), ...ids, ...siblings.slice(at).map((v) => v.id)];
    await this.db.batch(order.map((id, i) => this.db.stmt('UPDATE videos SET folder_id = ?, position = ? WHERE id = ?', folderId, i, id)));
  }
  async removeVideos(ids: string[]) {
    const t = now();
    await this.db.batch(ids.map((id) => this.db.stmt('UPDATE videos SET removed_at = ? WHERE id = ? AND removed_at IS NULL', t, id)));
    return { removed: ids.length };
  }
  async restoreVideos(ids: string[]) {
    await this.db.batch(ids.map((id) => this.db.stmt('UPDATE videos SET removed_at = NULL WHERE id = ?', id)));
    return { restored: ids.length };
  }
  /** Removed videos stay restorable for a short while (the Undo toast), then go, files and all. */
  async purgeRemoved(olderThanMs: number) {
    const gone = await this.db.all<{ id: string }>('SELECT id FROM videos WHERE removed_at IS NOT NULL AND removed_at < ?', now() - olderThanMs);
    if (!gone.length) return 0;
    const ids = gone.map((g) => g.id);
    const marks = ids.map(() => '?').join(',');
    const files = await this.db.all<{ key: string; poster_key: string | null }>(`SELECT key, poster_key FROM versions WHERE video_id IN (${marks})`, ...ids);
    const audio = await this.db.all<{ audio: string }>(`SELECT audio FROM comments WHERE video_id IN (${marks}) AND audio IS NOT NULL`, ...ids);
    await this.deleteObjects([...files.flatMap((f) => [f.key, f.poster_key]), ...audio.map((a) => `audio/${a.audio}`)]);
    await this.db.run(`DELETE FROM videos WHERE id IN (${marks})`, ...ids);
    return ids.length;
  }
  async deleteObjects(keys: (string | null | undefined)[]) {
    const k = keys.filter(Boolean) as string[];
    for (let i = 0; i < k.length; i += 1000) await this.env.MEDIA.delete(k.slice(i, i + 1000));
  }
  async removeVersion(id: string) {
    const v = await this.version(id);
    const n = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM versions WHERE video_id = ?', v.video_id);
    if ((n?.n ?? 0) <= 1) throw bad('A video needs at least one version. Remove the video instead.');
    await this.db.run('DELETE FROM versions WHERE id = ?', id);
    await this.deleteObjects([v.key, v.poster_key]);
    return v;
  }

  // uploads (R2 multipart, so files of any size get past the 100 MB request limit)
  async uploadStart(b: Row) {
    const filename = String(b.filename || '').slice(0, 300);
    if (!filename) throw bad('filename is required');
    const size = Number(b.size) || 0;
    if (size <= 0) throw bad('That file is empty');
    const key = `videos/${newId('up')}/${filename.replace(/[^\w.\-() ]+/g, '_')}`;
    const mp = await this.env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: b.type || 'video/mp4' } });
    return { key, uploadId: mp.uploadId, partSize: PART_SIZE };
  }
  async uploadPart(key: string, uploadId: string, part: number, body: ReadableStream | null) {
    if (!key.startsWith('videos/') || !body) throw bad('Bad upload');
    const mp = this.env.MEDIA.resumeMultipartUpload(key, uploadId);
    const p = await mp.uploadPart(part, body);
    return { partNumber: p.partNumber, etag: p.etag };
  }
  async uploadAbort(key: string, uploadId: string) {
    if (!key.startsWith('videos/')) throw bad('Bad upload');
    await this.env.MEDIA.resumeMultipartUpload(key, uploadId).abort().catch(() => {});
  }
  async uploadComplete(b: Row) {
    const key = String(b.key || '');
    if (!key.startsWith('videos/')) throw bad('Bad upload');
    const mp = this.env.MEDIA.resumeMultipartUpload(key, String(b.uploadId));
    const obj = await mp.complete((b.parts || []).map((p: any) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
    const filename = String(b.filename || key.split('/').pop());
    const title = String(b.title || '').trim() || baseTitle(filename);
    let target: Row | null = b.videoId ? await this.video(b.videoId) : null;
    // Where it's going decides which videos a matching name can become the next version of.
    let folderId: string | null = b.folderId ? (await this.folder(b.folderId)).id : b.project && !this.isClient ? await this.projectId(String(b.project), true, b.workspace ? String(b.workspace) : null) : null;
    if (this.isClient && !folderId && !target) {
      // A client uploading from the Library lands in their first project.
      const projects = (await this.folders()).filter((f) => !f.parent_id);
      folderId = projects[0]?.id ?? null;
      if (!folderId) throw new HttpError(403, 'You don’t have a project to upload into yet.');
    }
    if (!target) {
      // Same title or file-name stem as a video in the same project → its next version ("teaser_v1" ↔ "teaser_v2").
      const proj = folderId ? await this.projectOf(folderId) : null;
      const tree = proj ? new Set([proj.id, ...(await this.folders()).filter((f) => f.parent_id === proj.id).map((f) => f.id)]) : null;
      const eligible = (fid: string | null) => this.canSee(fid) && (tree ? !!fid && tree.has(fid) : !fid);
      const keys = new Set([norm(title), norm(filename)]);
      const vids = (await this.db.all('SELECT * FROM videos WHERE removed_at IS NULL ORDER BY updated_at DESC')).filter((v) => eligible(v.folder_id));
      target = vids.find((v) => keys.has(norm(v.title))) ?? null;
      if (!target) {
        const ok = new Set(vids.map((v) => v.id));
        const hit = (await this.db.all<{ video_id: string; filename: string }>(`SELECT ve.video_id, ve.filename FROM versions ve JOIN videos vi ON vi.id = ve.video_id WHERE vi.removed_at IS NULL ORDER BY ve.created_at DESC`)).find((r) => ok.has(r.video_id) && keys.has(norm(r.filename)));
        if (hit) target = await this.video(hit.video_id);
      }
    }
    const t = now();
    let outcome: 'new_video' | 'new_version' = 'new_version';
    if (!target) {
      const min = await this.db.first<{ p: number | null }>('SELECT MIN(position) AS p FROM videos WHERE removed_at IS NULL AND folder_id IS ?', folderId);
      target = { id: newId('vid'), title };
      await this.db.run('INSERT INTO videos(id, title, folder_id, position, created_at, updated_at) VALUES (?,?,?,?,?,?)', target.id, title, folderId, (min?.p ?? 1) - 1, t, t);
      outcome = 'new_video';
    } else {
      await this.db.run('UPDATE videos SET updated_at = ?, revising_at = NULL, revising_note = NULL WHERE id = ?', t, target.id);
      if (folderId) await this.db.run('UPDATE videos SET folder_id = ? WHERE id = ?', folderId, target.id);
    }
    const n = ((await this.db.first<{ n: number | null }>('SELECT MAX(number) AS n FROM versions WHERE video_id = ?', target.id))?.n || 0) + 1;
    const id = newId('ver');
    await this.db.run('INSERT INTO versions(id, video_id, number, key, filename, size, mime, duration, width, height, fps, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, target.id, n, key, filename, obj.size, obj.httpMetadata?.contentType || 'video/mp4', Number(b.duration) || 0, Number(b.width) || 0, Number(b.height) || 0, Number(b.fps) || 30, t);
    const video = await this.video(target.id);
    const proj = await this.projectOf(video.folder_id);
    const where = proj ? ` in “${proj.name}”` : '';
    if (outcome === 'new_video') await this.log('video_added', `“${video.title}” uploaded${where}`, { video_id: video.id, folder_id: proj?.id });
    else await this.log('version_added', target.revising_at ? `v${n} of “${video.title}” is ready to review${where}` : `v${n} of “${video.title}” added${where}`, { video_id: video.id, folder_id: proj?.id });
    return { outcome, video, version: toVersion(await this.version(id)) };
  }
  async putPoster(versionId: string, body: ReadableStream | null) {
    const v = await this.version(versionId);
    if (!body) throw bad('Empty poster');
    const key = `posters/${v.id}.jpg`;
    await this.env.MEDIA.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
    await this.db.run('UPDATE versions SET poster_key = ? WHERE id = ?', key, v.id);
    return { ok: true };
  }

  // rounds + comments
  async openRound(videoId: string) {
    const r = await this.db.first("SELECT * FROM rounds WHERE video_id = ? AND status = 'open' ORDER BY number DESC LIMIT 1", videoId);
    if (r) return r;
    const n = ((await this.db.first<{ n: number | null }>('SELECT MAX(number) AS n FROM rounds WHERE video_id = ?', videoId))?.n || 0) + 1;
    const round = { id: newId('rnd'), video_id: videoId, number: n, status: 'open', submitted_at: null, delivered_at: null, created_at: now() };
    await this.db.run('INSERT INTO rounds(id, video_id, number, status, submitted_at, delivered_at, created_at) VALUES (?,?,?,?,?,?,?)', round.id, videoId, n, 'open', null, null, round.created_at);
    return round;
  }
  async comment(id: string) {
    const r = await this.db.first('SELECT * FROM comments WHERE id = ?', id);
    if (!r) throw notFound(`No comment with id ${id}`);
    if (this.scope) await this.video(r.video_id);
    return toComment(r);
  }
  async createComment(c: Row) {
    const version = await this.version(c.version_id);
    const parent = c.parent_id ? await this.comment(c.parent_id) : null;
    const drawing = cleanDrawing(c.drawing);
    const t = now();
    const id = newId(parent ? 'rep' : 'rev');
    const round = parent ? null : await this.openRound(version.video_id);
    await this.db.batch([
      this.db.stmt(`INSERT INTO comments(id, video_id, version_id, round_id, parent_id, timestamp, general, text, transcript, drawing, author, author_type, status, created_at, updated_at, user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open', ?, ?, ?)`,
        id, version.video_id, version.id, round?.id ?? null, parent?.id ?? null,
        parent ? parent.timestamp : Math.max(0, Number(c.timestamp) || 0), (parent ? parent.general : !!c.general) ? 1 : 0,
        String(c.text || '').trim(), String(c.transcript || '').trim(), drawing ? JSON.stringify(drawing) : null,
        this.user?.via === 'key' ? 'Editor' : this.user?.name || 'You', this.user?.via === 'key' ? 'agent' : 'human', t, t, this.user?.id ?? null),
      this.db.stmt('UPDATE videos SET updated_at = ? WHERE id = ?', t, version.video_id),
    ]);
    return this.comment(id);
  }
  /** Clients may only change or delete what they wrote; marking resolved is open to everyone in the workspace. */
  ownOnly(c: Row) { if (this.isClient && c.user_id !== this.user?.id) throw new HttpError(403, 'You can only change your own comments.'); }
  async updateComment(id: string, patch: Row) {
    const c = await this.comment(id);
    if (['text', 'transcript', 'timestamp', 'general', 'drawing', 'audio'].some((k) => patch[k] !== undefined)) this.ownOnly(c);
    const fields: string[] = [];
    const vals: any[] = [];
    const set = (k: string, v: any) => { fields.push(`${k} = ?`); vals.push(v); };
    if (patch.text !== undefined) set('text', String(patch.text).trim());
    if (patch.transcript !== undefined) set('transcript', String(patch.transcript).trim());
    if (patch.status !== undefined) { if (patch.status !== 'open' && patch.status !== 'resolved') throw bad('status must be open or resolved'); set('status', patch.status); }
    if (patch.timestamp !== undefined) set('timestamp', Math.max(0, Number(patch.timestamp) || 0));
    if (patch.general !== undefined) set('general', patch.general ? 1 : 0);
    if (patch.drawing !== undefined) { const d = cleanDrawing(patch.drawing); set('drawing', d ? JSON.stringify(d) : null); }
    if (patch.audio !== undefined) set('audio', patch.audio);
    if (patch.audio_duration !== undefined) set('audio_duration', patch.audio_duration);
    if (patch.audio_peaks !== undefined) set('audio_peaks', patch.audio_peaks ? JSON.stringify(patch.audio_peaks.slice(0, 128)) : null);
    if (!fields.length) return c;
    set('updated_at', now());
    await this.db.run(`UPDATE comments SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
    return this.comment(id);
  }
  async deleteComment(id: string) {
    const c = await this.comment(id);
    this.ownOnly(c);
    await this.db.run('DELETE FROM comments WHERE id = ?', id);
    if (c.audio) await this.env.MEDIA.delete(`audio/${c.audio}`);
    return c;
  }
  async reply(id: string, text: string) {
    const parent = await this.comment(id);
    const root = parent.parent_id ? await this.comment(parent.parent_id) : parent;
    if (!String(text || '').trim()) throw bad('text is required');
    return this.createComment({ version_id: root.version_id, parent_id: root.id, text });
  }
  async putAudio(id: string, body: ReadableStream | null, type: string, duration: number, peaks: number[] | null) {
    const c = await this.comment(id);
    this.ownOnly(c);
    if (!body) throw bad('Empty audio');
    const ext = type.includes('mp4') || type.includes('m4a') ? '.m4a' : type.includes('ogg') ? '.ogg' : type.includes('wav') ? '.wav' : '.webm';
    const name = `${c.id}-${newId('a').slice(2)}${ext}`;
    await this.env.MEDIA.put(`audio/${name}`, body, { httpMetadata: { contentType: type || 'audio/webm' } });
    if (c.audio) await this.env.MEDIA.delete(`audio/${c.audio}`);
    return this.updateComment(c.id, { audio: name, audio_duration: duration || 0, audio_peaks: peaks });
  }
  async submit(videoId: string) {
    const video = await this.video(videoId);
    const r = await this.db.first("SELECT * FROM rounds WHERE video_id = ? AND status = 'open' ORDER BY number DESC LIMIT 1", videoId);
    const comments = r ? await this.db.all('SELECT id FROM comments WHERE round_id = ? AND parent_id IS NULL', r.id) : [];
    if (!r || comments.length === 0) throw bad('Nothing to send yet — leave a comment first.');
    const t = now();
    await this.db.batch([
      this.db.stmt("UPDATE rounds SET status = 'submitted', submitted_at = ? WHERE id = ?", t, r.id),
      this.db.stmt('UPDATE videos SET updated_at = ? WHERE id = ?', t, videoId),
    ]);
    const proj = await this.projectOf(video.folder_id);
    await this.log('revisions_sent', `${comments.length} revision${comments.length === 1 ? '' : 's'} sent to the editor for “${video.title}”`, { video_id: video.id, folder_id: proj?.id });
    return { round: { ...r, status: 'submitted', submitted_at: t }, count: comments.length, results: [] };
  }
  async revisionsText(videoId: string) {
    const d = await this.videoDetail(videoId);
    const ver = new Map(d.versions.map((v) => [v.id, v]));
    const open = d.comments.filter((c: any) => !c.parent_id && c.status === 'open');
    const lines = [`# Revisions for "${d.video.title}"`, '', `${open.length} open revision${open.length === 1 ? '' : 's'}:`, ''];
    open.forEach((c: any, i: number) => {
      const v = ver.get(c.version_id);
      lines.push(`${i + 1}. [${c.general ? 'Whole video' : fmt(c.timestamp)}] (v${v?.number ?? '?'})`);
      if (c.text) lines.push(`   - ${c.text.replace(/\n/g, '\n     ')}`);
      if (c.transcript) lines.push(`   - Voice note: "${c.transcript}"`);
      if (c.drawing) lines.push(`   - Drawing on the frame (${c.drawing.shapes.length} mark${c.drawing.shapes.length === 1 ? '' : 's'})`);
      for (const r of d.comments.filter((x: any) => x.parent_id === c.id)) lines.push(`   - Reply from ${r.author}: ${r.text}`);
    });
    return lines.join('\n');
  }

  // activity
  seenKey() { return `_activity_seen_at:${this.user?.id}`; }
  async activity(limit = 50) {
    const me = this.user!;
    const seenRow = await this.db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', this.seenKey())
      ?? (me.role === 'owner' ? await this.db.first<{ value: string }>("SELECT value FROM settings WHERE key = '_activity_seen_at'") : null);
    const seen = Number(seenRow?.value || 0);
    // Mine = things I did by hand (not through Claude). Rows from before accounts had no user and were the owner's.
    const mine = (a: Row) => (a.user_id === me.id && a.actor !== 'agent') || (!a.user_id && a.actor === 'you' && me.role === 'owner');
    let rows = await this.db.all('SELECT * FROM activity ORDER BY created_at DESC LIMIT 400');
    if (this.scope) {
      const vids = new Map((await this.db.all<{ id: string; folder_id: string | null }>('SELECT id, folder_id FROM videos')).map((v) => [v.id, v.folder_id]));
      rows = rows.filter((a) => (a.folder_id && this.scope!.has(a.folder_id)) || (a.video_id && this.canSee(vids.get(a.video_id))));
    }
    const unread = rows.filter((a) => a.created_at > seen && !mine(a)).length;
    return { items: rows.slice(0, limit).map((a) => ({ ...a, mine: mine(a) })), unread, seen_at: seen };
  }
  async markSeen() {
    await this.db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', this.seenKey(), String(now()));
  }

  // workspaces (one per client or company) + members + invites
  async workspaces() {
    const rows = await this.db.all('SELECT * FROM workspaces ORDER BY position, created_at');
    return rows.filter((w) => !this.workspaceScope || this.workspaceScope.has(w.id));
  }
  async workspace(id: string) {
    const w = await this.db.first('SELECT * FROM workspaces WHERE id = ?', id);
    if (!w || (this.workspaceScope && !this.workspaceScope.has(w.id))) throw notFound(`No workspace with id ${id}`);
    return w;
  }
  async workspaceId(idOrName: string, create = false): Promise<string> {
    const w = await this.db.first<{ id: string }>('SELECT id FROM workspaces WHERE id = ? OR lower(name) = lower(?) ORDER BY id = ? DESC LIMIT 1', idOrName, idOrName.trim(), idOrName);
    if (w) return w.id;
    if (!create) throw notFound(`No workspace named “${idOrName}”`);
    return (await this.createWorkspace(idOrName)).id;
  }
  async createWorkspace(name: string) {
    this.staff();
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw bad('Name the workspace (the client or company).');
    const max = await this.db.first<{ p: number | null }>('SELECT MAX(position) AS p FROM workspaces');
    const id = newId('wsp');
    await this.db.run('INSERT INTO workspaces(id, name, position, created_at) VALUES (?,?,?,?)', id, n, (max?.p ?? 0) + 1, now());
    await this.log('project_created', `New workspace “${n}”`);
    return this.workspace(id);
  }
  async renameWorkspace(id: string, name: string) {
    this.staff();
    const w = await this.workspace(id);
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw bad('Name can’t be empty');
    await this.db.run('UPDATE workspaces SET name = ? WHERE id = ?', n, id);
    if (n !== w.name) await this.log('project_renamed', `Workspace “${w.name}” renamed to “${n}”`);
    return this.workspace(id);
  }
  async deleteWorkspace(id: string) {
    this.staff();
    const w = await this.workspace(id);
    await this.db.batch([
      this.db.stmt('UPDATE folders SET workspace_id = NULL WHERE workspace_id = ?', id),
      this.db.stmt('DELETE FROM workspaces WHERE id = ?', id),
    ]);
    await this.log('project_deleted', `Workspace “${w.name}” deleted (its projects stay, unassigned)`);
  }
  async members(workspaceId: string) {
    this.staff();
    await this.workspace(workspaceId);
    const people = await this.db.all('SELECT u.id, u.name, u.email, u.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at', workspaceId);
    const pending = await this.db.all('SELECT id, name, created_at, expires_at FROM invites WHERE workspace_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at', workspaceId, now());
    return { people, pending };
  }
  async invite(workspaceId: string, name: string, origin: string) {
    const w = await this.workspace(workspaceId);
    const who = String(name || '').trim().slice(0, 80);
    if (!who) throw bad('Who is this for? Add their name.');
    const token = 'inv_' + hex(crypto.getRandomValues(new Uint8Array(20)));
    await this.db.run('INSERT INTO invites(id, token_hash, workspace_id, name, role, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      newId('ivt'), await sha256(token), w.id, who, 'client', this.user!.id, now(), now() + 30 * 86_400_000);
    await this.log('project_updated', `Invite link made for ${who} to join “${w.name}”`);
    return { url: `${origin}/join/${token}`, name: who, workspace: w.name, expires_days: 30 };
  }

  /** Projects with their videos, for Claude's list tool. */
  async projects() {
    const [folders, videos, wss] = await Promise.all([this.folders(), this.listVideos(), this.workspaces()]);
    const wsName = new Map(wss.map((w) => [w.id, w.name]));
    return folders.filter((f) => !f.parent_id).map((f) => {
      const ids = new Set([f.id, ...folders.filter((c) => c.parent_id === f.id).map((c) => c.id)]);
      return {
        project_id: f.id, name: f.name, workspace: wsName.get(f.workspace_id) ?? null, status: f.status, status_label: STATUS_LABEL[f.status as Status], notes: f.notes, links: f.links,
        needs_cleanup: f.status === 'done' && !f.cleaned_at,
        videos: videos.filter((v) => v.folder_id && ids.has(v.folder_id)).map((v) => ({ video_id: v.id, title: v.title, latest_version: v.latest?.number ?? null, open_revisions_sent: v.open_count, being_revised: !!v.revising_at, revising_note: v.revising_note ?? null })),
      };
    });
  }

  // housekeeping (cron)
  async pruneDone() {
    const cutoff = now() - DONE_PRUNE_DAYS * 86_400_000;
    const folders = await this.folders();
    let total = 0;
    for (const p of folders.filter((f) => !f.parent_id && f.status === 'done' && f.status_at && f.status_at < cutoff)) {
      const ids = [p.id, ...folders.filter((c) => c.parent_id === p.id).map((c) => c.id)];
      const marks = ids.map(() => '?').join(',');
      const old = await this.db.all<{ id: string; key: string; poster_key: string | null }>(`SELECT ve.id, ve.key, ve.poster_key FROM versions ve JOIN videos vi ON vi.id = ve.video_id
        WHERE vi.removed_at IS NULL AND vi.folder_id IN (${marks}) AND ve.number < (SELECT MAX(number) FROM versions WHERE video_id = ve.video_id)`, ...ids);
      if (!old.length) continue;
      await this.db.batch(old.map((o) => this.db.stmt('DELETE FROM versions WHERE id = ?', o.id)));
      await this.deleteObjects(old.flatMap((o) => [o.key, o.poster_key]));
      total += old.length;
      await this.log('versions_cleared', `${old.length} old version${old.length === 1 ? '' : 's'} cleared from “${p.name}” after ${DONE_PRUNE_DAYS} days in Done`, { folder_id: p.id }, 'portal');
    }
    return total;
  }
}

function cleanLinks(links: any[]) {
  if (!Array.isArray(links)) throw bad('links must be a list');
  return links.slice(0, 50).map((l) => {
    let url = String(l?.url || '').trim();
    if (!url) throw bad('A link needs a URL');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    if (!/^https?:/i.test(url)) throw bad('Links must start with http:// or https://');
    let label = String(l?.label || '').trim();
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; } }
    return { id: l?.id || newId('lnk'), label: label.slice(0, 120), url: url.slice(0, 2000) };
  });
}

// ---------------------------------------------------------------- media (R2 with Range support)
async function serveObject(env: Env, req: Request, key: string, cache = 'private, max-age=3600', extra: Record<string, string> = {}) {
  const range = req.headers.get('range');
  let r2range: R2Range | undefined;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1] === '' && m[2]) r2range = { suffix: Number(m[2]) };
      else if (m[2]) r2range = { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 };
      else r2range = { offset: Number(m[1]) };
    }
  }
  const obj = await env.MEDIA.get(key, r2range ? { range: r2range } : undefined);
  if (!obj) return json({ error: 'Not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', cache);
  headers.set('etag', obj.httpEtag);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  if (r2range && 'range' in obj && obj.range) {
    const rg: any = obj.range;
    const start = rg.offset ?? (obj.size - (rg.suffix ?? 0));
    const len = rg.length ?? (obj.size - start);
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

// ---------------------------------------------------------------- router
async function body(req: Request) { try { return (await req.json()) as Row; } catch { return {}; } }

async function handleApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  const db = new Db(env.DB);
  let mm0: RegExpExecArray | null;

  // ---- auth (no session needed)
  if (p === '/api/health') return json({ ok: true, app: 'portal', cloud: true });
  if (p === '/api/auth/state') {
    const n = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    const user = await currentUser(db, req);
    return json({ setup_needed: !n?.n, user });
  }
  if (p === '/api/auth/setup' && m === 'POST') {
    const b = await body(req);
    const n = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    if (n?.n) throw new HttpError(403, 'Portal is already set up. Sign in instead.');
    if (!env.SETUP_CODE || !timingSafeEqual(String(b.code || '').trim(), env.SETUP_CODE)) throw new HttpError(403, 'That setup code isn’t right.');
    const email = String(b.email || '').trim().toLowerCase();
    if (env.OWNER_EMAIL && email !== env.OWNER_EMAIL.toLowerCase()) throw new HttpError(403, 'Use the email this Portal was set up for.');
    if (String(b.password || '').length < 10) throw bad('Use a password of at least 10 characters.');
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const id = newId('usr');
    await db.run('INSERT INTO users(id, email, name, role, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?,?)', id, email, String(b.name || '').trim() || email.split('@')[0], 'owner', await hashPassword(String(b.password), salt), salt, now());
    return json({ ok: true }, 200, { 'set-cookie': await startSession(db, id) });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    const recent = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?', email, now() - 15 * 60_000);
    if ((recent?.n ?? 0) >= 8) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
    const u = await db.first<Row>('SELECT * FROM users WHERE email = ?', email);
    const ok = u && timingSafeEqual(await hashPassword(String(b.password || ''), u.salt), u.pass_hash);
    if (!ok) {
      await db.run('INSERT INTO login_attempts(email, at) VALUES (?, ?)', email, now());
      throw new HttpError(401, 'Wrong email or password.');
    }
    await db.run('DELETE FROM login_attempts WHERE email = ?', email);
    return json({ ok: true }, 200, { 'set-cookie': await startSession(db, u!.id) });
  }
  if (p === '/api/auth/logout' && m === 'POST') {
    const token = cookie(req, SESSION_COOKIE);
    if (token) await db.run('DELETE FROM sessions WHERE id = ?', await sha256(token));
    return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  // ---- invites: look up and accept (the link is the credential; single use, 30 days)
  if ((mm0 = /^\/api\/join\/(inv_[a-f0-9]+)$/.exec(p)) && m === 'GET') {
    const inv = await db.first<Row>('SELECT i.name, i.expires_at, i.used_at, w.name AS workspace FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ?', await sha256(mm0[1]));
    if (!inv || inv.used_at || inv.expires_at < now()) return json({ valid: false });
    const owner = await db.first<{ name: string }>("SELECT name FROM users WHERE role = 'owner' LIMIT 1");
    return json({ valid: true, name: inv.name, workspace: inv.workspace, from: owner?.name ?? 'Gleam Films' });
  }
  if ((mm0 = /^\/api\/join\/(inv_[a-f0-9]+)$/.exec(p)) && m === 'POST') {
    const inv = await db.first<Row>('SELECT * FROM invites WHERE token_hash = ?', await sha256(mm0[1]));
    if (!inv || inv.used_at || inv.expires_at < now()) throw new HttpError(410, 'This invite link has been used or has expired. Ask for a new one.');
    const b = await body(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email.');
    const password = String(b.password || '');
    let u = await db.first<Row>('SELECT * FROM users WHERE email = ?', email);
    if (u) {
      // Already has an account: the right password adds this workspace to it.
      if (!timingSafeEqual(await hashPassword(password, u.salt), u.pass_hash)) throw new HttpError(401, 'You already have an account with this email. Enter that password to add this workspace.');
    } else {
      if (password.length < 8) throw bad('Use a password of at least 8 characters.');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      u = { id: newId('usr') };
      await db.run('INSERT INTO users(id, email, name, role, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?,?)', u.id, email, String(b.name || inv.name).trim().slice(0, 80) || inv.name, inv.role || 'client', await hashPassword(password, salt), salt, now());
    }
    await db.batch([
      db.stmt('INSERT OR IGNORE INTO workspace_members(workspace_id, user_id, created_at) VALUES (?,?,?)', inv.workspace_id, u.id, now()),
      db.stmt('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?', now(), u.id, inv.id),
    ]);
    const joined = await currentUserById(db, u.id);
    await new Portal(env, joined).log('project_updated', `${joined?.name ?? 'Someone'} joined “${(await db.first<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', inv.workspace_id))?.name}”`);
    await db.touch();
    return json({ ok: true }, 200, { 'set-cookie': await startSession(db, u.id) });
  }

  // ---- everything else needs a signed-in person
  const user = await currentUser(db, req);
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  const app = await new Portal(env, user, ctx).loadScope();
  const origin = url.origin;
  const writes = m !== 'GET' && m !== 'HEAD';
  const done = async (v: unknown) => { if (writes) await db.touch(); return json(v); };
  let mm: RegExpExecArray | null;

  if (p === '/api/me') return json(user);
  if (p === '/api/projects' && m === 'GET') { app.staff(); return json(await app.projects()); }
  if (p === '/api/workspaces' && m === 'GET') return json(await app.workspaces());
  if (p === '/api/workspaces' && m === 'POST') return done(await app.createWorkspace((await body(req)).name));
  if ((mm = /^\/api\/workspaces\/([\w]+)$/.exec(p))) {
    if (m === 'PATCH') return done(await app.renameWorkspace(mm[1], (await body(req)).name));
    if (m === 'DELETE') { await app.deleteWorkspace(mm[1]); return done({ ok: true }); }
  }
  if ((mm = /^\/api\/workspaces\/([\w]+)\/members$/.exec(p)) && m === 'GET') return json(await app.members(mm[1]));
  if ((mm = /^\/api\/workspaces\/([\w]+)\/members\/([\w]+)$/.exec(p)) && m === 'DELETE') {
    if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can remove people.');
    await db.run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', mm[1], mm[2]);
    return done({ ok: true });
  }
  if (p === '/api/invites' && m === 'POST') {
    if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can invite people.');
    const b = await body(req);
    return done(await app.invite(String(b.workspace_id || ''), String(b.name || ''), origin));
  }
  if ((mm = /^\/api\/invites\/([\w]+)$/.exec(p)) && m === 'DELETE') {
    if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can cancel invites.');
    await db.run('DELETE FROM invites WHERE id = ? AND used_at IS NULL', mm[1]);
    return done({ ok: true });
  }
  // Access keys: only the owner, only from a signed-in browser session (a key can't mint keys).
  if (p === '/api/keys' && m === 'POST') {
    if (user.role !== 'owner' || user.via !== 'session') throw new HttpError(403, 'Only the owner can create access keys.');
    const key = 'pk_' + hex(crypto.getRandomValues(new Uint8Array(24)));
    const name = String((await body(req)).name || 'Claude').slice(0, 80);
    await db.run('INSERT INTO api_keys(id, user_id, name, key_hash, created_at) VALUES (?,?,?,?,?)', newId('key'), user.id, name, await sha256(key), now());
    return json({ key, name });
  }
  if (p === '/api/platform') return json({ id: 'cloud', canPick: false });
  if (p === '/api/settings') return m === 'PUT' ? done(await app.saveSettings(await body(req))) : json(await app.settings());
  if (p === '/api/events') return events(env, req);

  // videos
  if (p === '/api/videos' && m === 'GET') return json(await app.listVideos());
  if (p === '/api/videos/move' && m === 'POST') { app.staff(); const b = await body(req); await app.moveVideos(b.ids || [], b.folder_id ?? null, b.before_id); return done({ ok: true }); }
  if (p === '/api/videos/remove' && m === 'POST') { app.staff(); return done(await app.removeVideos((await body(req)).ids || [])); }
  if (p === '/api/videos/revising' && m === 'POST') { const b = await body(req); return done(await app.setRevising(Array.isArray(b.ids) ? b.ids : [], b.on !== false, b.note)); }
  if (p === '/api/videos/restore' && m === 'POST') { app.staff(); return done(await app.restoreVideos((await body(req)).ids || [])); }
  if ((mm = /^\/api\/videos\/([\w]+)\/submit$/.exec(p)) && m === 'POST') return done(await app.submit(mm[1]));
  if ((mm = /^\/api\/videos\/([\w]+)\/agent-message$/.exec(p))) return json({ text: await app.revisionsText(mm[1]) });
  if ((mm = /^\/api\/videos\/([\w]+)$/.exec(p))) {
    if (m === 'GET') return json(await app.videoDetail(mm[1]));
    if (m === 'PATCH') { app.staff(); return done(await app.renameVideo(mm[1], (await body(req)).title)); }
    if (m === 'DELETE') { app.staff(); await app.removeVideos([mm[1]]); return done({ ok: true }); }
  }
  if ((mm = /^\/api\/versions\/([\w]+)$/.exec(p)) && m === 'DELETE') { app.staff(); await app.removeVersion(mm[1]); return done({ ok: true }); }
  if ((mm = /^\/api\/versions\/([\w]+)\/poster$/.exec(p)) && m === 'PUT') return done(await app.putPoster(mm[1], req.body));

  // uploads
  if (p === '/api/uploads' && m === 'POST') return json(await app.uploadStart(await body(req)));
  if (p === '/api/uploads/part' && m === 'PUT') return json(await app.uploadPart(url.searchParams.get('key') || '', url.searchParams.get('uploadId') || '', Number(url.searchParams.get('part')), req.body));
  if (p === '/api/uploads/abort' && m === 'POST') { const b = await body(req); await app.uploadAbort(b.key, b.uploadId); return json({ ok: true }); }
  if (p === '/api/uploads/complete' && m === 'POST') return done(await app.uploadComplete(await body(req)));

  // folders
  if (p === '/api/folders' && m === 'GET') return json(await app.folders());
  if (p === '/api/folders' && m === 'POST') { app.staff(); const b = await body(req); return done(await app.createFolder(b.name, b.parent_id ?? null, b.status, b.workspace_id ?? null)); }
  if ((mm = /^\/api\/folders\/([\w]+)$/.exec(p))) {
    if (m === 'PATCH') { app.staff(); return done(await app.updateFolder(mm[1], await body(req))); }
    if (m === 'DELETE') { app.staff(); await app.deleteFolder(mm[1]); return done({ ok: true }); }
  }

  // comments
  if (p === '/api/comments' && m === 'POST') return done(await app.createComment(await body(req)));
  if ((mm = /^\/api\/comments\/([\w]+)\/replies$/.exec(p)) && m === 'POST') return done(await app.reply(mm[1], (await body(req)).text));
  if ((mm = /^\/api\/comments\/([\w]+)\/audio$/.exec(p)) && m === 'POST') {
    let peaks: number[] | null = null;
    try { peaks = JSON.parse(url.searchParams.get('peaks') || 'null'); } catch { /* ignore */ }
    return done(await app.putAudio(mm[1], req.body, req.headers.get('content-type') || '', Number(url.searchParams.get('duration')) || 0, peaks));
  }
  if ((mm = /^\/api\/comments\/([\w]+)$/.exec(p))) {
    if (m === 'PATCH') { const b = await body(req); return done(await app.updateComment(mm[1], { text: b.text, status: b.status, transcript: b.transcript, timestamp: b.timestamp, general: b.general, drawing: b.drawing })); }
    if (m === 'DELETE') { await app.deleteComment(mm[1]); return done({ ok: true }); }
  }

  // activity
  if (p === '/api/activity') return json(await app.activity(Math.min(200, Number(url.searchParams.get('limit')) || 50)));
  if (p === '/api/activity/seen' && m === 'POST') { await app.markSeen(); return done({ ok: true }); }

  return json({ error: 'Not found' }, 404);
}

/** Server-sent events: tells open tabs to refresh when anything changes (polls a revision counter). */
function events(env: Env, req: Request) {
  const enc = new TextEncoder();
  const db = new Db(env.DB);
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode('retry: 3000\n\n'));
      let last = (await db.first<{ value: string }>("SELECT value FROM meta WHERE key = 'rev'"))?.value;
      const until = Date.now() + 55_000;
      while (Date.now() < until && !req.signal.aborted) {
        await new Promise((r) => setTimeout(r, 2500));
        const v = (await db.first<{ value: string }>("SELECT value FROM meta WHERE key = 'rev'").catch(() => null))?.value;
        if (v !== last) { last = v; ctrl.enqueue(enc.encode(`event: changed\ndata: {"what":"any"}\n\n`)); }
        else ctrl.enqueue(enc.encode(': ping\n\n'));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' } });
}

async function handleMedia(req: Request, env: Env) {
  const db = new Db(env.DB);
  const user = await currentUser(db, req);
  if (!user) return new Response('Sign in to continue.', { status: 401 });
  const p = new URL(req.url).pathname;
  const app = await new Portal(env, user).loadScope();
  let mm: RegExpExecArray | null;
  if ((mm = /^\/media\/([\w]+)$/.exec(p))) {
    const v = await app.version(mm[1]).catch(() => null) as { key: string; filename: string; video_id: string } | null;
    if (!v) return json({ error: 'Not found' }, 404);
    if (app.isClient && (await app.video(v.video_id)).revising_at) return json({ error: 'A new version is on its way.' }, 403);
    // ?download=1 saves the original file under its own name instead of playing it.
    const dl = new URL(req.url).searchParams.has('download');
    const ascii = v.filename.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
    return serveObject(env, req, v.key, 'private, max-age=3600', dl ? { 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(v.filename)}` } : {});
  }
  if ((mm = /^\/api\/versions\/([\w]+)\/poster\.jpg$/.exec(p))) {
    const v = await app.version(mm[1]).catch(() => null) as { poster_key: string | null; video_id: string } | null;
    return v?.poster_key ? serveObject(env, req, v.poster_key, 'private, max-age=86400') : json({ error: 'No poster' }, 404);
  }
  if ((mm = /^\/audio\/((rev|rep)_[a-z0-9]+)-[\w.\-]+$/.exec(p))) {
    if (!(await app.comment(mm[1]).catch(() => null))) return json({ error: 'Not found' }, 404);
    return serveObject(env, req, `audio/${p.slice('/audio/'.length)}`);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const p = new URL(req.url).pathname;
    try {
      await ensureSchema(env);
      if (p.startsWith('/media/') || p.startsWith('/audio/') || /^\/api\/versions\/[\w]+\/poster\.jpg$/.test(p)) return await handleMedia(req, env);
      if (p.startsWith('/api/')) {
        // Same-origin only for writes: blocks other sites from posting with your cookie.
        const origin = req.headers.get('origin');
        if (req.method !== 'GET' && origin && origin !== new URL(req.url).origin) return json({ error: 'Cross-site request blocked.' }, 403);
        return await handleApi(req, env, ctx);
      }
      return env.ASSETS.fetch(req);
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on Portal’s side.' }, 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await ensureSchema(env);
    const app = new Portal(env, null);
    const n = (await app.purgeRemoved(60_000)) + (await app.pruneDone());
    await new Db(env.DB).run('DELETE FROM sessions WHERE expires_at < ?', now());
    await new Db(env.DB).run('DELETE FROM login_attempts WHERE at < ?', now() - 86_400_000);
    if (n) await new Db(env.DB).touch();
  },
} satisfies ExportedHandler<Env>;
