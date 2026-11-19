import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { agentMessage, getRevisions, getSettings, latestVersion, getVideo } from './core.js';
import type { Round } from './types.js';

export interface NotifyResult { channel: string; ok: boolean; detail: string }

/** Fan out a submitted round to every enabled channel. Never throws. */
export async function notifyRoundSubmitted(videoId: string, round: Round): Promise<NotifyResult[]> {
  const s = getSettings();
  const results: NotifyResult[] = [{ channel: 'mcp', ok: true, detail: 'Available to wait_for_revisions' }];

  if (s.revisions_md) {
    const md = agentMessage(videoId, { includeDrafts: false });
    const v = latestVersion(videoId);
    const target = v ? path.join(path.dirname(v.path), 'revisions.md') : '';
    try {
      if (!target) throw new Error('no version');
      fs.writeFileSync(target, md + '\n');
      results.push({ channel: 'revisions.md', ok: true, detail: target });
    } catch {
      const fallback = path.join(DATA_DIR, 'revisions', `${videoId}.md`);
      fs.mkdirSync(path.dirname(fallback), { recursive: true });
      fs.writeFileSync(fallback, md + '\n');
      results.push({ channel: 'revisions.md', ok: true, detail: `${fallback} (video folder not writable)` });
    }
  }

  if (s.webhook_enabled && s.webhook_url) {
    try {
      const video = getVideo(videoId);
      const body = {
        event: 'revisions.submitted',
        round: { id: round.id, number: round.number, submitted_at: new Date(round.submitted_at!).toISOString() },
        ...getRevisions(videoId, { status: 'open', roundId: round.id }),
        title: video.title,
        message: agentMessage(videoId, { roundId: round.id, includeDrafts: false }),
      };
      const res = await fetch(s.webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Portal' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      results.push({ channel: 'webhook', ok: res.ok, detail: `HTTP ${res.status}` });
    } catch (e: any) {
      results.push({ channel: 'webhook', ok: false, detail: e?.message || 'failed' });
    }
  }
  return results;
}
