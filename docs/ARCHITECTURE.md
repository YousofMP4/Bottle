# Architecture (short)

1. **One Node process** (`server/index.ts`, Fastify) bound to 127.0.0.1:4317 serves the built React app,
   a JSON API, an SSE event stream, and `/media/:versionId` which streams the original file with HTTP Range.
2. **Videos are references**: a `versions` row stores the absolute path; nothing is copied or re-encoded.
3. **SQLite** (`data/bottle.db`, better-sqlite3, WAL) holds videos → versions → comments (threaded,
   with normalized vector drawings as JSON, transcript, audio file name) and rounds. Audio lives in `data/audio/`.
4. **`server/core.ts`** is the single domain layer. Both the HTTP server and the MCP server import it,
   so they share one database file. The HTTP server watches `PRAGMA data_version` and pushes `changed`
   over SSE, so anything an agent does over MCP shows up live in the browser.
5. **MCP** (`server/mcp.ts`, stdio) exposes add_video, list_videos, get_revisions, get_frame,
   reply_to_revision, resolve_revision, wait_for_revisions. It works even when the app isn't open.
6. **get_frame**: `ffmpeg-static` decodes one frame to raw RGBA, `server/render.ts` rasterizes the stored
   strokes (anti-aliased, pure JS), and a tiny PNG encoder returns the image. No extra native deps.
7. **Platform abstraction** (`server/platform/`): file picker, open browser, reveal file. macOS uses
   `osascript`; Windows (PowerShell dialog) and Linux (zenity) stubs exist; UI falls back to pasting a path.
8. **Transcription** is an interface: live Web Speech in the browser today, `server/transcribe/whisper.ts`
   runs a local whisper.cpp binary when configured in Settings.
9. **Client**: Vite + React + Motion (one animation lib) + zustand. Player time flows through a tiny
   event bus (not React state) so the timeline/overlay update at 60fps without re-rendering the tree.
10. **Notifications** on "Send to agent": round row (for wait_for_revisions), optional webhook POST,
   optional `revisions.md` next to the video, and a copyable agent message.
11. **Start.command** checks Node, installs deps + builds on first run, starts the server, opens the browser.
