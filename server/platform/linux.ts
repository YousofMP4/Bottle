import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';
import { exec, which, PickerUnavailable } from './exec.js';

export const linux: Platform = {
  id: 'linux',
  async canPick() { return !!process.env.DISPLAY && (await which('zenity')); },
  async pickVideoFile() {
    if (!(await this.canPick())) throw new PickerUnavailable('No native file picker here — paste the path instead.');
    const r = await exec('zenity', ['--file-selection', '--title=Choose a video to review in Portal',
      '--file-filter=Videos | *.mp4 *.mov *.m4v *.webm *.mkv']);
    if (r.code === 1) return null;
    if (r.code !== 0) throw new Error(r.stderr.trim());
    return r.stdout.trim() || null;
  },
  async openUrl(url) { await exec('xdg-open', [url]); },
  async revealFile(file) { await exec('xdg-open', [path.dirname(file)]); },
  claudeDesktopConfigPath() { return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'); },
};
