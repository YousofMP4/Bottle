import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';
import { exec } from './exec.js';

export const mac: Platform = {
  id: 'mac',
  async canPick() { return true; },
  async pickVideoFile() {
    // `activate` brings osascript's own dialog to the front without needing Automation permission.
    const r = await exec('osascript', [
      '-e', 'activate',
      '-e', 'set f to choose file with prompt "Choose a video to review in Bottle" of type {"public.movie", "public.mpeg-4", "com.apple.quicktime-movie"}',
      '-e', 'POSIX path of f',
    ]);
    if (r.code !== 0) {
      if (/-128|cancel/i.test(r.stderr)) return null;
      throw new Error(r.stderr.trim() || 'The file picker could not open');
    }
    return r.stdout.trim() || null;
  },
  async openUrl(url) { await exec('open', [url]); },
  async revealFile(file) { await exec('open', ['-R', file]); },
  claudeDesktopConfigPath() {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  },
};
