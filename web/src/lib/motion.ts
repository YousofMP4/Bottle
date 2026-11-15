import type { Transition } from 'motion/react';
export const ease = [0.16, 1, 0.3, 1] as const;
export const spring = {
  panel: { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 } as Transition,
  pop: { type: 'spring', stiffness: 600, damping: 22 } as Transition,
  morph: { type: 'spring', stiffness: 500, damping: 34 } as Transition,
  bar: { type: 'spring', stiffness: 420, damping: 32 } as Transition,
  toast: { type: 'spring', stiffness: 500, damping: 36 } as Transition,
  soft: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
};
export const view = {
  initial: { opacity: 0, y: 8, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.16, ease } },
};
