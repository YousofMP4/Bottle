import os from 'node:os';
import path from 'node:path';
import type { Platform } from './index.js';
import { exec } from './exec.js';

// Untested scaffold: PowerShell's WinForms dialog. Kept here so Windows support is a drop-in.
const PS_PICK = `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.Title = 'Choose a video to review in Portal';
$d.Filter = 'Videos|*.mp4;*.mov;*.m4v;*.webm;*.mkv|All files|*.*';
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }`;

export const windows: Platform = {
  id: 'windows',
  async canPick() { return true; },
  async pickVideoFile() {
    const r = await exec('powershell.exe', ['-NoProfile', '-STA', '-Command', PS_PICK]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'The file picker could not open');
    return r.stdout.trim() || null;
  },
  async openUrl(url) { await exec('cmd', ['/c', 'start', '', url]); },
  async revealFile(file) { await exec('explorer.exe', ['/select,', file]); },
  claudeDesktopConfigPath() {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  },
};
