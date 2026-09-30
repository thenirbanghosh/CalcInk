const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const icons = {
  pen: svg('<path d="M4.5 19.5l3.8-.9L19 7.9a2.2 2.2 0 0 0-3.1-3.1L5.2 15.5z"/><path d="M14.2 6.6l3.2 3.2"/>'),
  strokeEraser: svg('<path d="M8.5 19.5h11"/><path d="M5.4 14.9l8.8-8.8a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8l-7.9 7.9a2.2 2.2 0 0 1-1.6.7H8.4a2 2 0 0 1-1.4-.6l-1.6-1.6a1 1 0 0 1 0-1.4z"/><path d="M10 10.3l4.9 4.9"/>'),
  pixelEraser: svg('<circle cx="12" cy="12" r="7.2" stroke-dasharray="2.4 2.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.2a5.3 5.3 0 0 1 0 10.6H11"/>'),
  redo: svg('<path d="M15 14.5l5-5-5-5"/><path d="M20 9.5H9.8a5.3 5.3 0 0 0 0 10.6H13"/>'),
  trash: svg('<path d="M4.5 7h15"/><path d="M10 11v5.5M14 11v5.5"/><path d="M6.3 7l.9 11.4a2 2 0 0 0 2 1.8h5.6a2 2 0 0 0 2-1.8L17.7 7"/><path d="M9.2 7V5.2c0-.7.5-1.2 1.2-1.2h3.2c.7 0 1.2.5 1.2 1.2V7"/>'),
  xray: svg('<path d="M4 8.5V6.2C4 5 5 4 6.2 4h2.3M15.5 4h2.3C19 4 20 5 20 6.2v2.3M20 15.5v2.3c0 1.2-1 2.2-2.2 2.2h-2.3M8.5 20H6.2C5 20 4 19 4 17.8v-2.3"/><rect x="8" y="8" width="8" height="8" rx="1.6" stroke-dasharray="2 2"/>'),
  gauge: svg('<path d="M4 17.5a8.5 8.5 0 1 1 16 0"/><path d="M12 13.5l3.6-4.2"/><circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  help: svg('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2 1-1.2 1.8v.5"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5"/>'),
  check: svg('<path d="M5 12.5l4.2 4L19 7"/>'),
};
