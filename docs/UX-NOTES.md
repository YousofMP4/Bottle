# UX notes — studying Flask (flask.do)

> flask.do could not be loaded from the build sandbox (DNS blocked by the network policy), so these
> notes come from a screenshot of Flask's review screen plus its public product descriptions.
> Animation timings below are *our* choices to hit the same feel, not measured values.

## What Flask is
Video feedback for creative teams and agents: reviewer talks over the video, draws on frames,
leaves timestamped notes; the agent receives transcribed text and uploads a new version to the same link.

## Layout (review screen)
- **Left rail (~260px)**: wordmark, workspace switcher, `+ New`, `Assets`, divider, list of recent
  videos (tiny poster square + truncated title, active row = soft filled pill). Bottom: upgrade, user + gear.
- **Main = an inset panel**: ~8px gap from window edges, ~14px radius, 1px hairline border, one shade
  lighter than the window. Everything else lives inside it.
- **Top bar** inside panel: breadcrumb `Assets › Title` + `…` menu. Right side: round icon buttons
  (download, link) and one light pill CTA (`Share`). The only "loud" element is that white pill.
- **Stage**: video centered and letterboxed on near-black, rounded corners (~10px). A panel toggle sits
  top-right of the stage (side panel is hidden by default — zero clutter).
- **Feedback bar** directly under the video, same width as the video: left segment is a
  voice/feedback mode button with a dot-matrix waveform glyph + chevron; right segment is a
  `Type..` input with a circular send arrow. Feedback is *the* primary action, attached to the video.
- **Transport bar** at the very bottom, one row: `Versions` pill above-left, then round play button,
  `v6` version chip, monospaced `0:12/0:32` timecode, a thin full-width scrubber with a white knob,
  then `−` / `+` (frame/zoom steps), `1x` speed chip, volume, settings.

## Visual language
- Monochrome: window ~#0b0b0b, panel ~#111, controls ~#1c1c1c, hairlines white @ 6–8%.
- Text: white for primary, ~55% gray for secondary (breadcrumb root, placeholders).
- Primary CTA = light gray/white pill with dark text. Everything else is ghost/icon buttons.
- Round shapes: circular icon buttons (36px), pill chips, generous padding, no shadows on chrome.
- Monospace only for time. System sans everywhere else, medium weight for titles.

## Interactions to match (feel, not pixels)
- Feedback is reachable without leaving the video: type and the video pauses; talk and it records.
- Versions are a first-class chip next to play, not buried in a menu.
- The side panel is opt-in; the default view is just video + feedback bar + transport.

## Bottle's motion spec (our choices)
| Thing | Motion |
|---|---|
| Side panel slide-in | spring stiffness 380, damping 38 (≈320ms, no overshoot visible) |
| Timeline marker pop-in | scale 0→1, spring stiffness 600, damping 22 (tiny overshoot) |
| Draw toolbar morph | shared-layout "active pill" between tools, spring 500/34 |
| Feedback bar → recording | layout width morph + waveform dots, spring 420/32 |
| Toasts | y 16→0, scale .96→1, opacity; exit y −8; spring 500/36 |
| View change (library ↔ review) | opacity + 1% scale + 8px y, 240ms ease [0.16,1,0.3,1] |
| Hover | 120–150ms color/opacity; press scale .96 |
| Drawings in playback | fade in 120ms, hold ~1.2s, fade out 300ms |
| Reduced motion | Motion `reducedMotion="user"` + CSS kill-switch; springs become fades |
