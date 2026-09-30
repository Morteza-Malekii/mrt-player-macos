const paths: Record<string, string> = {
  live: 'M4 7h16v13H4z M8 3l4 4 4-4', film: 'M3 4h18v16H3z M7 4v16 M17 4v16 M3 9h4 M3 15h4 M17 9h4 M17 15h4', series: 'M5 3h14 M3 7h18v14H3z M10 11l5 3-5 3z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2', settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6', search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  play: 'M8 4l13 8L8 20z', pause: 'M7 4v16 M17 4v16', volume: 'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 4a11 11 0 0 1 0 16', mute: 'M3 9h4l5-4v14l-5-4H3z M17 9l5 6 M22 9l-5 6',
  full: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6', close: 'M6 6l12 12 M18 6L6 18', back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', refresh: 'M20 7V2l-3 3a9 9 0 1 0 3 12 M20 7h-5', lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4', unlock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 7.5-2', stop: 'M5 5h14v14H5z'
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.play} /></svg>; }
