import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerTranscriber } from './index.js';
import { exec } from '../platform/exec.js';
import { toWav16k } from '../media.js';

/** whisper.cpp (`whisper-cli` / legacy `main`) run fully offline on the saved voice note. */
export const whisperCpp: ServerTranscriber = {
  id: 'whisper',
  async available(s) {
    return !!s.whisper_bin && !!s.whisper_model && fs.existsSync(s.whisper_bin) && fs.existsSync(s.whisper_model);
  },
  async transcribe(audioFile, s) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bottle-whisper-'));
    try {
      const wav = path.join(tmp, 'note.wav');
      await toWav16k(audioFile, wav);
      const outBase = path.join(tmp, 'out');
      const r = await exec(s.whisper_bin, ['-m', s.whisper_model, '-f', wav, '-otxt', '-of', outBase, '-nt'], { timeoutMs: 5 * 60_000 });
      if (r.code !== 0) throw new Error(r.stderr.slice(-400));
      const txt = fs.existsSync(outBase + '.txt') ? fs.readFileSync(outBase + '.txt', 'utf8') : r.stdout;
      return txt.replace(/\s+/g, ' ').trim();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
