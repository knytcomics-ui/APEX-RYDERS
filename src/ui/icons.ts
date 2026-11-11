/** Inline SVG icon set (Sheet C: navigation & general icons). Stroke icons inherit currentColor. */
const s = (body: string, vb = '0 0 24 24') =>
  `<svg class="ic" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const f = (body: string, vb = '0 0 24 24') => `<svg class="ic" viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const I = {
  home: f('<path d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z"/>'),
  back: f('<path d="M10.5 4 2 12l8.5 8v-5H22V9H10.5z"/>'),
  menu: s('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  gear: f('<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>'),
  user: f('<circle cx="12" cy="7.5" r="4.5"/><path d="M3 21c0-5 4-8 9-8s9 3 9 8z"/>'),
  trophy: f('<path d="M6 3h12v3h3v2a5 5 0 0 1-4.6 5A6 6 0 0 1 13 16v2h4v3H7v-3h4v-2a6 6 0 0 1-3.4-3A5 5 0 0 1 3 8V6h3zm0 5H5a3 3 0 0 0 1.4 2.5A9 9 0 0 1 6 8zm12 0a9 9 0 0 1-.4 2.5A3 3 0 0 0 19 8z"/>'),
  cart: s('<path d="M2 3h3l2.4 11.5h10.8L21 6.5H6.3"/><circle cx="9.5" cy="19.5" r="1.6" fill="currentColor"/><circle cx="16.5" cy="19.5" r="1.6" fill="currentColor"/>'),
  wallet: f('<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18v3h1.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-14A2.5 2.5 0 0 1 3 17.5zM5.5 6a.5.5 0 0 0 0 1H16V6zM16 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0z"/>'),
  wrench: f('<path d="M21.7 6.3 18 10l-3.6-.4L14 6l3.7-3.7a6 6 0 0 0-7.4 7.6L3 17.2a2.6 2.6 0 0 0 3.7 3.7l7.3-7.3a6 6 0 0 0 7.7-7.3z"/>'),
  bell: f('<path d="M12 2a6 6 0 0 0-6 6v4l-2 4h16l-2-4V8a6 6 0 0 0-6-6zm-3 16a3 3 0 0 0 6 0z"/>'),
  mail: f('<path d="M2 5h20v14H2zm2 2v.5l8 5.5 8-5.5V7l-8 5.5z"/>'),
  lock: f('<path d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10zm2.6 0h4.8V7a2.4 2.4 0 0 0-4.8 0zM12 13.5a2 2 0 0 0-1 3.7V19h2v-1.8a2 2 0 0 0-1-3.7z"/>'),
  check: s('<path d="M4 12.5 9.5 18 20 6.5"/>', '0 0 24 24'),
  copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  play: f('<path d="M7 4v16l13-8z"/>'),
  pause: f('<path d="M6 4h4.5v16H6zm7.5 0H18v16h-4.5z"/>'),
  retry: s('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>'),
  exit: s('<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>'),
  sound: f('<path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  music: f('<path d="M9 17.5V5l11-2v12.5a3 3 0 1 1-2-2.8V7.3l-7 1.3v8.9a3 3 0 1 1-2-2.8z"/>'),
  vibrate: s('<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/>'),
  motion: s('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  hand: f('<path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L2.4 14a1.6 1.6 0 0 1 2.6-1.8L7 14.5V7.5a1.5 1.5 0 0 1 2 0z"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>'),
  pad: f('<path d="M7 6h10a5 5 0 0 1 4.8 6.4l-1.5 5A3 3 0 0 1 15 18l-1.4-2h-3.2L9 18a3 3 0 0 1-5.3-.6l-1.5-5A5 5 0 0 1 7 6zm0 3v2H5v2h2v2h2v-2h2v-2H9V9zm9 .5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm2.5 2.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>'),
  info: f('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.3 8h2.6v8h-2.6zm1.3-5a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 12 5z"/>'),
  flag: f('<path d="M4 2h2v20H4z"/><path d="M7 3h13l-3 5 3 5H7z"/>'),
  timer: s('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5M19 6l1.5-1.5"/>'),
  vs: f('<path d="M1.5 5h3.6l2.4 9.2L10 5h3.5L9.2 19H5.8zm14.7 5.4c-1.2-.3-1.6-.6-1.6-1.2 0-.6.6-1 1.5-1 1 0 1.8.4 2.4 1l2-2.4C19.4 5.7 18 5 16 5c-3 0-5 1.6-5 4.3 0 2.4 1.6 3.4 3.8 3.9 1.3.3 1.7.6 1.7 1.2 0 .7-.6 1.1-1.7 1.1-1.2 0-2.3-.6-3-1.3l-2 2.4C11 18 12.8 19 15 19c3.2 0 5.2-1.7 5.2-4.4 0-2.4-1.5-3.6-4-4.2z"/>'),
  wifiOff: s('<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.7M2 8.8A15 15 0 0 1 7 6M22 8.8A15 15 0 0 0 11 4.6"/><circle cx="12" cy="20" r="1" fill="currentColor"/>'),
  chevR: s('<path d="M9 5l7 7-7 7"/>'),
  chevL: s('<path d="M15 5l-7 7 7 7"/>'),
  chevD: s('<path d="M5 9l7 7 7-7"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>', '0 0 24 24'),
  up: f('<path d="M12 3 3 12h5v3h8v-3h5zM8 17h8v4H8z"/>'),
  star: f('<path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z"/>'),
  share: f('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4" stroke="currentColor" stroke-width="2.2"/>'),
  swipeUp: s('<path d="M12 20V5M6 10l6-6 6 6"/>'),
  swipeDown: s('<path d="M12 4v15M6 14l6 6 6-6"/>'),
  swipeSide: s('<path d="M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5"/>'),
  tap: f('<circle cx="12" cy="9" r="3"/><path d="M12 2a7 7 0 0 1 7 7h-2a5 5 0 0 0-10 0H5a7 7 0 0 1 7-7z" opacity=".55"/><path d="M10.5 12v8.5h3V12z"/>'),
  doc: s('<path d="M6 2h9l4 4v16H6zM14 2v5h5M9 12h7M9 16h7"/>'),
  shield: f('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/>'),
  heart: f('<path d="M12 21 3.5 12.6A5.2 5.2 0 0 1 12 6a5.2 5.2 0 0 1 8.5 6.6z"/>'),
};

/** USDC mark — a distinct round blue token, never confused with the gold coin. */
export const usdc = (cls = 'tok') =>
  `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#2775ca"/><circle cx="16" cy="16" r="11.5" fill="none" stroke="#fff" stroke-width="1.6" opacity=".9"/><path d="M19.6 12.4c-.5-1.4-1.8-2.1-3.6-2.1-2.1 0-3.5 1.1-3.5 2.7 0 1.8 1.5 2.4 3.6 2.8 1.7.3 2.4.7 2.4 1.6s-.9 1.5-2.4 1.5c-1.4 0-2.4-.6-2.8-1.7M16 8.4v15.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
export const coin = (cls = 'tok') => `<img class="${cls}" src="assets/coin.png" alt="" draggable="false">`;
