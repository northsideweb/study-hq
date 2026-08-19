/** Line icons (Feather-style, 1.6px stroke). Used everywhere instead of emoji. */
const P: Record<string, string> = {
  home: 'M3 9.5L10 4l7 5.5V16a1 1 0 01-1 1h-3.5v-4.5h-5V17H4a1 1 0 01-1-1z',
  book: 'M4 4h5a2 2 0 012 2v10a2 2 0 00-2-2H4zM16 4h-5a2 2 0 00-2 2v10a2 2 0 012-2h5z',
  pencil: 'M13.5 3.5l3 3L7 16H4v-3zM11.5 5.5l3 3',
  cards: 'M6.5 7h9a1 1 0 011 1v7a1 1 0 01-1 1h-9a1 1 0 01-1-1V8a1 1 0 011-1zM4 13V5a1 1 0 011-1h8',
  clock: 'M10 5v5l3 2M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  note: 'M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zM12 3v4h4M7 11h6M7 14h4',
  upload: 'M10 13V4M6.5 7.5L10 4l3.5 3.5M4 13v2a1 1 0 001 1h10a1 1 0 001-1v-2',
  tasks: 'M4 5.5l2 2 3-3.5M4 12.5l2 2 3-3.5M12 6h5M12 13h5',
  calendar: 'M4 6a1 1 0 011-1h10a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1zM4 9h12M7 3v3M13 3v3',
  chart: 'M4 16V9M8.7 16V4M13.3 16v-5M18 16H3',
  settings: 'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM10 2.5l1.2 1.9 2.2-.3.5 2.2 2 1-1 2 1 2-2 1-.5 2.2-2.2-.3L10 17.5l-1.2-1.9-2.2.3-.5-2.2-2-1 1-2-1-2 2-1 .5-2.2 2.2.3z',
  search: 'M9 15A6 6 0 109 3a6 6 0 000 12zM17 17l-3.8-3.8',
  plus: 'M10 4v12M4 10h12',
  camera: 'M4 7h2.5l1-2h5l1 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zM10 13.5a2.75 2.75 0 100-5.5 2.75 2.75 0 000 5.5z',
  clipboard: 'M7.5 4H6a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1h-1.5M7.5 4a1 1 0 011-1h3a1 1 0 011 1v1h-5z',
  file: 'M6 3h5l3 3v11a.9.9 0 01-1 1H6a.9.9 0 01-1-1V4a.9.9 0 011-1zM11 3v4h3',
  files: 'M7 6V4a1 1 0 011-1h7a1 1 0 011 1v9a1 1 0 01-1 1h-2M4 7h7a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z',
  sparkle: 'M10 3l1.4 3.6L15 8l-3.6 1.4L10 13l-1.4-3.6L5 8l3.6-1.4zM15.5 12.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  play: 'M6.5 4.5l8 5.5-8 5.5z',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  x: 'M5 5l10 10M15 5L5 15',
  trash: 'M4 6h12M8 6V4.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V6M6 6l.7 10a1 1 0 001 1h4.6a1 1 0 001-1L14 6',
  edit: 'M9 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-4M13 3.5l3 3L9.5 13H6.5v-3z',
  archive: 'M3 5.5h14v3H3zM4.5 8.5V16a.5.5 0 00.5.5h10a.5.5 0 00.5-.5V8.5M8 11.5h4',
  copy: 'M7 7h8a1 1 0 011 1v8a1 1 0 01-1 1H7a1 1 0 01-1-1V8a1 1 0 011-1zM4 13V4a1 1 0 011-1h8',
  more: 'M10 5.5h.01M10 10h.01M10 14.5h.01',
  chevronRight: 'M8 5l5 5-5 5',
  chevronDown: 'M5 8l5 5 5-5',
  chevronLeft: 'M12 5l-5 5 5 5',
  arrowRight: 'M4 10h12M11.5 5.5L16 10l-4.5 4.5',
  flag: 'M5 17V4h9l-2 3 2 3H5',
  target: 'M10 17a7 7 0 100-14 7 7 0 000 14zM10 13.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10 11a1 1 0 100-2 1 1 0 000 2z',
  alert: 'M10 6.5v4M10 13.5h.01M8.6 3.9L2.9 14a1.4 1.4 0 001.2 2.1h11.8a1.4 1.4 0 001.2-2.1L11.4 3.9a1.4 1.4 0 00-2.4 0z',
  image: 'M4 4h12a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zM7.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM3.5 13.5l4-3.5 3 2.5 3-2 3 3',
  download: 'M10 3v9M6.5 8.5L10 12l3.5-3.5M4 15h12',
  filter: 'M3 5h14l-5.5 6v4l-3 1.5V11z',
  grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
  list: 'M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
  brain: 'M8 3.5A2.5 2.5 0 005.5 6 2.5 2.5 0 004 8.3a2.4 2.4 0 001.3 2.1A2.4 2.4 0 006.6 14 2.4 2.4 0 0010 15V4a2 2 0 00-2-.5zM12 3.5A2.5 2.5 0 0114.5 6 2.5 2.5 0 0116 8.3a2.4 2.4 0 01-1.3 2.1A2.4 2.4 0 0113.4 14 2.4 2.4 0 0110 15',
  timer: 'M10 17a6 6 0 100-12 6 6 0 000 12zM10 8v3l2 1M8 2.5h4',
  flame: 'M10 17c2.8 0 5-2 5-4.6 0-3.4-3.4-4.6-3-8.4-1.6.6-3.4 2.4-3.4 4.6 0 1-.6 1.6-1.2 1.6-.6 0-1-.4-1.2-1-.8 1-1.2 2.2-1.2 3.2C5 15 7.2 17 10 17z',
  folder: 'M3 6a1 1 0 011-1h3.5l1.5 2H16a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  link: 'M8.5 11.5a3 3 0 004.2 0l2.3-2.3a3 3 0 10-4.2-4.2l-1 1M11.5 8.5a3 3 0 00-4.2 0L5 10.8a3 3 0 004.2 4.2l1-1',
  refresh: 'M15.5 7A6 6 0 004.5 8M4.5 13A6 6 0 0015.5 12M15.5 4v3h-3M4.5 16v-3h3',
  bookmark: 'M6 3.5h8a.5.5 0 01.5.5v12l-4.5-3-4.5 3V4a.5.5 0 01.5-.5z',
  music: 'M8 14.5V5l7-1.5v9M8 14.5a2 2 0 11-4 0 2 2 0 014 0zM15 12.5a2 2 0 11-4 0 2 2 0 014 0z',
  scale: 'M10 4v13M6 6.5L3.5 12h5zM14 6.5L11.5 12h5zM6 17h8M5 6.5h10',
  briefcase: 'M4 7h12a1 1 0 011 1v7a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zM7.5 7V5a1 1 0 011-1h3a1 1 0 011 1v2M3 11h14',
  compass: 'M10 17a7 7 0 100-14 7 7 0 000 14zM12.5 7.5l-1.6 3.4-3.4 1.6 1.6-3.4z',
  sigma: 'M14 5H6l4 5-4 5h8',
  pause: 'M7.5 5v10M12.5 5v10',
  eye: 'M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5zM10 12a2 2 0 100-4 2 2 0 000 4z',
  send: 'M17 3L9 11M17 3l-5 14-3-6-6-3z',
}

export function Icon({ name, size = 16, className = '', style }: { name: string; size?: number; className?: string; style?: any }) {
  const d = P[name] || P.book
  return (
    <svg
      className={className} style={style} width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export const SUBJECT_ICONS: Record<string, string> = {
  book: 'book', pen: 'pencil', sigma: 'sigma', music: 'music', compass: 'compass',
  scale: 'scale', briefcase: 'briefcase', flask: 'target', globe: 'target',
  code: 'grid', palette: 'image', heart: 'bookmark',
}
