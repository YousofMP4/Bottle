import { useEffect } from 'react';
import { useStore } from './store';
import { player } from './bus';
import { composer } from '../components/FeedbackBar';
import { toggleFullscreen } from '../components/Transport';
import { TOOLS } from '../components/DrawToolbar';

export const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  { group: 'Playback', items: [
    [['Space'], 'Play / pause'], [['K'], 'Pause'], [['J'], 'Play backwards (tap again for faster)'], [['L'], 'Play forwards (tap again for faster)'],
    [['←', '→'], 'Step one frame'], [['⇧ ←', '⇧ →'], 'Jump one second'], [['M'], 'Mute'], [['F'], 'Fullscreen'],
  ] },
  { group: 'Feedback', items: [
    [['C'], 'Comment at this frame'], [['D'], 'Draw on the frame'], [['1–4'], 'Pen, arrow, box, circle'], [['⌘Z'], 'Undo last mark'],
    [['R'], 'Start / stop a voice note'], [['↩'], 'Post comment'], [['Esc'], 'Cancel'],
  ] },
  { group: 'Review', items: [
    [['[', ']'], 'Previous / next comment'], [['\\'], 'Toggle comments panel'], [['⌘↩'], 'Send revisions to agent'], [['⌘O'], 'Add video'], [['?'], 'Show shortcuts'],
  ] },
];

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

/**
 * How the focused control got focus. After a mouse click, Chrome leaves focus on the button,
 * and Space would press it again. Space should play/pause then, like any video player. Only
 * when you Tab to a control does Space/Enter press it.
 */
let focusByKeyboard = false;
const CONTROL = 'button, a, [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="slider"], [role="switch"], [role="checkbox"]';
const spaceForPlayback = (e: KeyboardEvent) => {
  const el = (e.target as HTMLElement)?.closest?.(CONTROL);
  if (!el) return true;
  if (focusByKeyboard) return false;
  // Never steal Space from an open menu, popover or listbox.
  return !el.closest('[role="menu"], [role="listbox"], .popover, .ctx-menu');
};

export function useReviewShortcuts() {
  useEffect(() => {
    const onPointer = () => { focusByKeyboard = false; };
    const onTab = (e: KeyboardEvent) => { if (e.key === 'Tab') focusByKeyboard = true; };
    // Buttons fire their click on keyup for Space; cancel it when Space went to playback.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e) && !useStore.getState().dialog && spaceForPlayback(e) && (e.target as HTMLElement)?.closest?.(CONTROL)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); (window as any).__bottleSend?.(); return; }
      if (typing(e)) return;
      // Space plays/pauses even after clicking a button; Tab-focused controls keep Space/Enter.
      if (e.key === ' ' && !spaceForPlayback(e)) return;
      if (e.key === 'Enter' && (e.target as HTMLElement)?.closest?.(CONTROL)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        if (s.draft?.shapes.length) { e.preventDefault(); s.patchDraft({ shapes: s.draft.shapes.slice(0, -1) }); }
        return;
      }
      if (mod || e.altKey) return;
      const k = e.key;
      const sortedRoots = () => (s.detail?.comments ?? []).filter((c) => !c.parent_id && c.version_id === s.versionId).sort((a, b) => a.timestamp - b.timestamp);
      const jumpTo = (c: { id: string; timestamp: number } | undefined) => { if (!c) return; player.pause(); player.seek(c.timestamp); s.set({ selectedId: c.id }); };

      switch (k) {
        case ' ': e.preventDefault(); if (!e.repeat) player.toggle(); break;
        case 'k': case 'K': player.pause(); player.setRate(1); break;
        case 'j': case 'J': player.shuttle(-1); break;
        case 'l': case 'L': player.shuttle(1); break;
        case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) player.seek(player.time - 1); else player.step(-1); break;
        case 'ArrowRight': e.preventDefault(); if (e.shiftKey) player.seek(player.time + 1); else player.step(1); break;
        case ',': player.step(-1); break;
        case '.': player.step(1); break;
        case 'c': case 'C': e.preventDefault(); composer.focus(); break;
        case 'd': case 'D': e.preventDefault(); if (s.tool) s.set({ tool: null }); else { player.pause(); s.startDraft(player.time); s.set({ tool: 'pen' }); } break;
        case 'r': case 'R': e.preventDefault(); composer.toggleRecord(); break;
        case 'm': case 'M': if (player.el) player.el.muted = !player.el.muted; break;
        case 'f': case 'F': toggleFullscreen(); break;
        case '\\': s.set({ panelOpen: !s.panelOpen }); break;
        case '?': s.set({ dialog: 'shortcuts' }); break;
        case '[': { const t = player.time - 0.05; jumpTo([...sortedRoots()].reverse().find((c) => c.timestamp < t)); break; }
        case ']': { const t = player.time + 0.05; jumpTo(sortedRoots().find((c) => c.timestamp > t)); break; }
        case 'Enter': if (s.draft) { e.preventDefault(); composer.post(); } break;
        case 'Escape':
          if (s.tool) s.set({ tool: null });
          else if (s.draft) s.clearDraft();
          else if (s.selectedId) s.set({ selectedId: null });
          break;
        default:
          if (s.tool && /^[1-4]$/.test(k)) s.set({ tool: TOOLS[Number(k) - 1].id });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onTab, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onTab, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
}
