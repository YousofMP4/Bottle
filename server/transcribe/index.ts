/**
 * Transcription is pluggable. Today:
 *  - 'browser': the client transcribes live with the Web Speech API and sends the text along.
 *  - 'whisper': the server runs a local whisper.cpp binary on the saved audio file.
 * Add another engine by implementing `ServerTranscriber` and registering it below.
 */
import type { Settings } from '../types.js';
import { whisperCpp } from './whisper.js';

export interface ServerTranscriber {
  id: string;
  available(settings: Settings): Promise<boolean>;
  transcribe(audioFile: string, settings: Settings): Promise<string>;
}

const engines: Record<string, ServerTranscriber> = { whisper: whisperCpp };

export function serverTranscriber(settings: Settings): ServerTranscriber | null {
  return engines[settings.transcriber] ?? null;
}
