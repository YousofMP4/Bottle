import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});
const mk = (d: React.ReactNode) => ({ size, ...p }: P) => <svg {...base(size)} {...p}>{d}</svg>;

export const IPlay = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" /></svg>;
export const IPause = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></svg>;
export const IPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IMinus = mk(<path d="M5 12h14" />);
export const IArrowRight = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IArrowUp = mk(<path d="M12 19V5M6 11l6-6 6 6" />);
export const IChevronDown = mk(<path d="M6 9l6 6 6-6" />);
export const IChevronLeft = mk(<path d="M15 6l-6 6 6 6" />);
export const IChevronRight = mk(<path d="M9 6l6 6-6 6" />);
export const IPen = mk(<><path d="M4 20l4-1L19.5 7.5a2.1 2.1 0 0 0-3-3L5 16z" /><path d="M14.5 6.5l3 3" /></>);
export const IArrowTool = mk(<><path d="M5 19L19 5" /><path d="M10 5h9v9" /></>);
export const IRect = mk(<rect x="4" y="5" width="16" height="14" rx="1.5" />);
export const ICircle = mk(<circle cx="12" cy="12" r="8" />);
export const IUndo = mk(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IX = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const ICheck = mk(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IMic = mk(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>);
export const IStop = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" /></svg>;
export const ISettings = mk(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IPanel = mk(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M14.5 4.5v15" /></>);
export const ICopy = mk(<><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>);
export const ISend = mk(<><path d="M20.5 3.5L10 14" /><path d="M20.5 3.5l-6.5 17-4-6.5-6.5-4z" /></>);
export const IVolume = mk(<><path d="M11 5L6.5 9H3.5v6h3L11 19z" /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" /></>);
export const IMute = mk(<><path d="M11 5L6.5 9H3.5v6h3L11 19z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>);
export const IExpand = mk(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IKeyboard = mk(<><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></>);
export const ILibrary = mk(<><rect x="3.5" y="4.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="4.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></>);
export const IMore = ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>;
export const IReply = mk(<><path d="M9 17l-5-5 5-5" /><path d="M4 12h10a6 6 0 0 1 6 6v1" /></>);
export const ITrash = mk(<><path d="M4.5 7h15M10 11v6M14 11v6" /><path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7" /></>);
export const IFolder = mk(<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />);
export const IFilm = mk(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" /></>);
export const ISparkle = mk(<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />);
export const IBot = mk(<><rect x="4.5" y="8" width="15" height="11" rx="3.5" /><path d="M12 4.5V8M9.5 13h.01M14.5 13h.01" /></>);
export const IEye = mk(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>);
export const IGrid = mk(<><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>);
export const IList = mk(<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />);
export const ISearch = mk(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const ILink = mk(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);

/** Bottle mark: a simple glass bottle silhouette. */
export const BottleMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M9.6 2.5h4.8v1.6h-.6v2.6c0 .8 3.2 2.3 3.2 6.1v6.9a2.8 2.8 0 0 1-2.8 2.8H9.8A2.8 2.8 0 0 1 7 19.7v-6.9c0-3.8 3.2-5.3 3.2-6.1V4.1h-.6z" fill="var(--accent)" />
    <path d="M9 13.2h6v4.4H9z" fill="var(--bg)" opacity=".55" />
  </svg>
);

/** The dot-matrix waveform glyph used for voice notes. Animates when `levels` are live. */
export function DotWave({ levels, cols = 7, rows = 5, live = false }: { levels?: number[]; cols?: number; rows?: number; live?: boolean }) {
  const lv = levels && levels.length ? levels.slice(-cols) : [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.3].slice(0, cols);
  while (lv.length < cols) lv.unshift(0.08);
  const w = cols * 4, h = rows * 4;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={live ? 'dotwave live' : 'dotwave'} aria-hidden>
      {lv.map((l, c) => {
        const on = Math.max(1, Math.round(l * rows));
        return Array.from({ length: rows }, (_, r) => {
          const dist = Math.abs(r - (rows - 1) / 2);
          const lit = dist < on / 2 + 0.01;
          return <circle key={`${c}-${r}`} cx={c * 4 + 2} cy={r * 4 + 2} r={1.15} fill="currentColor" opacity={lit ? 1 : 0.22} />;
        });
      })}
    </svg>
  );
}
