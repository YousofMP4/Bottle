/**
 * Everything OS-specific lives behind this interface so Windows/Linux can be filled in later
 * without touching the rest of the app.
 */
import { mac } from './mac.js';
import { windows } from './windows.js';
import { linux } from './linux.js';

export interface Platform {
  id: 'mac' | 'windows' | 'linux';
  /** Shows the OS-native "choose a video" dialog. Resolves to an absolute path, or null if cancelled. */
  pickVideoFile(): Promise<string | null>;
  /** Whether a native picker is available at all (the UI falls back to "paste a path" otherwise). */
  canPick(): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  revealFile(file: string): Promise<void>;
  /** Where Claude Desktop keeps its config on this OS (shown in Settings). */
  claudeDesktopConfigPath(): string;
}

export { PickerUnavailable } from "./exec.js";

export const platform: Platform = process.platform === 'darwin' ? mac : process.platform === 'win32' ? windows : linux;
