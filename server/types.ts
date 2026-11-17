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
  /** Project stage (top-level folders are projects). */
  status: ProjectStatus;
  status_at: number | null;
  links: ProjectLink[];
  notes: string;
  /** When the agent reported the Done clean-up (overlays, temp renders) finished; reset on every stage change. */
  cleaned_at: number | null;
  /** Online only: the client/company workspace a project belongs to. */
  workspace_id?: string | null;
}

/** Online only: one per client or company; projects live inside it and people are invited to it. */
export interface Workspace { id: string; name: string; position: number; created_at: number }

export type ProjectStatus = 'ready' | 'working' | 'revising' | 'done';
export const PROJECT_STATUSES: ProjectStatus[] = ['ready', 'working', 'revising', 'done'];
export const STATUS_LABEL: Record<ProjectStatus, string> = { ready: 'Ready to start', working: 'Working', revising: 'Revising', done: 'Done' };
/** Column titles on the board. Done carries its instruction: the agent deletes the unessential files. */
export const COLUMN_TITLE: Record<ProjectStatus, string> = { ...STATUS_LABEL, done: 'Done (delete unessential files)' };
/** Old versions in a project that has sat in Done this long are removed from Portal. */
export const DONE_PRUNE_DAYS = 7;
export interface ProjectLink { id: string; label: string; url: string }

export type ActivityKind = 'video_added' | 'version_added' | 'project_created' | 'project_moved' | 'project_renamed' | 'project_updated' | 'project_deleted' | 'agent_reply' | 'revision_resolved' | 'revisions_sent' | 'project_cleaned' | 'versions_cleared' | 'video_revising';
export interface Activity {
  id: string;
  kind: ActivityKind;
  /** 'you' for things done in this browser, 'agent' for MCP, 'portal' for automatic housekeeping. */
  actor: 'you' | 'agent' | 'portal' | 'client';
  /** Online: who did it, and whether it was the signed-in person (so it doesn't count as new). */
  user_id?: string | null;
  actor_name?: string | null;
  mine?: boolean;
  text: string;
  video_id: string | null;
  folder_id: string | null;
  created_at: number;
}

export interface Video {
  id: string;
  title: string;
  /** Online: a new version is being made; clients see "New version coming soon" instead of this cut. */
  revising_at?: number | null;
  revising_note?: string | null;
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
  /** About the whole video, not one moment. */
  general: boolean;
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
