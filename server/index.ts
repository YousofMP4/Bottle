import Fastify, { type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, HOST, MCP_ENTRY, PORT, ROOT, WEB_DIR, DATA_DIR } from './paths.js';
import * as core from './core.js';
import { UserError } from './core.js';
import { poster } from './media.js';
import { platform, PickerUnavailable } from './platform/index.js';
import { sendRanged, mimeFor } from './stream.js';
import { addClient, broadcast, watchExternalWrites } from './events.js';
import { notifyRoundSubmitted } from './notify.js';
import { serverTranscriber } from './transcribe/index.js';
import { newId } from './db.js';

const app = Fastify({ logger: false, bodyLimit: 60 * 1024 * 1024 });

app.addContentTypeParser(/^(audio|video)\/.*/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

app.setErrorHandler((err: any, _req, reply) => {
  const status = err instanceof UserError ? err.status : err.statusCode || 500;
  if (status >= 500) console.error(err);
  reply.code(status).send({ error: err.message || 'Something went wrong' });
});

// Only answer to the local machine, even if someone points a hostname at us (DNS rebinding guard).
app.addHook('onRequest', async (req, reply) => {
  const host = (req.headers.host || '').split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return reply.code(403).send({ error: 'Bottle only serves this computer.' });
});

const changed = (what: string, data: Record<string, unknown> = {}) => broadcast('changed', { what, ...data });

// ---------- videos ----------
app.get('/api/health', async () => ({ ok: true, app: 'bottle' }));
app.get('/api/videos', async () => core.listVideos());
app.get<{ Params: { id: string } }>('/api/videos/:id', async (req) => core.videoDetail(req.params.id));

app.post<{ Body: { path: string; title?: string; videoId?: string } }>('/api/videos', async (req) => {
  const r = await core.addVideo(req.body.path, { title: req.body.title, videoId: req.body.videoId });
  changed('videos', { videoId: r.video.id });
  return r;
});

app.get('/api/platform', async () => ({ id: platform.id, canPick: await platform.canPick() }));

app.post<{ Body: { videoId?: string } }>('/api/videos/pick', async (req, reply) => {
  let file: string | null;
  try {
    file = await platform.pickVideoFile();
  } catch (e: any) {
    if (e instanceof PickerUnavailable) return reply.code(501).send({ error: e.message, fallback: 'paste' });
    throw e;
  }
  if (!file) return { cancelled: true };
  const r = await core.addVideo(file, { videoId: req.body?.videoId });
  changed('videos', { videoId: r.video.id });
  return r;
});

app.patch<{ Params: { id: string }; Body: { title: string } }>('/api/videos/:id', async (req) => {
  const v = core.renameVideo(req.params.id, req.body.title);
  changed('videos', { videoId: v.id });
  return v;
});
app.delete<{ Params: { id: string } }>('/api/videos/:id', async (req) => {
  core.removeVideo(req.params.id);
  changed('videos');
  return { ok: true };
});
app.delete<{ Params: { id: string } }>('/api/versions/:id', async (req) => {
  const v = core.getVersion(req.params.id);
  core.removeVersion(req.params.id);
  changed('videos', { videoId: v.video_id });
  return { ok: true };
});
app.post<{ Params: { id: string } }>('/api/versions/:id/reveal', async (req) => {
  await platform.revealFile(core.getVersion(req.params.id).path);
  return { ok: true };
});

// ---------- media ----------
app.get<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
  const v = core.getVersion(req.params.id);
  return sendRanged(req, reply, v.path);
});
app.get<{ Params: { id: string } }>('/api/versions/:id/poster.jpg', async (req, reply) => {
  const v = core.getVersion(req.params.id);
  try {
    const file = await poster(v.id, v.path, v.duration);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/jpeg');
    return reply.send(fs.createReadStream(file));
  } catch {
    return reply.code(404).send({ error: 'No poster' });
  }
});
app.get<{ Querystring: { videoId?: string; versionId?: string; t?: string; revisionId?: string } }>('/api/frame.png', async (req, reply) => {
  const q = req.query;
  const r = await core.frameWithDrawings({ videoId: q.videoId, versionId: q.versionId, revisionId: q.revisionId, timestamp: q.t !== undefined ? Number(q.t) : undefined });
  reply.type('image/png').header('Cache-Control', 'no-store');
  return reply.send(r.png);
});
app.get<{ Params: { file: string } }>('/audio/:file', async (req, reply) => {
  const name = path.basename(req.params.file);
  return sendRanged(req, reply, path.join(AUDIO_DIR, name), mimeFor(name.replace(/\.webm$/, '.webm_a'), 'audio/webm'));
});

// ---------- comments ----------
app.post<{ Body: core.NewComment }>('/api/comments', async (req) => {
  const c = core.createComment({ ...req.body, author_type: 'human', author: core.getSettings().name });
  changed('comments', { videoId: c.video_id });
  return c;
});
app.patch<{ Params: { id: string }; Body: any }>('/api/comments/:id', async (req) => {
  const { text, status, transcript, timestamp, drawing } = (req.body || {}) as any;
  const c = core.updateComment(req.params.id, { text, status, transcript, timestamp, drawing });
  changed('comments', { videoId: c.video_id });
  return c;
});
app.delete<{ Params: { id: string } }>('/api/comments/:id', async (req) => {
  const c = core.deleteComment(req.params.id);
  if (c.audio) fs.rmSync(path.join(AUDIO_DIR, c.audio), { force: true });
  changed('comments', { videoId: c.video_id });
  return { ok: true };
});
app.post<{ Params: { id: string }; Body: { text: string } }>('/api/comments/:id/replies', async (req) => {
  const s = core.getSettings();
  const c = core.replyToRevision(req.params.id, req.body.text, s.name, 'human');
  changed('comments', { videoId: c.video_id });
  return c;
});

/** Voice note upload (from this browser to this machine). Body is the raw audio blob. */
app.post<{ Params: { id: string }; Querystring: { duration?: string; peaks?: string } }>('/api/comments/:id/audio', async (req) => {
  const c = core.getComment(req.params.id);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) throw new UserError('Empty audio');
  const ct = String(req.headers['content-type'] || '');
  const ext = ct.includes('mp4') || ct.includes('m4a') ? '.m4a' : ct.includes('ogg') ? '.ogg' : ct.includes('wav') ? '.wav' : '.webm';
  const name = `${c.id}-${newId('a').slice(2)}${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, name), body);
  if (c.audio) fs.rmSync(path.join(AUDIO_DIR, c.audio), { force: true });
  let peaks: number[] | null = null;
  try { peaks = req.query.peaks ? JSON.parse(req.query.peaks) : null; } catch { /* ignore */ }
  let updated = core.updateComment(c.id, { audio: name, audio_duration: Number(req.query.duration) || 0, audio_peaks: peaks });
  changed('comments', { videoId: c.video_id });

  const s = core.getSettings();
  const engine = serverTranscriber(s);
  if (engine && (await engine.available(s))) {
    engine.transcribe(path.join(AUDIO_DIR, name), s).then((text) => {
      if (text) { core.updateComment(c.id, { transcript: text }); changed('comments', { videoId: c.video_id }); }
    }).catch((e) => console.error('[transcribe]', e.message));
    updated = { ...updated };
  }
  return updated;
});

// ---------- rounds ----------
app.post<{ Params: { id: string } }>('/api/videos/:id/submit', async (req) => {
  const { round, comments } = core.submitRound(req.params.id);
  const results = await notifyRoundSubmitted(req.params.id, round);
  changed('comments', { videoId: req.params.id });
  return { round, count: comments.length, results };
});
app.get<{ Params: { id: string } }>('/api/videos/:id/agent-message', async (req) => ({ text: core.agentMessage(req.params.id) }));

// ---------- settings ----------
app.get('/api/settings', async () => core.getSettings());
app.put<{ Body: any }>('/api/settings', async (req) => {
  const s = core.setSettings(req.body || {});
  changed('settings');
  return s;
});
app.post<{ Body: { url: string } }>('/api/settings/test-webhook', async (req) => {
  try {
    const res = await fetch(req.body.url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Bottle' },
      body: JSON.stringify({ event: 'bottle.test', message: 'Hello from Bottle 👋' }), signal: AbortSignal.timeout(6000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

app.get('/api/connect', async () => {
  const node = process.execPath;
  const built = fs.existsSync(MCP_ENTRY);
  const desktop = { mcpServers: { bottle: { command: node, args: [MCP_ENTRY] } } };
  return {
    built,
    node,
    entry: MCP_ENTRY,
    root: ROOT,
    dataDir: DATA_DIR,
    claudeCode: `claude mcp add --scope user bottle -- "${node}" "${MCP_ENTRY}"`,
    claudeDesktop: JSON.stringify(desktop, null, 2),
    claudeDesktopPath: platform.claudeDesktopConfigPath(),
  };
});

app.get('/api/events', async (_req, reply: FastifyReply) => {
  addClient(reply);
  return reply; // keep open
});

// ---------- web app ----------
if (fs.existsSync(WEB_DIR)) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

watchExternalWrites();

try {
  await app.listen({ host: HOST, port: PORT });
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n  🍾  Bottle is running at ${url}\n      Data: ${DATA_DIR}\n      Leave this window open while you review. Close it to stop Bottle.\n`);
  if (process.argv.includes('--open')) platform.openUrl(url).catch(() => {});
} catch (e: any) {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is busy — Bottle may already be running. Open http://${HOST}:${PORT}\n`);
    process.exit(2);
  }
  throw e;
}
