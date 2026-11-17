// 双色圆润图标：浅色底块 + 描边，颜色跟随 currentColor
const s = (fill, line) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><g fill="currentColor" fill-opacity=".3" stroke="none">${fill}</g>${line}</svg>`;

const PLANE = 'M12 2.8c1 0 1.7.8 1.7 1.9V9l7.3 4.2v2l-7.3-2.1v3.6l2 1.6v1.5L12 19.6 9.3 20.7v-1.5l2-1.6V13.9L4 16v-2L11.3 9V4.7c0-1.1.7-1.9 1.7-1.9z';

export const ICON = {
  plane: s(`<path d="${PLANE}"/>`, `<path d="${PLANE}"/>`),
  window: s('<rect x="5" y="2.5" width="14" height="19" rx="7"/>', '<rect x="5" y="2.5" width="14" height="19" rx="7"/><path d="M8.6 16.2h6.8a2.1 2.1 0 0 0 .2-4.2 3 3 0 0 0-5.6-.7 2.5 2.5 0 0 0-1.4 4.9z"/><circle cx="14.6" cy="7" r="1.2" fill="currentColor" stroke="none"/>'),
  gauge: s('<rect x="5" y="2.5" width="14" height="19" rx="7"/>', '<rect x="5" y="2.5" width="14" height="19" rx="7"/>'),
  elevator: s('<rect x="4" y="3" width="16" height="18" rx="4"/>', '<rect x="4" y="3" width="16" height="18" rx="4"/><path d="M12 3v18M7.6 10l1.4-2 1.4 2M13.6 14l1.4 2 1.4-2"/>'),
  mountain: s('<path d="M2.5 19.5l6.5-11 4 6 2.5-3.5 6 8.5z"/>', '<path d="M2.5 19.5l6.5-11 4 6 2.5-3.5 6 8.5z"/><path d="M7.4 11.6l1.6 1.6 1.4-1.2" opacity=".6"/>'),
  flask: s('<path d="M9.5 3h5v6l5 9a2 2 0 0 1-1.7 3H6.2A2 2 0 0 1 4.5 18l5-9z"/>', '<path d="M9.5 3h5M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9" opacity=".6"/>'),
  live: s('<circle cx="12" cy="12" r="9"/>', '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'),
  trip: s('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  ear: s('<path d="M7 9.5a5 5 0 0 1 10 0c0 3.2-2.6 4-3.3 6.2-.5 1.7-1.6 3.8-3.7 3.8A3 3 0 0 1 7 16.5z"/>', '<path d="M7 9.5a5 5 0 0 1 10 0c0 3.2-2.6 4-3.3 6.2-.5 1.7-1.6 3.8-3.7 3.8A3 3 0 0 1 7 16.5"/><path d="M10 9.7a2 2 0 0 1 4 0c0 1.3-1 1.6-1.5 2.5"/>'),
  records: s('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/>', '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v0A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4" opacity=".6"/><path d="M5 4.5v15"/>'),
  gear: s('<circle cx="12" cy="12" r="8"/>', '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  bt: s('<circle cx="12" cy="12" r="9"/>', '<path d="M8 8l8 8-4 3.5V4.5L16 8l-8 8"/>'),
  shield: s('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>', '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>'),
  wind: s('<circle cx="12" cy="12" r="9"/>', '<path d="M3.5 9h10.5a2.5 2.5 0 1 0-2.5-2.5M3.5 13h15a2.5 2.5 0 1 1-2.5 2.5M3.5 17h6"/>'),
  swap: s('<circle cx="12" cy="12" r="9"/>', '<path d="M7 5L3.5 8.5 7 12M3.5 8.5h14M17 19l3.5-3.5L17 12M20.5 15.5h-14"/>'),
  download: s('<circle cx="12" cy="12" r="9"/>', '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'),
  trash: s('<path d="M5.5 7l1 13h11l1-13z"/>', '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>'),
  close: s('', '<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: s('', '<path d="M9 6l6 6-6 6"/>'),
  info: s('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>'),
  sparkle: s('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>', '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4" opacity=".7"/>'),
  compare: s('<rect x="3" y="4" width="18" height="16" rx="4"/>', '<path d="M4.5 17l4.5-6 4 3 6.5-8"/><path d="M4.5 11l4.5 3 4-5 6.5 4" opacity=".45"/>'),
  head: s('<path d="M6 11a6 6 0 0 1 12 0v3a6 6 0 0 1-12 0z"/>', '<path d="M6 11a6 6 0 0 1 12 0v3a6 6 0 0 1-12 0z"/><path d="M6 12H4.8a1.5 1.5 0 0 0 0 3H6M18 12h1.2a1.5 1.5 0 0 1 0 3H18"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};
