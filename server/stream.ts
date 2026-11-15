import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.ogg': 'video/ogg', '.avi': 'video/x-msvideo',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp',
  '.webm_a': 'audio/webm', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
export const mimeFor = (file: string, fallback = 'application/octet-stream') => MIME[path.extname(file).toLowerCase()] || fallback;

/**
 * Streams a file straight from where it lives on disk with HTTP Range support.
 * Every seek in the browser becomes a small ranged read — the file is never copied.
 */
export function sendRanged(req: FastifyRequest, reply: FastifyReply, file: string, type = mimeFor(file)) {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch {
    return reply.code(404).send({ error: 'File not found on disk. Was it moved or renamed?', path: file });
  }
  const size = st.size;
  const etag = `"${size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
  reply.header('Accept-Ranges', 'bytes').header('Content-Type', type).header('ETag', etag)
    .header('Last-Modified', st.mtime.toUTCString()).header('Cache-Control', 'no-cache');

  const range = req.headers.range;
  if (!range) {
    reply.header('Content-Length', size);
    return reply.code(200).send(fs.createReadStream(file));
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  let start: number, end: number;
  if (m[1] === '') { // suffix range: last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
  return reply.send(fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 }));
}
