# UX notes: studying Flask (flask.do)

Studied on 2026-11-15 in a real browser, signed in to a Flask workspace, plus the interactive demo on the
landing page. Everything below was **measured** from computed styles and Flask's shipped stylesheet unless it
says "observed". We copy the *feel*: timings, easing, densities, state logic. Never Flask's name, logo, colors
of its brand, icons, copy or assets. No Flask screenshots are committed (they contain Flask branding and a
real workspace); see `docs/screenshots/` for Bottle's own before/after shots.

## 1. Design tokens (measured)

| Token | Flask value | What it is |
|---|---|---|
| Window | `rgb(12,12,12)` | page background |
| Surfaces | 18 / 24 / 31 / 42 (gray) | panel, raised, popover, hover fill |
| Text | 250 · 160 · 111 · 80 | primary, secondary, tertiary, faint |
| Hairlines | 28 / 40 / 51, usually drawn at **0.5px** | `inset 0 0 0 .5px` rings, not borders |
| Control fill | `rgba(160,160,160,.063)` | every secondary/icon button |
| Control text | white @ .70 → **.95 on hover** | icons are dimmed until hovered |
| Hover / pressed / selected fills | white @ .058 / .097 / .146 | rows & ghost buttons |
| Row hover | white @ .034 | list rows |
| Focus ring | `rgba(173,173,173,.5)`, 2px, **only for keyboard users** (`:root[data-tab-focus]`) | mouse clicks never show a ring |
| Radius | 12px panels/menus/tooltips, 10px menu rows, pill (9999px) for every control | |
| Font | `ui-sans-serif, system-ui` 14px; titles 14px with `-0.35px` tracking; time is mono | |

## 2. Motion (measured)

- **Default ease:** `--ease-out: cubic-bezier(.23, 1, .32, 1)`. In-out: `cubic-bezier(.77, 0, .175, 1)`.
- **Hover color/background:** **150ms** with the ease-out (38 of ~50 transition rules in the stylesheet are 150ms).
- **Primary button glow/shadow:** 280ms ease-out. A radial "light" (`::before`, 90px radius) follows the pointer
  and expands to 220px over 900ms while pressed.
- **Press:** pills move down `translateY(1px)` with a flatter shadow; destructive buttons `scale(.97)`; small icon
  buttons `scale(.94–.96)`. Transform transition **150ms** ease-out, so press feels instant.
- **Tooltips (Radix):** enter = `fade-in + zoom-in-95 + 8px slide from the trigger side`, **150ms**. Exit is
  immediate. Delay: **0ms** in the sidebar (`instant-open`), **700ms** on transport buttons (`delayed-open`), and
  once one tooltip is open, neighbours open instantly (skip-delay). An arrow (12×7.5) points at the trigger.
- **Keycap in tooltips:** 20px keycap with a 2.5px bottom border, animates a "press" (`translateY(1px)`,
  border 2.5→1.5px) **twice**, 450ms each, starting 150ms after the tooltip appears. Disabled under reduced motion.
- **Toasts (Sonner):** top-center, 22px radius, `12px 16px` padding, icon + title + gray subtitle.
  `transform .45s cubic-bezier(.34,1.5,.64,1)` (a small overshoot), `opacity .25s` ease-out,
  `height .4s cubic-bezier(.87,0,.13,1)` when stacking.
- **Error nudge:** horizontal shake keyframes `-4, 3.5, -2.5, 1.5, -0.5px` (damped).
- **Live dots:** recording LED pulses `opacity 1↔.35, scale 1.15↔.85`; loading uses dot "chase/dance" loops.

## 3. Layout (observed + measured)

- Left rail with the wordmark, two 28px round icon buttons (collapse sidebar `S`, search `⌘K`), team switcher,
  `New`, `Assets`, a divider, then recent videos (16px thumb + title + `v6` chip). Bottom: Upgrade, account, gear.
- Main panel is inset ~8px from the window with a 12px radius and a 0.5px ring.
- **Top bar:** breadcrumb (`team › title` + `…` menu) left; right: 32px round Download, Copy Link, and the one
  light primary pill (`Share`).
- **Stage:** video centered, rounded ~10px. A 32px panel-toggle sits top-right of the stage.
- **Feedback bar** under the video, same width as the video: `[dot-matrix glyph] Give Feedback ⌄ | Type.. (→)`,
  46px tall, 10px inner radius. Focusing it grows it into a multi-line card with a pencil tool, `+` attach and a
  bright send arrow; a draft marker (avatar, `0:08`, tag) appears above the playhead.
- **Transport:** `Versions` pill above-left; then 32px Play, `v6` chip, mono `0:08/0:32`, a full-width scrubber
  with a white knob, then `− +` (timeline zoom, joined pill), `1x`, volume (hover reveals a vertical slider),
  view options.
- **Comments panel** (toggle): `Feedback | Context` segmented pills + filter button. Empty state is a single
  centered gray line, "No Feedback Yet". No illustration.
- **Narrow window (560px):** everything stacks: video, then the panel, then the scrubber full-width with controls
  under it, then a large centered "Give Feedback" pill at the very bottom. Top-bar actions collapse into `…`.

## 4. Interactions (observed)

- Every icon-only control has a Title Case `aria-label` and a tooltip ("Play ⎵", "Hide Sidebar S", "Search ⌘K").
- Hovering a list row reveals its checkbox and `…`, and a hover-tooltip with the exact date over "13d ago".
- Copy Link: the icon morphs into a ✓ and a toast confirms ("Link Copied" + a one-line explanation).
- Menus: 32px rows, 13px text, 6×10 padding, row hover = surface-4 with a gradient top edge. Missing mic/camera
  permission shows inline as an amber "Allow Access" row rather than an error dialog.
- Opening a video from the library does **not** autoplay in Flask; it opens paused at 0:00.
- Typing a letter while the page has focus starts a comment (type-to-comment).

## 5. What Bottle takes from this

| Area | Bottle change |
|---|---|
| Ease | `--ease-out: cubic-bezier(.23,1,.32,1)` everywhere; hovers 150ms; no 300ms+ hover fades |
| Controls | raised pill buttons: fill + 0.5px inset ring + top sheen + tiny drop shadow; icon at 70% → 95% on hover; pointer-following light on pills |
| Press | `translateY(1px)` on pills, `scale(.94)` on round icon buttons, 150ms |
| Tooltips | custom `Tip` layer: label + animated keycaps; **350ms** cold delay (between Flask's 0 and 700), instant when warm, 150ms fade/zoom/slide, arrow, aria-labels everywhere |
| Focus | ring only for keyboard users, follows the control's own radius |
| Toasts | top-center, optional subtitle, overshoot spring (0.45s feel), icon per tone |
| Empty states | short, specific, one action; no decorative noise |
| Autoplay | Bottle *does* autoplay when you click a video (user request), muted fallback if the browser blocks sound |

## 6. Bottle motion spec (after this pass)

| Thing | Motion |
|---|---|
| Hover color/fill | 150ms `--ease-out` |
| Press | 150ms transform; pills `translateY(1px)`, icons `scale(.94)` |
| Tooltip | 350ms delay (0 when warm, warm window 400ms); enter 150ms opacity + scale .95→1 + 6px slide; exit 80ms |
| Keycap press | 450ms × 2, starts 150ms after the tooltip shows |
| Toast | spring stiffness 520, damping 30 (≈ the 0.45s overshoot curve); exit 160ms |
| Popover/menu | 150ms opacity + scale .96→1 from the trigger side |
| Side panel | spring 380/38 |
| View change | 200ms fade + 6px y |
| Reduced motion | all of the above collapse to opacity fades |

## 7. Round 2: hardware controls and cursors (measured 2026-11-15)

**Scrubber knob** (`.metal-knob`, 14×14px, centered on the playhead):
- `conic-gradient(from 20deg, sheen, body 25%, sheen, body 75%, sheen)` with sheen = white @ .93, body = white @ .66
  on a black base, so it reads as brushed metal catching light at two angles.
- Bevel: `inset 0 1px` white top edge, `inset 0 -1px` black @ .3 bottom rim.
- Shadow thrown down-left (light from top-right): `-1px 1px 3px` and `-5px 6px 18px -2px`, black @ .65.
- The track is 20px tall for hit-testing and keeps the **default** arrow cursor. The volume slider thumb
  (12px, flat white) uses `grab`.
- Releasing a drag on a paused video **stays paused** in Flask. (Bottle resumes on release: requested.)

**Cursor logic**:
- Draw armed: `html[data-draw-armed] * { cursor: var(--draw-armed-cursor) !important }`. The cursor is a 40×40 SVG
  pencil tip with two drop shadows, hotspot `3 35` (the tip, bottom-left), fallback `crosshair`.
- Any drag: `html[data-drag-cursor=grabbing] * { cursor: grabbing !important }`, so the cursor never flickers
  while the pointer crosses other elements.
- Idle over playing video: `cursor: none` (hidden until the mouse moves).
- `disabled → not-allowed`, sliders `grab`, `active:grabbing`.

**Bottom bar** (from the reference screenshots): `Versions` pill sits on its own row above-left; the transport row
is play (round, 32px), `v6` chip, timecode where the elapsed part is bright and the duration dim, a long
4px track, then a cluster of joined `− +` steppers, `1 x`, volume, and a settings button. The feedback dock is
centered above the transport with a mode button (dot-matrix glyph + label + chevron) and a send arrow.

**Composer after drawing** (observed): choosing the pencil reveals a row of colored crayons above the composer;
the composer expands into a card with the pencil, `+` and send.

### Bottle's take
- Our own knob (not Flask's values verbatim): a knurled conic texture with 24 ridges + a soft specular dot,
  16px, grows to 18px on hover, presses in (inset shadow, scale .94) while dragging.
- Our own pen-nib SVG cursor tinted with the active ink color, hotspot at the nib, crosshair fallback.
- Same global-drag-cursor trick, `grab` on the track, `grabbing` everywhere during a scrub.
- Mechanical press: 80ms sink of 1–2px with a tightened shadow; optional WebAudio click (Settings, off by default).
