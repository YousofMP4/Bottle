// Shared between server and web (imported with `import type` by the client).

export type Tool = 'pen' | 'arrow' | 'rect' | 'ellipse';

/** A single vector shape. All coordinates are normalized 0..1 over the video frame. */
export interface Shape {
  tool: Tool;
  color: string; // #rrggbb
  /** Stroke width as a fraction of the frame height (resolution independent). */
  width: number;
  /** pen: polyline; arrow: [tail, head]; rect/ellipse: [corner, opposite corner]. */
  points: [number, number][];
}

export interface Drawing {
  shapes: Shape[];
}

export interface Version {
  id: string;
  video_id: string;
  number: number;
  path: string;
  filename: string;
  size: number;
  mtime: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  created_at: number;
  missing?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  /** Folders nest one level: a folder with a parent can't have children. */
  parent_id: string | null;
  position: number;
  created_at: number;
}

export interface Video {
  id: string;
  title: string;
  folder_id?: string | null;
  position?: number;
  created_at: number;
  updated_at: number;
}

export interface VideoSummary extends Video {
  latest: Version | null;
  version_count: number;
  open_count: number;
  draft_count: number;
}

export interface Comment {
  id: string;
  video_id: string;
  version_id: string;
  round_id: string | null;
  parent_id: string | null;
  timestamp: number;
  text: string;
  transcript: string;
  audio: string | null;
  audio_duration: number;
  audio_peaks: number[] | null;
  drawing: Drawing | null;
  author: string;
  author_type: 'human' | 'agent';
  status: 'open' | 'resolved';
  resolved_note: string;
  created_at: number;
  updated_at: number;
}

export interface Round {
  id: string;
  video_id: string;
  number: number;
  status: 'open' | 'submitted';
  submitted_at: number | null;
  delivered_at: number | null;
  created_at: number;
}

export interface VideoDetail {
  video: Video;
  versions: Version[];
  comments: Comment[];
  rounds: Round[];
}

export interface Settings {
  name: string;
  webhook_enabled: boolean;
  webhook_url: string;
  revisions_md: boolean;
  transcriber: 'browser' | 'whisper' | 'off';
  whisper_bin: string;
  whisper_model: string;
  /** Soft mechanical click on button presses (WebAudio). Off by default. */
  click_sound: boolean;
}
