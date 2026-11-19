import type { Transition } from 'motion/react';
/** Ease-out used for every hover/press/enter (measured from the reference app). */
export const ease = [0.23, 1, 0.32, 1] as const;
export const spring = {
  panel: { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 } as Transition,
  pop: { type: 'spring', stiffness: 600, damping: 22 } as Transition,
  morph: { type: 'spring', stiffness: 500, damping: 34 } as Transition,
  bar: { type: 'spring', stiffness: 420, damping: 32 } as Transition,
  toast: { type: 'spring', stiffness: 520, damping: 30 } as Transition,
  soft: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
};
export const view = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease } },
  exit: { opacity: 0, transition: { duration: 0.1, ease } },
};

/** Menus and popovers: quick fade + scale from the trigger side. */
export const pop = { duration: 0.15, ease } as Transition;
