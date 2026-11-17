import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

// Libraries made before the rename to Portal live in bottle.db; keep using it so nothing is lost.
const legacy = path.join(DATA_DIR, 'bottle.db');
export const db = new Database(fs.existsSync(legacy) ? legacy : path.join(DATA_DIR, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  fps REAL NOT NULL DEFAULT 30,
  codec TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_video ON versions(video_id, number);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  submitted_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  timestamp REAL NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  audio TEXT,
  audio_duration REAL NOT NULL DEFAULT 0,
  audio_peaks TEXT,
  drawing TEXT,
  author TEXT NOT NULL DEFAULT 'You',
  author_type TEXT NOT NULL DEFAULT 'human',
  status TEXT NOT NULL DEFAULT 'open',
  resolved_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_video ON comments(video_id, version_id, timestamp);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

// Migrations for libraries created before folders existed. Additive only.
{
  const cols = new Set((db.prepare('PRAGMA table_info(videos)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('folder_id')) db.exec('ALTER TABLE videos ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL');
  if (!cols.has('position')) db.exec('ALTER TABLE videos ADD COLUMN position REAL NOT NULL DEFAULT 0');
  // Soft remove: "Remove from library" hides the reference first so it can be undone; it is purged
  // a little later. The video file on disk is never touched either way.
  if (!cols.has('removed_at')) db.exec('ALTER TABLE videos ADD COLUMN removed_at INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS videos_folder ON videos(folder_id, position)');
  // Video-wide comments: about the whole video rather than one moment. `timestamp` is still kept
  // (it anchors any drawing) but the UI and agent treat the comment as not time specific.
  const ccols = new Set((db.prepare('PRAGMA table_info(comments)').all() as { name: string }[]).map((c) => c.name));
  if (!ccols.has('general')) db.exec('ALTER TABLE comments ADD COLUMN general INTEGER NOT NULL DEFAULT 0');
  // Replies posted through the tools used to be signed "Agent"; they read as the editor now.
  db.prepare("UPDATE comments SET author = 'Editor' WHERE author = 'Agent' AND author_type = 'agent'").run();
  // Projects: every top-level folder is a project that moves through stages on the board.
  const fcols = new Set((db.prepare('PRAGMA table_info(folders)').all() as { name: string }[]).map((c) => c.name));
  if (!fcols.has('status')) db.exec("ALTER TABLE folders ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'");
  if (!fcols.has('status_at')) db.exec('ALTER TABLE folders ADD COLUMN status_at INTEGER');
  if (!fcols.has('links')) db.exec("ALTER TABLE folders ADD COLUMN links TEXT NOT NULL DEFAULT '[]'");
  if (!fcols.has('cleaned_at')) db.exec('ALTER TABLE folders ADD COLUMN cleaned_at INTEGER');
  if (!fcols.has('notes')) db.exec("ALTER TABLE folders ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  // What happened, and who did it: feeds the notifications bell and the agent's get_activity.
  db.exec(`CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    text TEXT NOT NULL,
    video_id TEXT,
    folder_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_time ON activity(created_at);`);
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Short, agent-friendly ids like `vid_k3m9q2xa`. */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export const now = () => Date.now();

/** Changes whenever *another* connection (e.g. the MCP process) commits. */
export function dataVersion(): number {
  return db.pragma('data_version', { simple: true }) as number;
}
