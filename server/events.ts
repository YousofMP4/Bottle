import type { FastifyReply } from 'fastify';
import { dataVersion } from './db.js';

/** Server-Sent Events hub. Clients refetch on `changed`; payload hints at what changed. */
const clients = new Set<FastifyReply>();

export function addClient(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write('retry: 1500\n\n');
  clients.add(reply);
  reply.raw.on('close', () => clients.delete(reply));
}

export function broadcast(event: string, data: unknown = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.raw.write(msg);
}

/** Notice writes from other processes (the MCP server) and tell the browser. */
export function watchExternalWrites() {
  let last = dataVersion();
  setInterval(() => {
    const v = dataVersion();
    if (v !== last) { last = v; broadcast('changed', { source: 'agent' }); }
  }, 400).unref();
  setInterval(() => { for (const c of clients) c.raw.write(': ping\n\n'); }, 20_000).unref();
}
