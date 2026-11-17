import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
        if (name === 'portal' || name === 'bottle') return dir;
      } catch { /* keep looking */ }
    }
    dir = path.dirname(dir);
  }
  return path.resolve(start, '..');
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = findRoot(here);
export const DATA_DIR = path.resolve(process.env.PORTAL_DATA_DIR || process.env.BOTTLE_DATA_DIR || path.join(ROOT, 'data'));
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const POSTER_DIR = path.join(DATA_DIR, 'posters');
export const WEB_DIR = path.join(ROOT, 'dist', 'web');
export const MCP_ENTRY = path.join(ROOT, 'dist', 'server', 'mcp.js');
export const PORT = Number(process.env.PORTAL_PORT || process.env.BOTTLE_PORT || 4317);
export const HOST = '127.0.0.1';

for (const d of [DATA_DIR, AUDIO_DIR, POSTER_DIR]) fs.mkdirSync(d, { recursive: true });
