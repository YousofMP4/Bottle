// Calls every Portal MCP tool over stdio, like an agent would. Usage: node scripts/mcp-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';

const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/server/mcp.js'], env: { ...process.env } });
const client = new Client({ name: 'portal-smoke', version: '1' });
await client.connect(transport);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const img = r.content.find((c) => c.type === 'image');
  return { r, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), img };
};
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const vids = (await call('list_videos')).json;
console.log('list_videos:', vids.map((v) => `${v.video_id} ${v.title} v${v.latest_version} open=${v.open_revisions_sent}`).join(' | '));
const film = vids.find((v) => v.title === 'Launch film');
const revs = (await call('get_revisions', { video_id: film.video_id })).json;
console.log('get_revisions:', JSON.stringify(revs.revisions.map((r) => ({ id: r.id, tc: r.timecode, text: r.text, drawing: r.drawing, voice: r.has_voice_note })), null, 1));
const withDrawing = revs.revisions.find((r) => r.drawing);
const f = await call('get_frame', { video_id: film.video_id, revision_id: withDrawing.id });
fs.writeFileSync(process.env.OUT || '/tmp/mcp-frame.png', Buffer.from(f.img.data, 'base64'));
console.log('get_frame:', f.text);
console.log('reply:', (await call('reply_to_revision', { id: withDrawing.id, text: 'On it — scaling the logo up 20%.' })).text);
const w = await call('wait_for_revisions', { video_id: film.video_id, timeout: 2 });
console.log('wait (already-sent round delivered once):', w.json.timed_out ? 'timed out' : `round ${w.json.round} with ${w.json.revisions.length}`);
const w2 = await call('wait_for_revisions', { video_id: film.video_id, timeout: 2 });
console.log('wait again:', w2.json.timed_out ? 'timed out (correct: nothing new)' : 'unexpected');
console.log('bad id:', (await call('get_revisions', { video_id: 'vid_nope' })).text);
await client.close();
