import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});
const mk = (d: React.ReactNode) => ({ size, ...p }: P) => <svg {...base(size)} {...p}>{d}</svg>;

export const IPlay = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" /></svg>;
export const IPause = ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></svg>;
export const IBoard = mk(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.2 4.5v15M14.8 4.5v15" /><path d="M5.8 8h1.4M11.3 8h1.4M16.8 8h1.4" /></>);
export const IBell = mk(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>);
export const ILinkSm = mk(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IDownload = mk(<><path d="M12 4v11M7 10.5l5 5 5-5" /><path d="M5 19.5h14" /></>);
export const IPeople = mk(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2a5.5 5.5 0 0 1 3 4.8" /></>);
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

/** Portal's app mark: the playhead "t" from the wordmark (red head, ink line) on a white tile. */
export const PortalMark = ({ size = 22, tile = true }: { size?: number; tile?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="portal-mark">
    {tile && <rect x="8" y="8" width="496" height="496" rx="112" fill="#fff" stroke="#e6e0e0" strokeWidth="4" />}
    <g transform="translate(256 256) scale(0.56) translate(-178.1 315.0)">
      <path d="M129.1 -520L19.6 -42Q10 -0 52 -0Q94 -0 103.6 -42L213.1 -520Z" fill="var(--ink, #0b0404)" />
      <path d="M68.3 -630L324.3 -630Q346.3 -630 341.2 -608L331.6 -566L159.6 -470L31.6 -566L41.2 -608Q46.3 -630 68.3 -630Z" fill="#e8121b" />
    </g>
  </svg>
);

/** The "portal" wordmark: Instrument Serif Italic, its t redrawn as an editor's playhead. */
export const Wordmark = ({ height = 20 }: { height?: number }) => (
  <svg height={height} viewBox="-97 -751 2145 964" aria-label="portal" role="img" className="wordmark-svg">
    <path d="M-76 205Q-89 205 -89 194Q-89 184 -73 182L-59 180Q-39 177 -29.5 168.5Q-20 160 -15 138L118 -436Q120 -444 115.5 -448.5Q111 -453 103 -448Q93 -443 84 -437.5Q75 -432 66 -426Q57 -420 51 -422.5Q45 -425 45 -432Q45 -439 55 -446Q83 -465 113 -479Q130 -487 134 -505L147 -562Q152 -583 173 -583L191 -583Q203 -583 209 -576Q215 -569 212 -556L205 -527Q202 -510 218 -513Q241 -516 262 -516Q336 -516 383 -474Q430 -432 430 -345Q430 -277 405 -213.5Q380 -150 339 -100Q298 -50 249 -20.5Q200 9 151 9Q124 9 100 -2Q85 -9 82 6L52 138Q47 160 52.5 167Q58 174 77 177L103 181Q121 184 121 193Q121 205 104 205ZM110 -115Q92 -16 153 -16Q188 -16 224 -45.5Q260 -75 291 -124.5Q322 -174 341 -236Q360 -298 360 -363Q360 -430 331 -459.5Q302 -489 246 -489Q196 -489 189 -455ZM592 9Q530 9 494 -42.5Q458 -94 458 -182Q458 -247 479 -307Q500 -367 534.5 -414Q569 -461 611.5 -488.5Q654 -516 697 -516Q759 -516 795 -465Q831 -414 831 -325Q831 -260 810 -200Q789 -140 754.5 -93Q720 -46 677.5 -18.5Q635 9 592 9ZM590 -15Q622 -15 652.5 -46Q683 -77 708 -128Q733 -179 748 -241.5Q763 -304 763 -367Q763 -492 698 -492Q667 -492 636 -461.5Q605 -431 580.5 -380Q556 -329 541 -266.5Q526 -204 526 -141Q526 -15 590 -15ZM904 -0Q890 -0 893 -13L988 -412Q993 -434 989.5 -446.5Q986 -459 971 -459Q953 -459 931.5 -432.5Q910 -406 883 -332Q879 -319 869 -319Q854 -319 861 -337Q883 -406 907.5 -445Q932 -484 957 -500Q982 -516 1003 -516Q1036 -516 1050 -491.5Q1064 -467 1051 -411L1040 -364Q1039 -357 1043 -356Q1047 -355 1050 -361Q1088 -448 1119 -482Q1150 -516 1190 -516Q1217 -516 1230.5 -501.5Q1244 -487 1244 -462Q1244 -437 1232 -422Q1220 -407 1201 -407Q1185 -407 1178 -415Q1171 -423 1167.5 -433.5Q1164 -444 1160 -452Q1156 -460 1147 -460Q1132 -460 1108 -422Q1084 -384 1056.5 -319.5Q1029 -255 1003.5 -175Q978 -95 959 -11Q956 -0 945 -0ZM1425 9Q1389 9 1369 -22Q1349 -53 1349 -113Q1349 -170 1365 -227.5Q1381 -285 1409 -337Q1437 -389 1472.5 -429Q1508 -469 1547.5 -492.5Q1587 -516 1626 -516Q1645 -516 1662 -508.5Q1679 -501 1690 -485Q1696 -476 1702 -476Q1708 -476 1714 -485Q1725 -501 1732 -505.5Q1739 -510 1745 -510Q1758 -510 1755 -496L1666 -113Q1651 -48 1686 -48Q1709 -48 1727.5 -79Q1746 -110 1765 -175Q1768 -186 1778 -186Q1785 -186 1787 -180Q1789 -174 1787 -166Q1768 -72 1736 -31.5Q1704 9 1659 9Q1620 9 1603.5 -24Q1587 -57 1600 -114L1613 -169Q1615 -176 1610.5 -177Q1606 -178 1603 -172Q1548 -71 1505.5 -31Q1463 9 1425 9ZM1450 -42Q1474 -42 1503 -71Q1532 -100 1560.5 -146Q1589 -192 1613 -245Q1637 -298 1651.5 -347Q1666 -396 1666 -430Q1666 -491 1623 -491Q1597 -491 1568 -467.5Q1539 -444 1512.5 -404Q1486 -364 1464.5 -313.5Q1443 -263 1430 -208.5Q1417 -154 1417 -102Q1417 -67 1425.5 -54.5Q1434 -42 1450 -42ZM1872 10Q1839 10 1825 -14.5Q1811 -39 1824 -95L1951 -640Q1956 -658 1951.5 -665Q1947 -672 1933 -673L1903 -676Q1888 -677 1890 -689Q1892 -698 1904 -700Q1940 -706 1968 -714.5Q1996 -723 2013 -737Q2021 -743 2028 -743Q2040 -743 2037 -728L1889 -94Q1884 -72 1887.5 -59.5Q1891 -47 1906 -47Q1924 -47 1945.5 -73.5Q1967 -100 1994 -174Q1998 -187 2008 -187Q2023 -187 2016 -169Q1995 -101 1969.5 -61.5Q1944 -22 1919 -6Q1894 10 1872 10ZM1302.1 -520L1188.7 -25Q1183 -0 1208 -0Q1233 -0 1238.7 -25L1352.1 -520Z" fill="currentColor" />
    <path d="M1231.3 -604L1461.3 -604Q1477.3 -604 1473.7 -588L1465.9 -554L1317.9 -480L1203.9 -554L1211.7 -588Q1215.3 -604 1231.3 -604Z" fill="#e8121b" />
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
